// Agent C — shared read-side queries for the campaign operating screens.
import "server-only";
import { db } from "./db";
import { agentMaySubmit, type Autonomy } from "./engine/autonomy";
import { dailyUsage } from "./engine/agent";
import { reachedInterview } from "./engine/insights";
import { APPLIED_OR_LATER, roleKey } from "./engine/taxonomy";
import { startOfToday } from "./time";
import { isPushHiddenOn, PUSH_EXCLUDED_ROUTES } from "./push";

/** Active/paused but past endsAt: over, even if no agent cycle has written status="expired" yet (e.g. while paused). */
export const isOverdue = (c: { status: string; endsAt: Date | null }, now = new Date()) =>
  (c.status === "active" || c.status === "paused") && c.endsAt != null && c.endsAt <= now;

/** The campaign the operating screens show: the latest non-draft one (active, paused, hired or expired). */
export async function currentCampaign(userId: string) {
  const c = await db.campaign.findFirst({ where: { userId, status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
  // Show a campaign that ran out by date as expired right away; the next agent cycle persists it.
  return c && isOverdue(c) ? { ...c, status: "expired" } : c;
}

/** Prisma filter for a campaign the agent can still work on: active or paused, and not past its end date. */
export const runningCampaignWhere = (now = new Date()) => ({ status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] });

/** The campaign the agent can still work on (active or paused, and not past its end date). */
export function runningCampaign(userId: string) {
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
  opportunity: { campaign: { userId, ...runningCampaignWhere(now) } },
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
    db.opportunity.count({ where: { campaignId, ...created } }),
    qualifiedCount(campaignId, since),
    db.opportunity.count({ where: strongWhere(campaignId, since, threshold) }),
    db.opportunity.count({ where: { campaignId, submittedAt: since ? { gte: since } : { not: null } } }),
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
  | "auto-apply-off" | "below-threshold" | "no-personalize" | "handoff" | "daily-limit";

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
};

export type NextCycle = {
  /** Opportunity ids the next agent cycle would submit on its own (demo roles; live roles become handoffs instead). */
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
  const fitting = await db.opportunity.findMany({
    where: { campaignId: campaign.id, status: { in: ["found", "qualified", "prepared"] }, eligibility: { not: "blocked" }, match: { gte: STRONG_MATCH } },
    select: { id: true, status: true, decision: true, match: true, job: { select: { source: true, postedAt: true } }, approvals: { where: { status: "pending" }, select: { kind: true } } },
  });
  const notQueued: Record<string, NotQueuedReason> = {};
  const explainAll = (r: NotQueuedReason) => { for (const o of fitting) notQueued[o.id] = r; };
  const base = { ids: [] as string[], dailyLimit: campaign.dailyLimit };
  const labels = () => Object.fromEntries(Object.entries(notQueued).map(([id, r]) => [id, NOT_QUEUED_LABEL[r]]));
  if (campaign.status !== "active") { explainAll("inactive"); return { ...base, when: null, reason: "inactive", left: 0, notQueued, reasons: labels() }; }
  const since = startOfToday();
  const used = await dailyUsage(campaign.id, since);
  const left = Math.max(0, campaign.dailyLimit - used);
  if (!campaign.autoSubmit) { explainAll("no-consent"); return { ...base, when: null, reason: "no-consent", left, notQueued, reasons: labels() }; }
  const when = left > 0 ? "now" : "tomorrow";
  let budget = left > 0 ? left : campaign.dailyLimit;
  const ids: string[] = [];
  const takenRows = await db.opportunity.findMany({ where: { campaignId: campaign.id, status: { in: ["prepared", ...APPLIED_OR_LATER] } }, select: { id: true, job: { select: { company: true, title: true } } } });
  const taken = new Set(takenRows.map((o) => roleKey(o.job.company, o.job.title)));
  const why = (id: string, r: NotQueuedReason) => { notQueued[id] ??= r; };
  const permission = (o: { decision: string; match: number }): NotQueuedReason | null =>
    agentMaySubmit(o, autonomy) ? null : o.decision === "skip" ? "user-skip" : !autonomy.submitApplications ? "auto-apply-off" : "below-threshold";

  const ready = await db.opportunity.findMany({
    where: { campaignId: campaign.id, status: "prepared", decision: { not: "skip" }, approvals: { none: { status: "pending" } } },
    orderBy: [{ decision: "desc" }, { priority: "desc" }],
    select: { id: true, decision: true, match: true, updatedAt: true, job: { select: { source: true } } },
  });
  for (const o of ready) {
    const denied = permission(o);
    if (denied) { why(o.id, denied); continue; }
    const counted = when === "now" && o.updatedAt >= since;
    if (!counted && budget <= 0) { why(o.id, "daily-limit"); continue; }
    if (!counted) budget--;
    if (o.job.source === "demo") ids.push(o.id); else why(o.id, "handoff");
  }
  if (autonomy.personalizeCv && budget > 0) {
    const queue = await db.opportunity.findMany({
      where: { campaignId: campaign.id, status: "qualified", decision: { not: "skip" } },
      orderBy: [{ decision: "desc" }, { priority: "desc" }],
      take: budget * 2,
      select: { id: true, decision: true, match: true, job: { select: { company: true, title: true, source: true } } },
    });
    let prepared = 0;
    for (const o of queue) {
      if (prepared >= budget) { why(o.id, "daily-limit"); continue; }
      const key = roleKey(o.job.company, o.job.title);
      if (taken.has(key)) { why(o.id, "duplicate"); continue; } // prepare() would set this duplicate aside
      taken.add(key);
      prepared++;
      const denied = permission(o);
      if (denied) why(o.id, denied);
      else if (o.job.source === "demo") ids.push(o.id);
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
    else if (o.status === "prepared" && o.approvals.some((a) => a.kind !== "handoff")) why(o.id, "needs-answers");
    else if (o.status === "prepared" && o.approvals.length) why(o.id, "handoff");
    else if (o.status === "qualified" && !autonomy.personalizeCv) why(o.id, "no-personalize");
    else why(o.id, permission(o) ?? "daily-limit");
  }
  for (const id of Object.keys(notQueued)) if (queued.has(id)) delete notQueued[id];
  const reason = !autonomy.personalizeCv && !ids.length ? "no-personalize" : "ok";
  return { ids, when, reason, left, dailyLimit: campaign.dailyLimit, notQueued, reasons: labels() };
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

/** Company as the engine writes it into the notification body ("Company · Role" or "Assessment от Company"). */
function companyOf(type: string, body: string) {
  if (type === "assessment") return body.replace(/^Assessment\s+от\s+/i, "").trim();
  return body.split(" · ")[0]?.trim() ?? "";
}

/** Resolve where a notification leads (the concrete Interview Room when one exists) and what to show on the moment. */
export async function resolveNotification(n: { id: string; userId: string; type: string; title: string; body: string; href: string; createdAt: Date }): Promise<PushMoment> {
  const company = companyOf(n.type, n.body);
  const base: PushMoment = {
    id: n.id, type: n.type, title: n.title, body: n.body, company,
    role: n.type === "assessment" ? "" : n.body.split(" · ").slice(1).join(" · "),
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
