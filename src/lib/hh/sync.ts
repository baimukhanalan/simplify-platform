import "server-only";
import { db } from "../db";
import { isAhead, ROUND_LABEL } from "../rounds";
import { APPLIED_OR_LATER } from "../engine/taxonomy";
import { createInterview, logEvent, notify } from "../engine/agent";
import { roleLabelRu } from "../ru";
import { hhEnabled, hhIntegration, HhAuthError, listNegotiations, mapNegotiationState, patchHhMeta } from "./client";

const CLOSED = new Set(["hired", "rejected", "skipped"]);
const ROUNDS = new Set(["assessment", "recruiter", "hiring_manager", "technical", "final"]);

export type HhSyncReport = { checked: number; moved: number; submitted: number; skipped?: string };

/**
 * Pull the user's hh negotiations and move matching opportunities (Job.externalId = `hh-${vacancy.id}`) forward only
 * (isAhead; a discard can end any open stage). Invitations get an inbox message, a notification and an Interview Room;
 * discards get an inbox message and a notification. A negotiation for a role Simplify prepared but the user sent on
 * hh.kz themselves marks it submitted and closes its handoff. Idempotent: nothing happens when the status didn't change.
 */
export async function syncHhNegotiations(userId: string): Promise<HhSyncReport> {
  if (!hhEnabled()) return { checked: 0, moved: 0, submitted: 0, skipped: "disabled" };
  const row = await hhIntegration(userId);
  if (!row?.accessToken) return { checked: 0, moved: 0, submitted: 0, skipped: "not-connected" };

  let negotiations;
  try {
    negotiations = await listNegotiations(userId);
  } catch (e) {
    if (e instanceof HhAuthError) return { checked: 0, moved: 0, submitted: 0, skipped: "reconnect" };
    throw e;
  }
  const byExternal = new Map(negotiations.filter((n) => n.vacancy?.id).map((n) => [`hh-${n.vacancy!.id}`, n]));
  if (!byExternal.size) {
    await patchHhMeta(userId, { lastSyncAt: new Date().toISOString() });
    return { checked: 0, moved: 0, submitted: 0 };
  }
  const opps = await db.opportunity.findMany({
    where: { campaign: { userId }, job: { source: "hh", externalId: { in: [...byExternal.keys()] } } },
    include: { job: { select: { company: true, title: true, externalId: true, url: true } } },
  });

  let moved = 0, submitted = 0;
  for (const o of opps) {
    const n = byExternal.get(o.job.externalId)!;
    let status = o.status;
    // Sent on hh.kz by the user (after a handoff, or directly): record it once.
    if (!APPLIED_OR_LATER.includes(status) && !CLOSED.has(status)) {
      const done = await db.opportunity.updateMany({ where: { id: o.id, status: { notIn: APPLIED_OR_LATER } }, data: { status: "submitted", submittedAt: n.created_at ? new Date(n.created_at) : new Date() } });
      if (done.count) {
        submitted++;
        status = "submitted";
        await db.applicationPackage.updateMany({ where: { opportunityId: o.id, submitMethod: "" }, data: { submitMethod: "hh-user" } });
        await db.approval.updateMany({ where: { opportunityId: o.id, kind: "handoff", status: "pending" }, data: { status: "approved", answer: "Отправлено на hh.kz", resolvedAt: new Date() } });
        await logEvent(userId, "submitted", `Отклик найден на hh.kz: ${roleLabelRu(o.job)}`, o.id, { method: "hh-user" });
      }
    }
    if (CLOSED.has(status)) continue;
    const next = mapNegotiationState(n.state?.id, n.employer_state?.id);
    if (!next || next === status || (next !== "rejected" && !isAhead(next, status))) continue;
    const upd = await db.opportunity.updateMany({ where: { id: o.id, status }, data: { status: next } });
    if (!upd.count) continue;
    moved++;
    const role = `${o.job.company} · ${o.job.title}`;
    if (next === "rejected") {
      await db.inboxMessage.create({ data: { userId, opportunityId: o.id, fromAddr: "hh.kz", subject: `Отказ по отклику — ${o.job.title}`, body: `${o.job.company} отказал по твоему отклику на hh.kz. Статус обновлён автоматически.\n${o.job.url}`, classification: "rejection", confidence: 1, simulated: false } });
      await notify(userId, "rejection", "Отказ на hh.kz", role, `/app/opportunities/${o.id}`);
      await logEvent(userId, "hh_sync", `hh.kz: ${o.job.company} — отказ → статус «отказ»`, o.id, { state: n.state?.id, employerState: n.employer_state?.id });
    } else if (ROUNDS.has(next)) {
      const round = next;
      await db.inboxMessage.create({ data: { userId, opportunityId: o.id, fromAddr: "hh.kz", subject: `Приглашение — ${o.job.title}`, body: `${o.job.company} пригласил тебя по отклику на hh.kz (${ROUND_LABEL[round] ?? round}). Детали и переписка — в откликах на hh.kz.\n${o.job.url}`, classification: round === "assessment" ? "assessment" : "interview", confidence: 1, simulated: false } });
      await notify(userId, round === "assessment" ? "assessment" : "interview", round === "assessment" ? "Тестовое задание на hh.kz" : "Приглашение на hh.kz", role, "/app/interviews");
      await createInterview(userId, o.id, round);
      await logEvent(userId, "hh_sync", `hh.kz: ${o.job.company} — приглашение → статус «${ROUND_LABEL[round] ?? round}»`, o.id, { state: n.state?.id, employerState: n.employer_state?.id });
    } else if (next === "offer") {
      await notify(userId, "offer", "Оффер на hh.kz", role, `/app/opportunities/${o.id}`);
      await logEvent(userId, "hh_sync", `hh.kz: ${o.job.company} — оффер`, o.id, { state: n.state?.id, employerState: n.employer_state?.id });
    } else {
      await logEvent(userId, "hh_sync", `hh.kz: ${o.job.company} — отклик просмотрен, ждём ответа`, o.id, { state: n.state?.id });
    }
  }
  await patchHhMeta(userId, { lastSyncAt: new Date().toISOString() });
  return { checked: opps.length, moved, submitted };
}
