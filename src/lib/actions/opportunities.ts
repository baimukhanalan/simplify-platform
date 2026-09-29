"use server";
// Opportunities feed + detail: the user's three decisions (Apply / Auto / Skip) and the global auto-apply switch.
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, s } from "../db";
import { APPLIED_OR_LATER } from "../engine/taxonomy";
import { readAutonomy, readStoredAutonomy } from "../engine/autonomy";
import { isSimulation } from "../mode";
import { QUEUE_MATCH, blockingQuestions, currentEligibility, duplicateOf, logEvent, prepare, settleSharedAnswers, submit } from "../engine/agent";
import { blockerKind } from "../engine/matching";
import { count } from "../ru";
import { captureError } from "../monitoring";

export type DecisionState = {
  ok?: boolean;
  /** What happened, in one sentence for the card. */
  message?: string;
  /** Optional follow-up link (approvals, application, official form). */
  href?: string;
  hrefLabel?: string;
  error?: string;
};

const DECISIONS = new Set(["apply", "auto", "skip", "reset"]);

function refresh(id: string) {
  revalidatePath("/app", "layout");
  revalidatePath(`/app/opportunities/${id}`);
}

/** Status a vacancy returns to when the user un-skips it (mirrors the engine's discovery rule). */
const restoredStatus = (match: number) => (match >= QUEUE_MATCH ? "qualified" : "found");

/**
 * Apply  — the user confirmed: decision=apply, then prepare + submit right now through the engine.
 *          Sensitive questions still go to the exception queue; live (non-demo) vacancies become a handoff.
 * Auto   — decision=auto: the agent may prepare and submit on its own in the next cycle.
 * Skip   — decision=skip + status skipped: the agent never touches it again (rerank keeps manual skips).
 * Reset  — undo a skip / clear the decision.
 */
