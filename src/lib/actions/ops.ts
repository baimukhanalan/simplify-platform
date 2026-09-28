"use server";
// Agent C — mutations for the campaign operating screens (pipeline, approvals, inbox, opportunity detail).
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, j, s, noNul } from "../db";
import { PIPELINE, APPLIED_OR_LATER } from "../engine/taxonomy";
import { ingestEmail, logEvent, submit } from "../engine/agent";
import { agentMaySubmit, readAutonomy } from "../engine/autonomy";
import type { Answer } from "../engine/personalize";

const MOVABLE = new Set([...PIPELINE.map((p) => p.key), "skipped"]);

const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

function refresh(opportunityId?: string | null) {
  revalidatePath("/app", "layout");
  if (opportunityId) revalidatePath(`/app/opportunities/${opportunityId}`);
}

/** Manual pipeline move (kanban card menu, detail page). Logs a status_change event for the Audit Trail. */
export async function setOpportunityStatus(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const status = str(form, "status");
  if (!MOVABLE.has(status)) return;
  const opp = await db.opportunity.findFirst({ where: { id, campaign: { userId: user.id } }, include: { job: { select: { title: true, company: true } } } });
  if (!opp || opp.status === status) return;
  const becameApplied = APPLIED_OR_LATER.includes(status) && !opp.submittedAt;
  await db.opportunity.update({ where: { id }, data: { status, ...(becameApplied ? { submittedAt: new Date() } : {}) } });
  // A skipped vacancy must not keep questions in the exception queue; an application sent outside the agent closes its handoff.
  if (status === "skipped") await db.approval.updateMany({ where: { opportunityId: id, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
  if (becameApplied) await db.approval.updateMany({ where: { opportunityId: id, status: "pending", kind: "handoff" }, data: { status: "approved", answer: "submitted-by-user", resolvedAt: new Date() } });
  const from = opp.status;
  await logEvent(user.id, "status_change", `${opp.job.company}: ${from} → ${status} (вручную)`, id, { from, to: status, by: "user" });
  refresh(id);
}

/** Replace the matching screening answer inside ApplicationPackage.answers (matched by question text). */
async function patchAnswer(opportunityId: string, question: string, answer: string, status: Answer["status"]) {
  const pkg = await db.applicationPackage.findUnique({ where: { opportunityId } });
  if (!pkg) return;
  const answers = j<Answer[]>(pkg.answers, []);
  let hit = false;
  const next = answers.map((a) => {
    if (a.q.trim() !== question.trim()) return a;
    hit = true;
    return { ...a, a: answer, status };
  });
  if (hit) await db.applicationPackage.update({ where: { opportunityId }, data: { answers: s(next) } });
}

/**
 * Resolve one exception-queue item.
 * decision=approve → use the proposed answer; decision=edit → use the typed answer; decision=reject → skip the vacancy.
 * When the last blocking question of a prepared opportunity is resolved and the agent may submit it (agentMaySubmit),
 * the agent continues: a demo vacancy is submitted through the simulated ATS; a live vacancy gets a handoff item.
 */
export async function resolveApproval(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const decision = str(form, "decision");
  const approval = await db.approval.findFirst({ where: { id, userId: user.id, status: "pending" }, include: { opportunity: { include: { job: true, campaign: true } } } });
  if (!approval || approval.kind === "handoff" || !["approve", "edit", "reject"].includes(decision)) return;
  const opp = approval.opportunity;
  // Ownership of the linked opportunity is re-checked through its campaign, not just the approval row.
  if (opp && opp.campaign.userId !== user.id) return;

  if (decision === "reject") {
    await db.approval.update({ where: { id }, data: { status: "rejected", resolvedAt: new Date() } });
    if (opp) {
      await db.approval.updateMany({ where: { opportunityId: opp.id, status: "pending" }, data: { status: "rejected", resolvedAt: new Date() } });
      if (!APPLIED_OR_LATER.includes(opp.status)) await db.opportunity.update({ where: { id: opp.id }, data: { status: "skipped" } });
      await logEvent(user.id, "approval", `Отклонено: «${approval.question}» — ${opp.job.company} пропущена`, opp.id, { kind: approval.kind, decision });
    }
    refresh(opp?.id);
    return;
  }

  const answer = decision === "edit" ? str(form, "answer") : approval.proposed.trim();
  if (!answer) return; // nothing to approve — the form requires a value, this is a server-side guard
  await db.approval.update({ where: { id }, data: { status: decision === "edit" ? "edited" : "approved", answer: answer.slice(0, 2000), resolvedAt: new Date() } });
  if (opp) {
    await patchAnswer(opp.id, approval.question, answer.slice(0, 2000), "approved");
    await logEvent(user.id, "approval", `Подтверждено: «${approval.question}» — ${opp.job.company}`, opp.id, { kind: approval.kind, decision, answer });
    const left = await db.approval.count({ where: { opportunityId: opp.id, status: "pending", kind: { not: "handoff" } } });
    // Same rule as the agent cycle: consent (campaign.autoSubmit) + an active, unexpired campaign + the role is allowed
    // (Apply/Auto, or auto-apply on and Match ≥ threshold). Otherwise the package stays prepared for the user to decide.
    const live = opp.campaign.status === "active" && (!opp.campaign.endsAt || opp.campaign.endsAt > new Date());
    if (!left && opp.status === "prepared" && opp.campaign.autoSubmit && live && agentMaySubmit(opp, readAutonomy(user.autonomy))) await submit(opp.id);
  }
  refresh(opp?.id);
}

/** Live vacancy: the user submitted the package through the official form themselves. */
export async function confirmUserSubmitted(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id"); // opportunity id
  const opp = await db.opportunity.findFirst({ where: { id, campaign: { userId: user.id } }, include: { pkg: { select: { id: true } } } });
  if (!opp || !opp.pkg || APPLIED_OR_LATER.includes(opp.status)) return;
  const open = await db.approval.count({ where: { opportunityId: id, status: "pending", kind: { not: "handoff" } } });
  if (open) return; // sensitive questions must be answered first
  await submit(id, "user");
  await db.approval.updateMany({ where: { opportunityId: id, kind: "handoff", status: "pending" }, data: { status: "approved", answer: "submitted-by-user", resolvedAt: new Date() } });
  refresh(id);
}

export type IngestState = {
  error?: string;
  fields?: { from: string; subject: string; body: string };
  result?: {
    classification: string;
    confidence: number;
    deadline: string | null;
    company: string | null;
    title: string | null;
    opportunityId: string | null;
    before: string | null;
    after: string | null;
    updated: boolean;
  };
};

/** Paste an employer email → Inbox Intelligence classifies it and moves the pipeline. */
export async function ingestPastedEmail(_prev: IngestState, form: FormData): Promise<IngestState> {
  const user = await requireUser();
  const fields = { from: noNul(str(form, "from")).slice(0, 200), subject: noNul(str(form, "subject")).slice(0, 300), body: noNul(str(form, "body")).slice(0, 20000) };
  if (!fields.subject && !fields.body) return { error: "Вставьте хотя бы тему или текст письма.", fields };
  if (fields.body.length < 20) return { error: "Текст письма слишком короткий для классификации — вставьте письмо целиком.", fields };
  const from = fields.from || "unknown@employer";
  const before = new Map(
    (await db.opportunity.findMany({ where: { campaign: { userId: user.id }, status: { in: APPLIED_OR_LATER } }, select: { id: true, status: true } })).map((o) => [o.id, o.status]),
  );
  const { message, updated } = await ingestEmail(user.id, { from, subject: fields.subject || "(без темы)", body: fields.body });
  let company: string | null = null, title: string | null = null, after: string | null = null;
  if (message.opportunityId) {
    const opp = await db.opportunity.findUnique({ where: { id: message.opportunityId }, include: { job: { select: { company: true, title: true } } } });
    company = opp?.job.company ?? null;
    title = opp?.job.title ?? null;
    after = opp?.status ?? null;
  }
  refresh(message.opportunityId);
  return {
    result: {
      classification: message.classification,
      confidence: message.confidence,
      deadline: message.deadline ? message.deadline.toISOString() : null,
      company, title,
      opportunityId: message.opportunityId,
      before: message.opportunityId ? before.get(message.opportunityId) ?? null : null,
      after,
      updated,
    },
  };
}
