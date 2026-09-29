import "server-only";
// Exception-queue mechanics shared by the approvals screen (resolveApproval) and the Agent screen (saveAutonomy).
import { db, j, s } from "../db";
import { agentMaySubmit, readAutonomy, type Autonomy } from "./autonomy";
import { dailyUsage, logEvent, settleSharedAnswers, submit, STANDING_KINDS } from "./agent";
import { startOfToday } from "../time";
import { count } from "../ru";
import type { Answer } from "./personalize";

/** Replace the matching screening answer inside ApplicationPackage.answers (matched by question text). */
export async function patchPackageAnswer(opportunityId: string, question: string, answer: string, status: Answer["status"] = "approved") {
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
 * After a question of `opportunityId` was answered: when nothing blocking is left, continue with the same rule as the
 * agent cycle — consent (campaign.autoSubmit) + an active, unexpired campaign + the role is allowed (Apply/Auto, or
 * auto-apply on and Match ≥ threshold) + the campaign's daily limit, counted like runTick: a role prepared today already
 * holds its slot; an older one needs a free slot today. Otherwise the package stays prepared (the next cycle sends it).
 */
export async function continueIfReady(opportunityId: string, autonomy: Pick<Autonomy, "submitApplications" | "autoApplyMinMatch">) {
  const opp = await db.opportunity.findUnique({ where: { id: opportunityId }, include: { campaign: true } });
  if (!opp) return false;
  const left = await db.approval.count({ where: { opportunityId, status: "pending", kind: { not: "handoff" } } });
  const live = opp.campaign.status === "active" && (!opp.campaign.endsAt || opp.campaign.endsAt > new Date());
  if (left || opp.status !== "prepared" || !opp.campaign.autoSubmit || !live || !agentMaySubmit(opp, autonomy)) return false;
  const since = startOfToday();
  if (opp.updatedAt < since && (await dailyUsage(opp.campaignId, since)) >= opp.campaign.dailyLimit) return false;
  return (await submit(opportunityId)).ok;
}

/**
 * Answer every OTHER pending copy of a standing question (sensitive / legal / sponsorship) for this user with the same
 * answer — each approval row, each package answer — and let each affected opportunity continue (continueIfReady).
 * `question` omitted = every pending question of that kind (used when Sensitive switches to «Предпочитаю не указывать»).
 * Packages waiting on the same question without a card of their own (settleSharedAnswers) take the answer as well.
 * Returns how many copies were answered (approval rows + such packages).
 */
export async function answerMatchingApprovals(
  userId: string,
  opts: { kind: string; question?: string; answer: string; status?: "approved" | "edited"; excludeId?: string },
) {
  if (!STANDING_KINDS.has(opts.kind)) return 0;
  const answer = opts.answer.slice(0, 2000);
  const rows = await db.approval.findMany({
    where: { userId, status: "pending", kind: opts.kind, ...(opts.question ? { question: opts.question } : {}), ...(opts.excludeId ? { id: { not: opts.excludeId } } : {}) },
    select: { id: true, question: true, opportunityId: true },
  });
  const touched = new Set<string>();
  let n = 0;
  for (const r of rows) {
    // Conditional: a concurrent resolve of the same row wins, this one skips it.
    const won = await db.approval.updateMany({ where: { id: r.id, status: "pending" }, data: { status: opts.status ?? "approved", answer, resolvedAt: new Date() } });
    if (!won.count) continue;
    n++;
    if (r.opportunityId) {
      await patchPackageAnswer(r.opportunityId, r.question, answer, "approved");
      touched.add(r.opportunityId);
    }
  }
  // Packages that asked the same question without a card of their own (one card per question) take the answer too;
  // each counts as one more answered copy.
  for (const id of await settleSharedAnswers(userId)) { touched.add(id); n++; }
  if (!n) return 0;
  const user = await db.user.findUnique({ where: { id: userId }, select: { autonomy: true } });
  const autonomy = readAutonomy(user?.autonomy);
  let sent = 0;
  for (const id of touched) if (await continueIfReady(id, autonomy)) sent++;
  await logEvent(userId, "approval", `Тот же ответ применён ещё к ${count(n, ["вопросу", "вопросам", "вопросам"])}${sent ? `, отправлено заявок: ${sent}` : ""}`, null, { kind: opts.kind, answered: n, submitted: sent });
  return n;
}