export async function decideOpportunity(_prev: DecisionState, form: FormData): Promise<DecisionState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!DECISIONS.has(decision)) return { error: "Неизвестное действие." };
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId: user.id } },
    include: { job: true, campaign: { select: { status: true, autoSubmit: true, userId: true, allocation: true, plan: true } } },
  });
  if (!opp) return { error: "Вакансия не найдена." };
  const applied = APPLIED_OR_LATER.includes(opp.status);
  const who = `${opp.job.title} — ${opp.job.company}`;

  if (decision === "skip") {
    if (applied) return { error: "Заявка уже отправлена — её нельзя пропустить. Статус меняется в Applications." };
    await db.opportunity.update({ where: { id }, data: { decision: "skip", status: "skipped" } });
    await db.approval.updateMany({ where: { opportunityId: id, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
    // Same shape as a manual status move, so rerank() treats it as the user's skip and never undoes it.
    await logEvent(user.id, "status_change", `Пропущено: ${who}`, id, { from: opp.status, to: "skipped", by: "user", decision: "skip" });
    await settleSharedAnswers(user.id); // a package that waited for this role's standing question now asks it itself
    refresh(id);
    return { ok: true, message: "Пропущено. Агент больше не вернётся к этой вакансии." };
  }

  if (decision === "reset") {
    const status = opp.status === "skipped" && opp.eligibility !== "blocked" ? restoredStatus(opp.match) : opp.status;
    await db.opportunity.update({ where: { id }, data: { decision: "", status } });
    if (status !== opp.status) await logEvent(user.id, "status_change", `Возвращено в работу: ${who}`, id, { from: opp.status, to: status, by: "user" });
    refresh(id);
    return { ok: true, message: "Решение снято — агент снова оценивает вакансию сам." };
  }

  if (applied) return { ok: true, message: "Заявка уже отправлена.", href: `/app/applications/${id}`, hrefLabel: "Открыть заявку" };
  // Goal settings may have changed since the last cycle (stop-list, countries, salary floor, level…): judge the role as it
  // is now, with the user's pick (level lines the user may override — «Уровень ниже цели», a dream company's level — become
  // notes, exactly isOverridable). Whatever is still blocked stops the Apply / Auto here, before anything is prepared.
  const fresh = await currentEligibility({ ...opp, decision });
  if (fresh.eligibility === "blocked") {
    const filterOnly = fresh.blockers.every((b) => blockerKind(b) === "filter");
    refresh(id);
    return { error: filterOnly ? "Вакансия вне твоих настроек поиска — агент не может подать. Измени настройки, если хочешь её рассмотреть." : "Эта вакансия не проходит по требованиям — агент не может подать." };
  }
  // One application per role in a campaign: the same company + title from another location is already prepared or sent.
  const dup = await duplicateOf(opp);
  if (dup) return { error: `На эту роль в ${opp.job.company} уже есть заявка${dup.job.location ? ` (${dup.job.location})` : ""} — второй раз агент не подаёт.`, href: `/app/opportunities/${dup.id}`, hrefLabel: "Открыть" };
  // A previously skipped role comes back into the queue when the user changes their mind.
  const revived = opp.status === "skipped" || opp.status === "found" ? "qualified" : opp.status;

  if (decision === "auto") {
    await db.opportunity.update({ where: { id }, data: { decision: "auto", status: revived } });
    await logEvent(user.id, "decision", `Auto: агент подаст сам — ${who}`, id, { decision: "auto" });
    // Campaign.autoSubmit is the auto-submit consent: without it the agent never sends anything on its own.
    if (!opp.campaign.autoSubmit) {
      refresh(id);
      return { ok: true, message: "Отмечено Auto, но автоподача выключена в «Настройках» (согласие). Агент подготовит пакет — отправить можно кнопкой Apply.", href: "/app/settings", hrefLabel: "Настройки" };
    }
    if (opp.campaign.status !== "active" && opp.campaign.status !== "paused") {
      refresh(id);
      return { ok: true, message: "Отмечено, но кампания завершена — агент больше не подаёт сам. Отправить можно кнопкой Apply." };
    }
    // Its own question cards and a standing question asked on another role both hold it (answered in Подтверждения).
    const pending = await blockingQuestions(id);
    // Already prepared with nothing pending on an active campaign: hand it to the agent now.
    if (revived === "prepared" && opp.campaign.status === "active" && !pending) {
      const r = await submit(id);
      refresh(id);
      if (r.ok) return { ok: true, message: "Агент отправил заявку.", href: `/app/applications/${id}`, hrefLabel: "Открыть заявку" };
      if (r.reason === "handoff") return { ok: true, message: "Пакет готов. Живая вакансия — отправка через официальную форму.", href: `/app/opportunities/${id}`, hrefLabel: "Открыть" };
    }
    refresh(id);
    if (pending) return { ok: true, message: `Агент подаст сам, как только ты ответишь на ${count(pending, ["вопрос", "вопроса", "вопросов"])}.`, href: "/app/approvals", hrefLabel: "Ответить" };
    return { ok: true, message: opp.campaign.status === "active" ? "Агент подаст сам в ближайшем цикле." : "Отмечено. Агент подаст, когда кампания снова будет активна." };
  }

  // decision === "apply": the user explicitly confirmed this role.
  await db.opportunity.update({ where: { id }, data: { decision: "apply", status: revived } });
  await logEvent(user.id, "decision", `Apply: заявка подтверждена тобой — ${who}`, id, { decision: "apply" });
  try {
    const hasPkg = await db.applicationPackage.findUnique({ where: { opportunityId: id }, select: { id: true } });
    if (!hasPkg || revived !== "prepared") {
      const p = await prepare(id);
      if (p.duplicate) {
        refresh(id);
        return { error: `На эту роль в ${opp.job.company} уже есть заявка — второй раз агент не подаёт.` };
      }
    }
    const pending = await blockingQuestions(id);
    if (pending) {
      refresh(id);
      return { ok: true, message: `Пакет готов. ${count(pending, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} твоего ответа — после этого заявка уйдёт.`, href: "/app/approvals", hrefLabel: "Ответить" };
    }
    const r = await submit(id);
    refresh(id);
    if (r.ok) return { ok: true, message: "Заявка отправлена.", href: `/app/applications/${id}`, hrefLabel: "Открыть заявку" };
    if (r.reason === "handoff") return { ok: true, message: "Пакет готов. Это живая вакансия — отправь его через официальную форму.", href: `/app/opportunities/${id}`, hrefLabel: "Как отправить" };
    return { ok: true, message: "Пакет готов, отправка ждёт.", href: `/app/opportunities/${id}`, hrefLabel: "Открыть" };
  } catch (e) {
    console.error("apply failed", e);
    await captureError(e, { source: "action", userId: user.id, meta: { step: "apply", opportunityId: id } });
    refresh(id);
    return { error: "Не удалось подготовить заявку. Попробуй ещё раз." };
  }
}

/**
 * Global switch "Auto-apply all jobs above N% match".
 * Writes only submitApplications — the same field as the Agent screen's auto-apply switch; the threshold
 * (autoApplyMinMatch, always a number) is set on the Agent screen and left untouched here.
 * On  → the agent submits roles with Match ≥ threshold on its own.
 * Off → the agent still finds and prepares, but submits only roles you marked Apply/Auto.
 * Other autonomy keys are preserved.
 */
export async function setAutoApply(enabled: boolean): Promise<{ ok: boolean; enabled: boolean; min: number }> {
  const user = await requireUser();
  const fresh = await db.user.findUnique({ where: { id: user.id }, select: { autonomy: true } });
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(fresh?.autonomy || "{}");
    raw = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    raw = {};
  }
  const current = readAutonomy(fresh?.autonomy);
  // Server actions are callable with any payload: only a real boolean changes anything. In simulation auto-apply is a
  // standing rule (the switch is not shown): nothing is written, so the user's stored settings are never overwritten.
  if (typeof enabled !== "boolean" || isSimulation()) return { ok: false, enabled: current.submitApplications, min: current.autoApplyMinMatch };
  const min = readStoredAutonomy(fresh?.autonomy).autoApplyMinMatch;
  await db.user.update({ where: { id: user.id }, data: { autonomy: s({ ...raw, submitApplications: enabled, autoApplyMinMatch: min }) } });
  await logEvent(user.id, "autonomy", enabled ? `Автоподача включена: Match ≥ ${min}%` : "Автоподача выключена: агент подаёт только на вакансии, отмеченные тобой");
  revalidatePath("/app", "layout");
  return { ok: true, enabled, min };
}
