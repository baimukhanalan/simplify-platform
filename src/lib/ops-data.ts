// Agent C — shared read-side queries for the campaign operating screens.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { agentMaySubmit, readAutonomy, type Autonomy } from "./engine/autonomy";
import { agentQueue, dailyUsage, hasOpenAnswers } from "./engine/agent";
import { FICTIONAL_SOURCE, isSimulation } from "./mode";
import { DREAM_DECISION } from "./engine/matching";
import { reachedInterview } from "./engine/insights";
import { settleGuarantees } from "./engine/guarantee";
import { APPLIED_OR_LATER, roleKey } from "./engine/taxonomy";
import { startOfToday } from "./time";
import { count } from "./ru";
import { isPushHiddenOn, PUSH_EXCLUDED_ROUTES } from "./push";

/** Active/paused but past endsAt: over, even if no agent cycle has written status="expired" yet (e.g. while paused). */
export const isOverdue = (c: { status: string; endsAt: Date | null }, now = new Date()) =>
  (c.status === "active" || c.status === "paused") && c.endsAt != null && c.endsAt <= now;

/** The campaign the operating screens show: the latest non-draft one (active, paused, hired or expired). */
export async function currentCampaign(userId: string) {
  let c = await db.campaign.findFirst({ where: { userId, status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
  // Interview guarantee first (src/lib/engine/guarantee.ts): an overdue campaign without interviews is extended, not over.
  // Re-read even when this call didn't win the extension: a concurrent caller (the layout, a tick) may have.
  if (c && isOverdue(c) && c.guaranteeStatus === "") { await settleGuarantees(userId); c = await db.campaign.findUnique({ where: { id: c.id } }); }
  // Show a campaign that ran out by date as expired right away; the next agent cycle persists it.
  return c && isOverdue(c) ? { ...c, status: "expired" } : c;
}

/** Prisma filter for a campaign the agent can still work on: active or paused, and not past its end date. */
export const runningCampaignWhere = (now = new Date()) => ({ status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

/** The campaign the agent can still work on (active or paused, and not past its end date). */
export async function runningCampaign(userId: string) {
  // An overdue campaign the interview guarantee is about to extend counts as running (settleGuarantees is a no-op otherwise).
  await settleGuarantees(userId);
  return db.campaign.findFirst({ where: { userId, ...runningCampaignWhere() }, orderBy: { createdAt: "desc" } });
}

/**
 * The exception queue that still matters: only items of the running campaign. Questions of a finished (HIRED / expired)
 * campaign are closed when it ends; this filter also hides any left over from before that rule or from a campaign that
 * ran out by date while nothing ticked it. Holds both questions and handoffs — the approvals screen and the nav badge.
 */
export const pendingQueueWhere = (userId: string, now = new Date()) => ({
  userId,
  status: "pending",
  // Simulation mode: questions / handoffs of live-feed roles stay as they are, out of sight (visibleScope).
  opportunity: { campaign: { userId, ...runningCampaignWhere(now) }, ...visibleScope() },
});

/** Pending questions only (no handoffs): "N вопросов ждут твоего ответа". */
export const pendingApprovalsWhere = (userId: string, now = new Date()) => ({ ...pendingQueueWhere(userId, now), kind: { not: "handoff" } });

/** Pending handoffs only: live roles whose package is ready and waits for the user to send it — "N заявок ждут отправки". */
export const pendingHandoffsWhere = (userId: string, now = new Date()) => ({ ...pendingQueueWhere(userId, now), kind: "handoff" });

export function pendingApprovalsCount(userId: string) {
  return db.approval.count({ where: pendingApprovalsWhere(userId) });
}

export function pendingHandoffsCount(userId: string) {
  return db.approval.count({ where: pendingHandoffsWhere(userId) });
}

/** Everything in the exception queue (questions + handoffs): the nav badge of «Подтверждения». */
export function pendingQueueCount(userId: string) {
  return db.approval.count({ where: pendingQueueWhere(userId) });
}

/**
 * Simulation mode: an Opportunity filter that keeps the internal corpus only (live-feed vacancies are never listed or
 * counted, src/lib/mode.ts). Spread into a `where` that has no `job` key of its own. Live mode: nothing.
 */
export const visibleScope = (): { job?: { source: string } } => (isSimulation() ? { job: { source: FICTIONAL_SOURCE } } : {});

/** The same scope for rows that may point at an opportunity (events, inbox messages): unlinked rows always show. */
export const visibleLinkedScope = () => (isSimulation() ? { OR: [{ opportunityId: null }, { opportunity: { job: { source: FICTIONAL_SOURCE } } }] } : {});

/** The same scope for Interview rows (always linked to an opportunity). Spread into a `where` without its own `opportunity`. */
export const visibleInterviewScope = (): { opportunity?: { job: { source: string } } } => (isSimulation() ? { opportunity: visibleScope() as { job: { source: string } } } : {});

// ——— "Today" numbers (Today, Opportunities and Career use the same window and the same definitions) ———

/** Match from which a found role counts as "подошла" (fits). Defined in the engine so event texts use it too. */
export { STRONG_MATCH } from "./engine/matching";
import { STRONG_MATCH } from "./engine/matching";

/**
 * THE definition of "подошли / qualified", everywhere (Today key numbers, the "Сегодня" strip, the Opportunities
 * header and its tab, via qualifiedWhere): not blocked, not skipped, Match ≥ STRONG_MATCH — whatever happened to it since
 * (prepared, sent, interview…). A role sent and later rejected still "подошла".
 */
export const isQualified = (o: { status: string; eligibility: string; match: number }) =>
  o.status !== "skipped" && o.eligibility !== "blocked" && o.match >= STRONG_MATCH;

/** Prisma twin of isQualified. `since` limits it to roles found in the window (null = the whole campaign). */
export const qualifiedWhere = (campaignId: string, since: Date | null = null) => ({
  campaignId,
  ...visibleScope(),
  ...(since ? { createdAt: { gte: since } } : {}),
  status: { not: "skipped" },
  eligibility: { not: "blocked" },
  match: { gte: STRONG_MATCH },
});

/** "Подошли" for a window (null = the whole campaign). The one function every screen uses for that number. */
export function qualifiedCount(campaignId: string, since: Date | null = null) {
  return db.opportunity.count({ where: qualifiedWhere(campaignId, since) });
}

/** Strong = qualified and at or above the auto-apply threshold. */
export const strongWhere = (campaignId: string, since: Date | null, threshold: number) => {
  const q = qualifiedWhere(campaignId, since);
  return { ...q, match: { gte: Math.max(STRONG_MATCH, threshold) } };
};

/** An interview round was reached: an interview status, offer/hired, or at least one non-assessment Interview row. Assessments never count. */
export const reachedInterviewRound = (o: { status: string; interviews: { round: string }[] }) =>
  reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length);

/** An assessment was received (status or an assessment Interview row). Counted separately from interviews. */
export const reachedAssessment = (o: { status: string; interviews: { round: string }[] }) =>
  o.status === "assessment" || o.interviews.some((i) => i.round === "assessment");

/**
 * Counts for one window of a campaign. `since` is startOfToday() (src/lib/time.ts) for "Сегодня";
 * null = the whole campaign. found = everything discovered; qualified = isQualified (the one definition);
 * strong = qualified and Match ≥ the auto-apply threshold; submitted = applications sent in the window.
 * `fit` is the old name of `qualified`, kept for callers not yet renamed.
 */
export async function windowNumbers(campaignId: string, since: Date | null, threshold: number) {
  const created = since ? { createdAt: { gte: since } } : {};
  const [found, qualified, strong, submitted] = await Promise.all([
    db.opportunity.count({ where: { campaignId, ...visibleScope(), ...created } }),
    qualifiedCount(campaignId, since),
    db.opportunity.count({ where: strongWhere(campaignId, since, threshold) }),
    db.opportunity.count({ where: { campaignId, ...visibleScope(), submittedAt: since ? { gte: since } : { not: null } } }),
  ]);
  return { found, qualified, fit: qualified, strong, submitted };
}

// ——— "Queued: will apply in the next cycle" ———

/**
 * Why a role that fits is NOT in the next cycle's send queue — one reason per opportunity, for the Opportunities cards:
 *   inactive       campaign paused / finished
 *   no-consent     auto-submit consent is off (Privacy)
 *   off-goal       not one of the goal's roles — the agent takes it only after the user's Apply
 *   stale          posted over 30 days ago — the agent takes it only after the user's Apply
 *   user-skip      the user pressed Skip
 *   duplicate      the same role at the same company is already prepared or sent from another location
 *   needs-answers  the package waits for the user's answer to a question
 *   auto-apply-off auto-apply is off and the user hasn't pressed Apply
 *   below-threshold Match below the auto-apply threshold and the user hasn't pressed Apply
 *   no-personalize CV personalization is off, so no package gets built
 *   handoff        a live vacancy: the agent prepares it, the user sends it through the official form
 *   daily-limit    today's (or the next day's) limit is taken by roles ranked higher
 */
export type NotQueuedReason =
  | "inactive" | "no-consent" | "off-goal" | "stale" | "user-skip" | "duplicate" | "needs-answers"
  | "auto-apply-off" | "below-threshold" | "no-personalize" | "handoff" | "daily-limit" | "dream-decision";

export const NOT_QUEUED_LABEL: Record<NotQueuedReason, string> = {
  inactive: "Кампания не активна — агент сейчас не подаёт",
  "no-consent": "Автоотправка выключена в настройках приватности",
  "off-goal": "Роль вне цели — агент подаст на неё только после Apply или Auto",
  stale: "Вакансия старше 30 дней — агент подаст на неё только после Apply или Auto",
  "user-skip": "Отмечено «Пропустить» — агент не подаёт",
  duplicate: "На эту роль в компании уже есть заявка из другой локации",
  "needs-answers": "Ждёт твоего ответа на вопрос работодателя",
  "auto-apply-off": "Автоподача выключена — нажми Apply или Auto",
  "below-threshold": "Match ниже порога автоподачи — нажми Apply или Auto",
  "no-personalize": "Персонализация CV выключена — пакет не готовится",
  handoff: "Живая вакансия: агент готовит пакет, отправляешь ты через официальную форму",
  "daily-limit": "Дневной лимит занят ролями с более высоким приоритетом — агент вернётся к ней в следующем цикле",
  "dream-decision": "Компания мечты, но уровень не совпадает с целью — реши сам: Apply или Skip",
};

/**
 * Reasons that mean «the next move is the user's Apply / Auto / Skip». Stale (> 30 days) and off-goal roles are here too:
 * the agent takes them only after the user's Apply, so they wait for a decision exactly like below-threshold ones.
 */
export const APPLY_DECISION_REASONS: ReadonlySet<NotQueuedReason> = new Set(["auto-apply-off", "below-threshold", "no-consent", "dream-decision", "stale", "off-goal"]);

/** Statuses of a role that can still wait for the user's decision (not sent, not skipped). */
export const AWAITING_DECISION_STATUSES = ["found", "qualified", "prepared"] as const;

/** Ids of the roles that wait for the user's decision, from one nextCycleQueue run (APPLY_DECISION_REASONS). */
export const awaitingDecisionIds = (queue: Pick<NextCycle, "notQueued">) =>
  Object.entries(queue.notQueued).filter(([, r]) => APPLY_DECISION_REASONS.has(r)).map(([id]) => id);

/**
 * The part of nextCycleQueue's reasoning that decides «ждёт решения», as data (no id lists): which rule applied to the
 * whole campaign, the autonomy knobs the per-role permission depends on, and the few roles of the agent's own
 * preparation window (≤ 2 × daily limit) that the rule would call waiting but the cycle holds for another reason
 * (daily limit, duplicate of a role already taken). awaitingDecisionWhere turns it into a relational filter.
 */
export type AwaitingRule =
  | { kind: "none" }
  | { kind: "no-consent" }
  | { kind: "agent"; submitApplications: boolean; autoApplyMinMatch: number; personalizeCv: boolean; held: string[] };

/** A package with an answer still waiting for the user (hasOpenAnswers), as a string filter on the stored JSON. */
const OPEN_ANSWER = '"status":"pending"';

/**
 * Prisma twin of agentMaySubmit(o, autonomy) === false for a role the user did not skip, with Match at or above `min`
 * (one `match` filter: spreading two would silently keep only the last).
 */
const deniedWhere = (r: { submitApplications: boolean; autoApplyMinMatch: number }, min?: number): Prisma.OpportunityWhereInput => {
  const match = { ...(min != null ? { gte: min } : {}), ...(r.submitApplications ? { lt: r.autoApplyMinMatch } : {}) };
  return { decision: { notIn: ["apply", "auto", "skip"] }, ...(Object.keys(match).length ? { match } : {}) };
};

/**
 * THE definition of «Ждут решения»: the Opportunities tab (its list and its counter) and needsYou.applyDecisions (Today,
 * nav, Inbox, the agent-cycle line) all use this filter, so the tab never shows a role the count leaves out.
 * `queue` = nextCycleQueue(campaign, autonomy) for the same campaign; an inactive campaign has nothing waiting (queue null).
 *
 * A pure relational filter — the same reasons nextCycleQueue gives (APPLY_DECISION_REASONS), expressed on status, Match,
 * decision, eligibility, freshness-derived status and visibility — so it stays one small query for any number of roles
 * (a list of every waiting id overflowed the bind-parameter limit: Prisma P2029 on SQLite at ~30k roles).
 */
export const awaitingDecisionWhere = (campaignId: string, queue: Pick<NextCycle, "awaiting"> | null): Prisma.OpportunityWhereInput => {
  const rule = queue?.awaiting ?? { kind: "none" as const };
  // Simulation mode: the agent decides every role itself — nothing ever waits for the user's Apply.
  if (rule.kind === "none" || isSimulation()) return { campaignId, id: { in: [] } };
  const scope = { campaignId, ...visibleScope(), eligibility: { not: "blocked" }, decision: { not: "skip" } };
  // Consent off: every fitting role waits (nextCycleQueue explains them all as "no-consent").
  if (rule.kind === "no-consent") return { ...scope, AND: [{ OR: fittingOr }] };
  const or: Prisma.OpportunityWhereInput[] = [
    // "stale" / "off-goal": a strong role the agent never takes on its own (older than 30 days or outside the goal).
    { status: "found", match: { gte: STRONG_MATCH } },
    // "dream-decision": a dream company on another level — the user's call whatever the Match.
    { status: "qualified", softGaps: { contains: DREAM_DECISION }, decision: { notIn: ["apply", "auto", "skip"] } },
    // "auto-apply-off" / "below-threshold" on a prepared package with nothing else open.
    { status: "prepared", approvals: { none: { status: "pending" } }, NOT: { pkg: { answers: { contains: OPEN_ANSWER } } }, ...deniedWhere(rule) },
    // The same for a strong qualified role (only when the agent personalizes: otherwise it is "no-personalize").
    ...(rule.personalizeCv ? [{ status: "qualified", ...deniedWhere(rule, STRONG_MATCH) }] : []),
  ];
  return { ...scope, AND: [{ OR: or }, ...(rule.held.length ? [{ id: { notIn: rule.held } }] : [])] };
};

/** Prisma twin of the `fitting` set of nextCycleQueue (not blocked, open, strong or a dream-company decision). */
const fittingOr: Prisma.OpportunityWhereInput[] = [
  { status: { in: [...AWAITING_DECISION_STATUSES] }, match: { gte: STRONG_MATCH } },
  { status: "qualified", softGaps: { contains: DREAM_DECISION } },
];

export type NextCycle = {
  /** Opportunity ids the next agent cycle would submit on its own (internal-corpus roles; live roles become handoffs instead). */
  ids: string[];
  /** "now" = the next cycle today still has room; "tomorrow" = today's daily limit is used up; null = the agent will not submit (see reason). */
  when: "now" | "tomorrow" | null;
  reason: "ok" | "inactive" | "no-consent" | "no-personalize";
  /** Slots left today under the plan's daily limit (applications sent + packages prepared today count). */
  left: number;
  dailyLimit: number;
  /** For every fitting role (isQualified, not sent) that is NOT in `ids`: why not. Keyed by opportunity id. */
  notQueued: Record<string, NotQueuedReason>;
  /** The same as `notQueued`, as the Russian line for the card (NOT_QUEUED_LABEL). */
  reasons: Record<string, string>;
  /** «Ждут решения» as a rule for awaitingDecisionWhere (no id lists). */
  awaiting: AwaitingRule;
};

const STALE_DAYS = 30;

/**
 * Mirrors runTick (src/lib/engine/agent.ts) without writing anything: which waiting roles the next cycle would send,
 * under agentMaySubmit + the daily limit + one application per role. New finds of that cycle can still outrank these,
 * so the UI should say "в очереди на следующий цикл", not promise a time. `notQueued` explains every other fitting role.
 */
export async function nextCycleQueue(
  campaign: { id: string; status: string; autoSubmit: boolean; dailyLimit: number },
  autonomy: Pick<Autonomy, "submitApplications" | "autoApplyMinMatch" | "personalizeCv">,
): Promise<NextCycle> {
  // Every fitting role not sent yet — the cards the user sees as "waiting".
  // Dream-company decisions (DREAM_DECISION) are the user's call whatever their Match, so they are listed too.
  const fitting = await db.opportunity.findMany({
    where: { campaignId: campaign.id, ...visibleScope(), status: { in: ["found", "qualified", "prepared"] }, eligibility: { not: "blocked" }, OR: [{ match: { gte: STRONG_MATCH } }, { status: "qualified", softGaps: { contains: DREAM_DECISION } }] },
    select: { id: true, status: true, decision: true, match: true, softGaps: true, job: { select: { source: true, postedAt: true } }, pkg: { select: { answers: true } }, approvals: { where: { status: "pending" }, select: { kind: true } } },
  });
  const notQueued: Record<string, NotQueuedReason> = {};
  const explainAll = (r: NotQueuedReason) => { for (const o of fitting) notQueued[o.id] = r; };
  const base = { ids: [] as string[], dailyLimit: campaign.dailyLimit };
  const labels = () => Object.fromEntries(Object.entries(notQueued).map(([id, r]) => [id, NOT_QUEUED_LABEL[r]]));
  if (campaign.status !== "active") { explainAll("inactive"); return { ...base, when: null, reason: "inactive", left: 0, notQueued, reasons: labels(), awaiting: { kind: "none" } }; }
  const since = startOfToday();
  const used = await dailyUsage(campaign.id, since);
  const left = Math.max(0, campaign.dailyLimit - used);
  if (!campaign.autoSubmit) { explainAll("no-consent"); return { ...base, when: null, reason: "no-consent", left, notQueued, reasons: labels(), awaiting: { kind: "no-consent" } }; }
  const when = left > 0 ? "now" : "tomorrow";
  let budget = left > 0 ? left : campaign.dailyLimit;
  const ids: string[] = [];
  const takenRows = await db.opportunity.findMany({ where: { campaignId: campaign.id, status: { in: ["prepared", ...APPLIED_OR_LATER] } }, select: { id: true, job: { select: { company: true, title: true } } } });
  const taken = new Set(takenRows.map((o) => roleKey(o.job.company, o.job.title)));
  const why = (id: string, r: NotQueuedReason) => { notQueued[id] ??= r; };
  const permission = (o: { decision: string; match: number }): NotQueuedReason | null =>
    agentMaySubmit(o, autonomy) ? null : o.decision === "skip" ? "user-skip" : !autonomy.submitApplications ? "auto-apply-off" : "below-threshold";

  const ready = await db.opportunity.findMany({
    where: { campaignId: campaign.id, ...visibleScope(), status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } },
    orderBy: [{ decision: "desc" }, { priority: "desc" }],
    select: { id: true, decision: true, match: true, updatedAt: true, job: { select: { source: true } }, pkg: { select: { answers: true } } },
  });
  for (const o of ready) {
    // Waits for a standing answer asked on another role (one card for the same question): not sendable yet.
    if (hasOpenAnswers(o.pkg?.answers)) { why(o.id, "needs-answers"); continue; }
    const denied = permission(o);
    if (denied) { why(o.id, denied); continue; }
    const counted = when === "now" && o.updatedAt >= since;
    if (!counted && budget <= 0) { why(o.id, "daily-limit"); continue; }
    if (!counted) budget--;
    if (o.job.source === FICTIONAL_SOURCE) ids.push(o.id); else why(o.id, "handoff");
  }
  // The agent's own preparation window (≤ 2 × budget roles): the only place a role the relational «ждёт решения» rule
  // would list can be held for another reason (daily limit, duplicate) — awaitingDecisionWhere leaves these out.
  const windowIds: string[] = [];
  if (autonomy.personalizeCv && budget > 0) {
    const queue = await agentQueue(campaign.id, budget);
    windowIds.push(...queue.map((o) => o.id));
    let prepared = 0;
    for (const o of queue) {
      if (prepared >= budget) { why(o.id, "daily-limit"); continue; }
      const key = roleKey(o.job.company, o.job.title);
      if (taken.has(key)) { why(o.id, "duplicate"); continue; } // prepare() would set this duplicate aside
      taken.add(key);
      prepared++;
      const denied = permission(o);
      if (denied) why(o.id, denied);
      else if (o.job.source === FICTIONAL_SOURCE) ids.push(o.id);
      else why(o.id, "handoff");
    }
  }

  // Everything else that fits gets its reason too (in the order runTick would hit it).
  const queued = new Set(ids);
  const now = Date.now();
  for (const o of fitting) {
    if (queued.has(o.id) || notQueued[o.id]) continue;
    if (o.decision === "skip") why(o.id, "user-skip");
    else if (o.status === "found") why(o.id, (now - o.job.postedAt.getTime()) / 86400000 > STALE_DAYS ? "stale" : "off-goal");
    else if (o.status === "prepared" && (o.approvals.some((a) => a.kind !== "handoff") || hasOpenAnswers(o.pkg?.answers))) why(o.id, "needs-answers");
    else if (o.status === "qualified" && o.softGaps.includes(DREAM_DECISION) && o.decision !== "apply" && o.decision !== "auto") why(o.id, "dream-decision");
    else if (o.status === "prepared" && o.approvals.length) why(o.id, "handoff");
    else if (o.status === "qualified" && !autonomy.personalizeCv) why(o.id, "no-personalize");
    else why(o.id, permission(o) ?? "daily-limit");
  }
  for (const id of Object.keys(notQueued)) if (queued.has(id)) delete notQueued[id];
  const reason = !autonomy.personalizeCv && !ids.length ? "no-personalize" : "ok";
  const held = windowIds.filter((id) => !APPLY_DECISION_REASONS.has(notQueued[id]));
  const awaiting: AwaitingRule = { kind: "agent", submitApplications: autonomy.submitApplications, autoApplyMinMatch: autonomy.autoApplyMinMatch, personalizeCv: autonomy.personalizeCv, held };
  return { ids, when, reason, left, dailyLimit: campaign.dailyLimit, notQueued, reasons: labels(), awaiting };
}

// ——— Interview counts: one definition for Today (stage «Интервью»), the nav badge, Applications and Interviews ———

/**
 * An upcoming interview ROUND (not an assessment): status "upcoming" and scheduled in the future. A round whose time
 * has passed but still waits for «Как прошло?» is not upcoming any more (it counts as completed).
 */
export const upcomingRoundWhere = (userId: string, now = new Date()) => ({ userId, status: "upcoming", round: { not: "assessment" }, scheduledAt: { gte: now }, ...visibleInterviewScope() });

/** An open assessment: status "upcoming" and its deadline not passed (no deadline = open). */
export const openAssessmentWhere = (userId: string, now = new Date()) => ({ userId, status: "upcoming", round: "assessment", OR: [{ scheduledAt: null }, { scheduledAt: { gte: now } }], ...visibleInterviewScope() });

/** Interview rows whose campaign did not end with HIRED. */
const NOT_HIRED_CAMPAIGN = { campaign: { status: { not: "hired" } } };

export type InterviewCounts = {
  /** Interview rounds scheduled in the future, not done (upcomingRoundWhere). The nav badge. */
  upcoming: number;
  /** Applications with at least one upcoming round: «в процессе» (Applications column, Today's stage). 0 = nothing in process. */
  activeRounds: number;
  /** Rounds that took place: done / passed / failed, or their time has passed (a debrief may still be due). */
  completed: number;
  /** Past rounds still marked upcoming: they wait for «Как прошло?» (part of `completed`). */
  awaitingDebrief: number;
  /** Open assessments (deadline not passed). Counted apart from interviews. */
  assessments: number;
};

/** THE interview numbers. «В процессе» only when a future round exists — never for a round that already happened. */
export async function interviewCounts(userId: string, now = new Date()): Promise<InterviewCounts> {
  const [upcoming, active, finished, awaitingDebrief, assessments] = await Promise.all([
    db.interview.count({ where: upcomingRoundWhere(userId, now) }),
    db.interview.findMany({ where: upcomingRoundWhere(userId, now), select: { opportunityId: true }, distinct: ["opportunityId"] }),
    db.interview.count({ where: { userId, round: { not: "assessment" }, status: { in: ["done", "passed", "failed"] }, ...visibleInterviewScope() } }),
    db.interview.count({ where: { userId, round: { not: "assessment" }, status: "upcoming", scheduledAt: { lt: now }, ...visibleInterviewScope() } }),
    db.interview.count({ where: openAssessmentWhere(userId, now) }),
  ]);
  return { upcoming, activeRounds: active.length, completed: finished + awaitingDebrief, awaitingDebrief, assessments };
}

// ——— «Нужно тебе»: one source for every screen and the agent-cycle line ———

export type NeedsYou = {
  /** Open employer questions (the approvals screen, no handoffs). */
  questions: number;
  /** Live roles whose package is ready and waits for the user to send it through the official form. */
  handoffs: number;
  /** Roles waiting for the user's Apply / Auto / Skip: awaitingDecisionWhere — the same filter as the «Ждут решения» tab. */
  applyDecisions: number;
  /** Offers received or in negotiation. */
  offer: number;
  /** Interview rounds (not assessments) in the next 48 hours. */
  interviews48h: number;
  /** Assessments still open (deadline not passed). Simulation mode: 0 — they progress on their own (info only, Interviews). */
  assessments: number;
  /** Simulation mode: 1 when the running campaign is active but the auto-submit consent is off — the agent can't send anything
   * until the user switches it on in Settings («Включи автоподачу в настройках»). Always 0 in live mode (there the roles
   * show up as Apply decisions instead). */
  enableAutoSubmit: number;
  /** Sum of everything above. */
  total: number;
};

/** needsYou for a known campaign (runTick passes its own; `campaign` null = no running campaign → only offers and rounds). */
export async function needsYouFor(
  campaign: { id: string; status: string; autoSubmit: boolean; dailyLimit: number } | null,
  userId: string,
  autonomy: Pick<Autonomy, "submitApplications" | "autoApplyMinMatch" | "personalizeCv">,
  now = new Date(),
): Promise<NeedsYou> {
  const [questions, handoffs, offer, interviews48h, assessments, queue] = await Promise.all([
    db.approval.count({ where: pendingApprovalsWhere(userId, now) }),
    db.approval.count({ where: pendingHandoffsWhere(userId, now) }),
    db.offer.count({ where: { userId, status: { in: ["received", "negotiating"] }, ...visibleLinkedScope() } }),
    // Rounds of a campaign that ended with HIRED never wait on the user (markHired also cancels them).
    db.interview.count({ where: { ...upcomingRoundWhere(userId, now), scheduledAt: { gte: now, lte: new Date(now.getTime() + 48 * 3600000) }, opportunity: { ...NOT_HIRED_CAMPAIGN, ...visibleScope() } } }),
    db.interview.count({ where: { ...openAssessmentWhere(userId, now), opportunity: { ...NOT_HIRED_CAMPAIGN, ...visibleScope() } } }),
    campaign && campaign.status === "active" ? nextCycleQueue(campaign, autonomy) : null,
  ]);
  const applyDecisions = campaign && queue ? await db.opportunity.count({ where: awaitingDecisionWhere(campaign.id, queue) }) : 0;
  // Simulation mode: only the human moments (offer, interview prep) — the agent answers every question itself, never
  // hands a role off, decides every Apply (settleSimulationChores keeps the queue empty) and assessments progress on their
  // own. The one switch only the user can flip — the auto-submit consent — is named when it is off.
  if (isSimulation()) {
    const enableAutoSubmit = campaign && campaign.status === "active" && !campaign.autoSubmit ? 1 : 0;
    return { questions: 0, handoffs: 0, applyDecisions: 0, offer, interviews48h, assessments: 0, enableAutoSubmit, total: offer + interviews48h + enableAutoSubmit };
  }
  return { questions, handoffs, applyDecisions, offer, interviews48h, assessments, enableAutoSubmit: 0, total: questions + handoffs + applyDecisions + offer + interviews48h + assessments };
}

/** What waits on the user right now: the running campaign's queue plus offers and near rounds. */
export async function needsYou(userId: string, now = new Date()): Promise<NeedsYou> {
  const [user, campaign] = await Promise.all([db.user.findUnique({ where: { id: userId }, select: { autonomy: true } }), runningCampaign(userId)]);
  return needsYouFor(campaign, userId, readAutonomy(user?.autonomy), now);
}

/**
 * The agent-cycle wording of what waits on the user: «15 вакансий ждут твоего решения в Opportunities · 2 вопроса ждут
 * твоего ответа в Подтверждениях». Empty when nothing waits (then nothing is claimed). Only the queue parts
 * (questions, handoffs, Apply decisions) — offers and rounds have their own pushes.
 */
export function needsYouLine(n: Pick<NeedsYou, "questions" | "handoffs" | "applyDecisions">) {
  return [
    n.applyDecisions ? `${count(n.applyDecisions, ["вакансия ждёт", "вакансии ждут", "вакансий ждут"])} твоего решения в Opportunities` : "",
    n.questions ? `${count(n.questions, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} твоего ответа в Подтверждениях` : "",
    n.handoffs ? `${count(n.handoffs, ["заявка ждёт", "заявки ждут", "заявок ждут"])} отправки через официальную форму` : "",
  ].filter(Boolean).join(" · ");
}

// ——— Push moments (Notification rows created by the engine's `notify`) ———

export type PushMoment = {
  id: string;
  type: string;
  title: string;
  body: string;
  company: string;
  role: string;
  when: Date | null;
  href: string;
  cta: string;
  createdAt: Date;
};

const FALLBACK_HREF: Record<string, string> = { interview: "/app/interviews", assessment: "/app/interviews", offer: "/app/offers", hired: "/app/career" };
const CTA: Record<string, string> = { interview: "Prepare", assessment: "Prepare", offer: "Посмотреть оффер", hired: "Открыть Career" };

/** Only in-app paths are ever followed from a notification. */
const safeAppHref = (href: string, type: string) => (/^\/app(\/[\w\-/]*)?$/.test(href) ? href : FALLBACK_HREF[type] ?? "/app");

/** Company as the engine writes it into the notification body ("Company · Role"; older assessment rows: "Assessment от Company"). */
function companyOf(type: string, body: string) {
  if (type === "assessment" && /^Assessment\s+от\s+/i.test(body)) return body.replace(/^Assessment\s+от\s+/i, "").trim();
  return body.split(" · ")[0]?.trim() ?? "";
}

/** Assessment notifications stored before the Russian wording: never show the raw «assessment» key. */
function legacyAssessment(n: { type: string; title: string; body: string }) {
  if (n.type !== "assessment") return n;
  return {
    ...n,
    title: n.title === "Следующий этап: assessment" ? "Новое тестовое задание" : n.title,
    body: n.body.replace(/^Assessment\s+от\s+/i, ""),
  };
}

/** Resolve where a notification leads (the concrete Interview Room when one exists) and what to show on the moment. */
export async function resolveNotification(n: { id: string; userId: string; type: string; title: string; body: string; href: string; createdAt: Date }): Promise<PushMoment> {
  const company = companyOf(n.type, n.body);
  const shown = legacyAssessment(n);
  const base: PushMoment = {
    id: n.id, type: n.type, title: shown.title, body: shown.body, company,
    role: n.body.split(" · ").slice(1).join(" · "),
    when: null, href: safeAppHref(n.href, n.type), cta: CTA[n.type] ?? "Открыть", createdAt: n.createdAt,
  };
  if ((n.type !== "interview" && n.type !== "assessment") || !company) return base;
  const iv = await db.interview.findFirst({
    where: { userId: n.userId, round: n.type === "assessment" ? "assessment" : { not: "assessment" }, opportunity: { job: { company } } },
    orderBy: { createdAt: "desc" },
    select: { id: true, scheduledAt: true, opportunity: { select: { job: { select: { title: true } } } } },
  });
  if (!iv) return base;
  return { ...base, role: base.role || iv.opportunity.job.title, when: iv.scheduledAt, href: `/app/interviews/${iv.id}` };
}

/**
 * An interview / assessment push whose round is already over (its time has passed, or the round is no longer upcoming)
 * is not news any more: mark it read. Called by every push loader, so a stale «Новое интервью» never resurfaces.
 * Returns how many were closed.
 */
export async function expirePastInterviewPushes(userId: string, now = new Date()) {
  const unread = await db.notification.findMany({ where: { userId, readAt: null, type: { in: ["interview", "assessment"] } }, take: 50 });
  const stale: string[] = [];
  for (const n of unread) {
    const company = companyOf(n.type, n.body);
    if (!company) continue;
    const iv = await db.interview.findFirst({
      where: { userId, round: n.type === "assessment" ? "assessment" : { not: "assessment" }, opportunity: { job: { company } } },
      orderBy: { createdAt: "desc" },
      select: { scheduledAt: true, status: true },
    });
    if (iv && ((iv.scheduledAt && iv.scheduledAt <= now) || iv.status !== "upcoming")) stale.push(n.id);
  }
  if (stale.length) await db.notification.updateMany({ where: { id: { in: stale }, userId, readAt: null }, data: { readAt: now } });
  return stale.length;
}

/**
 * Unread push moments for a screen: past-interview pushes are closed first; on an excluded route (the live Copilot,
 * src/lib/push.ts) nothing is shown. `items` = up to 10 raw rows (for the notifier), `top` = the newest resolved.
 */
export async function unreadPushes(userId: string, opts: { currentPath?: string | null; excludeRoutes?: RegExp[] } = {}) {
  await expirePastInterviewPushes(userId);
  if (isPushHiddenOn(opts.currentPath, opts.excludeRoutes ?? PUSH_EXCLUDED_ROUTES)) return { top: null, more: 0, items: [], hidden: true };
  const all = await db.notification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 20 });
  // A push is quiet on the screen that already shows its news (offer → Offer Desk, hired → HIRED): src/lib/push.ts.
  const unread = all.filter((n) => !isPushHiddenOn(opts.currentPath, opts.excludeRoutes ?? PUSH_EXCLUDED_ROUTES, n.type));
  if (!unread.length) return { top: null, more: 0, items: [], hidden: false };
  return {
    top: await resolveNotification(unread[0]),
    more: unread.length - 1,
    items: unread.slice(0, 10).map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, createdAt: n.createdAt })),
    hidden: false,
  };
}

/** Unread notifications for the in-app moment layer: the newest one resolved, plus how many more are waiting. */
export async function unreadMoments(userId: string) {
  const { top, more } = await unreadPushes(userId);
  return { top, more };
}
