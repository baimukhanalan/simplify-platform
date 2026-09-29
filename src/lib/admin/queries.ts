// Admin analytics — DB side. Every function aggregates in the database (count / groupBy / _min / _sum) or fetches
// minimal columns with a hard cap, and runs a constant number of queries whatever the number of users (no N+1).
// Date bucketing happens in JS (SQLite and Postgres bucket dates differently).
import "server-only";
import type { Prisma } from "@prisma/client";
import { db, insensitive, j } from "../db";
import { activationBlocked, countsAsRevenue, refundState, type PaymentMeta } from "../payments/kaspi";
import { runningCampaignWhere } from "../ops-data";
import { INTERVIEW_STATUSES, PLANS } from "../engine/taxonomy";
import {
  DAY, FUNNEL_STEPS, bucketKeys, maskEmail as maskedOf, buildCohorts, buildFunnel, campaignDay, granularityFor, keyFn, periodStart, stageOf,
  type PeriodKey, type StepKey, type StepTimes,
} from "./metrics";

/** Hard caps on rows pulled into memory for JS-side bucketing. Far above today's volume; the page says when one is hit. */
export const ROW_CAP = 100_000;

/** Paid and not refunded in full (a duplicate charge refunds only the extra charge; the payment still counts). Any provider. */
export const countsAsPaid = (p: { status: string; meta: string }) => p.status === "paid" && !activationBlocked(j<PaymentMeta>(p.meta, {}));

/** Employer replies: anything but an automatic confirmation / unclassified mail. */
const REPLY_CLASSES = ["rejection", "assessment", "interview", "offer"];
/** Opportunity statuses that mean the employer answered. */
const REPLIED_STATUSES = ["assessment", ...INTERVIEW_STATUSES, "offer", "hired", "rejected"];
const INTERVIEW_OR_LATER = [...INTERVIEW_STATUSES, "offer", "hired"];

/* ——————————————————— Funnel step times ——————————————————— */

/**
 * First time each funnel step was reached, per user, for the users matching `userWhere` (a signup period or a page of
 * ids). 7 queries total.
 */
export async function loadStepTimes(userWhere: Prisma.UserWhereInput, cap = ROW_CAP) {
  const [users, goals, campaigns, payments, replies, interviews, offers] = await Promise.all([
    db.user.findMany({ where: userWhere, select: { id: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: cap }),
    db.goal.findMany({ where: { primaryRole: { not: "" }, user: { ...userWhere, profile: { isNot: null } } }, select: { userId: true, updatedAt: true }, take: cap }),
    db.campaign.findMany({ where: { user: userWhere }, select: { id: true, userId: true, createdAt: true, hiredAt: true }, take: cap * 2 }),
    db.payment.findMany({ where: { status: "paid", user: { is: userWhere } }, select: { userId: true, status: true, meta: true, paidAt: true, createdAt: true }, take: cap * 2 }),
    db.inboxMessage.groupBy({ by: ["userId"], where: { classification: { in: REPLY_CLASSES }, user: userWhere }, _min: { receivedAt: true } }),
    db.interview.groupBy({ by: ["userId", "round"], where: { user: userWhere }, _min: { createdAt: true } }),
    db.offer.groupBy({ by: ["userId"], where: { user: userWhere }, _min: { createdAt: true } }),
  ]);
  // First submitted application per campaign (grouped in the DB), then folded per user.
  const applied = campaigns.length
    ? await db.opportunity.groupBy({ by: ["campaignId"], where: { submittedAt: { not: null }, campaign: { user: userWhere } }, _min: { submittedAt: true } })
    : [];

  const map = new Map<string, StepTimes>();
  for (const u of users) map.set(u.id, { signup: u.createdAt.getTime() });
  const setMin = (userId: string | null, k: StepKey, d: Date | null | undefined) => {
    if (!userId || !d) return;
    const t = map.get(userId);
    if (!t) return;
    const v = d.getTime();
    if (t[k] == null || v < t[k]!) t[k] = v;
  };

  const firstCampaign = new Map<string, number>();
  const campUser = new Map<string, string>();
  for (const c of campaigns) {
    campUser.set(c.id, c.userId);
    const prev = firstCampaign.get(c.userId);
    if (prev == null || c.createdAt.getTime() < prev) firstCampaign.set(c.userId, c.createdAt.getTime());
    setMin(c.userId, "hired", c.hiredAt);
  }
  // Onboarding is done once profile + goal exist; its moment is the goal's save or, when earlier, the first campaign
  // (the goal row is re-saved on later edits, so its updatedAt alone can drift later than the real moment).
  for (const g of goals) {
    const fc = firstCampaign.get(g.userId);
    setMin(g.userId, "onboarded", fc != null && fc < g.updatedAt.getTime() ? new Date(fc) : g.updatedAt);
  }
  for (const p of payments) if (countsAsPaid(p)) setMin(p.userId, "paid", p.paidAt ?? p.createdAt);
  for (const a of applied) setMin(campUser.get(a.campaignId) ?? null, "applied", a._min.submittedAt);
  for (const r of replies) setMin(r.userId, "replied", r._min.receivedAt);
  for (const i of interviews) {
    setMin(i.userId, "replied", i._min.createdAt); // an assessment / interview invite is a reply too
    if (i.round !== "assessment") setMin(i.userId, "interview", i._min.createdAt);
  }
  for (const o of offers) setMin(o.userId, "offer", o._min.createdAt);
  return { map, capped: users.length >= cap };
}

/* ——————————————————— Обзор ——————————————————— */

export async function overview(period: PeriodKey, now = new Date()) {
  const from = periodStart(period, now);
  const range = from ? { gte: from } : undefined;
  const [signups, totalUsers, paidRows, activeCampaigns, hired, activeByPlan, firstUser] = await Promise.all([
    db.user.findMany({ where: range ? { createdAt: range } : {}, select: { id: true, createdAt: true }, take: ROW_CAP, orderBy: { createdAt: "desc" } }),
    db.user.count(),
    // All paid payments ever (small: one or two per paying user) — needed for "paid users", signup→paid and revenue.
    db.payment.findMany({ where: { status: "paid" }, select: { userId: true, amount: true, provider: true, status: true, meta: true, plan: true, paidAt: true, createdAt: true }, take: ROW_CAP * 2 }),
    db.campaign.count({ where: { ...runningCampaignWhere(now), status: "active" } }),
    db.campaign.count({ where: { hiredAt: range ? range : { not: null } } }),
    db.campaign.groupBy({ by: ["plan"], where: { ...runningCampaignWhere(now), status: "active" }, _count: { _all: true } }),
    from ? null : db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);

  const inPeriod = (d: Date) => !from || d >= from;
  const paid = paidRows.filter(countsAsPaid).map((p) => ({ ...p, at: p.paidAt ?? p.createdAt, revenue: countsAsRevenue(p) }));
  const periodPaid = paid.filter((p) => inPeriod(p.at));
  const revenue = periodPaid.reduce((a, p) => a + (p.revenue ? p.amount : 0), 0);
  const turnover = periodPaid.reduce((a, p) => a + p.amount, 0);
  const paidUsers = new Set(periodPaid.map((p) => p.userId).filter(Boolean)).size;
  const everPaid = new Set(paid.map((p) => p.userId).filter(Boolean) as string[]);
  const cohortPaid = signups.filter((u) => everPaid.has(u.id)).length;

  // Chart buckets.
  let startMs = from ? from.getTime() : Math.min(firstUser?.createdAt.getTime() ?? now.getTime(), now.getTime());
  if (!from) for (const p of paid) startMs = Math.min(startMs, p.at.getTime()); // a loop: no 100k-argument spread
  const g = granularityFor(startMs, now.getTime());
  const keyOf = keyFn(g);
  const keys = bucketKeys(startMs, now.getTime(), g);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const series = keys.map((k) => ({ key: k, signups: 0, revenue: 0, other: 0 }));
  for (const u of signups) {
    const i = idx.get(keyOf(u.createdAt.getTime()));
    if (i != null) series[i].signups++;
  }
  for (const p of periodPaid) {
    const i = idx.get(keyOf(p.at.getTime()));
    if (i == null) continue;
    if (p.revenue) series[i].revenue += p.amount;
    else series[i].other += p.amount;
  }

  const plans = (Object.keys(PLANS) as (keyof typeof PLANS)[]).map((k) => ({
    key: k,
    label: PLANS[k].label,
    payments: periodPaid.filter((p) => p.plan === k).length,
    amount: periodPaid.filter((p) => p.plan === k).reduce((a, p) => a + p.amount, 0),
    revenue: periodPaid.filter((p) => p.plan === k && p.revenue).reduce((a, p) => a + p.amount, 0),
    active: activeByPlan.find((x) => x.plan === k)?._count._all ?? 0,
  }));

  return {
    from, granularity: g, series, plans, totalUsers,
    signups: signups.length, signupsCapped: signups.length >= ROW_CAP,
    paidUsers, revenue, turnover, paymentsCount: periodPaid.length,
    conversion: signups.length ? (cohortPaid / signups.length) * 100 : 0, cohortPaid,
    arpu: paidUsers ? Math.round(revenue / paidUsers) : 0,
    arpuTurnover: paidUsers ? Math.round(turnover / paidUsers) : 0,
    activeCampaigns, hired,
  };
}

/* ——————————————————— Referrals ——————————————————— */

export async function referralStats(top = 8) {
  const [byStatus, topRows] = await Promise.all([
    db.referral.groupBy({ by: ["status"], _count: { _all: true }, _sum: { rewardDays: true, discountKzt: true } }),
    db.referral.groupBy({ by: ["referrerId"], _count: { referrerId: true }, orderBy: { _count: { referrerId: "desc" } }, take: top }),
  ]);
  const ids = topRows.map((r) => r.referrerId);
  const [names, converted] = ids.length
    ? await Promise.all([
        db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        db.referral.groupBy({ by: ["referrerId"], where: { referrerId: { in: ids }, status: { in: ["paid", "rewarded"] } }, _count: { _all: true }, _sum: { rewardDays: true } }),
      ])
    : [[], []];
  const st = (k: string) => byStatus.find((b) => b.status === k)?._count._all ?? 0;
  return {
    total: byStatus.reduce((a, b) => a + b._count._all, 0),
    signedUp: st("signed_up"), paid: st("paid"), rewarded: st("rewarded"),
    rewardDays: byStatus.reduce((a, b) => a + (b._sum.rewardDays ?? 0), 0),
    discountKzt: byStatus.reduce((a, b) => a + (b._sum.discountKzt ?? 0), 0),
    top: topRows.map((r) => {
      const c = converted.find((x) => x.referrerId === r.referrerId);
      return { userId: r.referrerId, name: names.find((n) => n.id === r.referrerId)?.name ?? "—", invited: r._count.referrerId, paid: c?._count._all ?? 0, rewardDays: c?._sum.rewardDays ?? 0 };
    }),
  };
}

/* ——————————————————— Воронка ——————————————————— */

export async function funnelData(period: PeriodKey, now = new Date()) {
  const from = periodStart(period, now);
  const { map, capped } = await loadStepTimes(from ? { createdAt: { gte: from } } : {});
  const users = [...map.values()];
  return { rows: buildFunnel(users), cohorts: buildCohorts(users, 12), capped, from };
}

/* ——————————————————— Users ——————————————————— */

export const USERS_PAGE = 25;

export function userSearchWhere(q: string): Prisma.UserWhereInput {
  const t = q.trim().slice(0, 100);
  if (!t) return {};
  return { OR: [{ email: { contains: t, ...insensitive } }, { name: { contains: t, ...insensitive } }, { id: t }] };
}

export async function usersPage(q: string, page: number, now = new Date()) {
  const where = userSearchWhere(q);
  const [total, users] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * USERS_PAGE, take: USERS_PAGE, select: { id: true, name: true, email: true, role: true, createdAt: true } }),
  ]);
  const ids = users.map((u) => u.id);
  if (!ids.length) return { total, rows: [] };
  const [steps, campaigns, interviews, lastEvents] = await Promise.all([
    loadStepTimes({ id: { in: ids } }),
    db.campaign.findMany({ where: { userId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { id: true, userId: true, plan: true, status: true, startedAt: true, endsAt: true, bonusDays: true } }),
    db.interview.groupBy({ by: ["userId"], where: { userId: { in: ids }, round: { not: "assessment" } }, _count: { _all: true } }),
    db.event.groupBy({ by: ["userId"], where: { userId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const apps = campaigns.length
    ? await db.opportunity.groupBy({ by: ["campaignId"], where: { campaignId: { in: campaigns.map((c) => c.id) }, submittedAt: { not: null } }, _count: { _all: true } })
    : [];
  const appsByCampaign = new Map(apps.map((a) => [a.campaignId, a._count._all]));
  const rows = users.map((u) => {
    const cs = campaigns.filter((c) => c.userId === u.id);
    const cur = cs.find((c) => c.status !== "draft") ?? cs[0] ?? null;
    const t = steps.map.get(u.id) ?? { signup: u.createdAt.getTime() };
    const last = lastEvents.find((e) => e.userId === u.id)?._max.createdAt ?? null;
    return {
      id: u.id, name: u.name, masked: maskedOf(u.email), role: u.role, createdAt: u.createdAt,
      plan: cur && cur.status !== "draft" ? cur.plan : null,
      campaignStatus: cur?.status ?? null,
      day: cur && (cur.status === "active" || cur.status === "paused") ? campaignDay(cur, now.getTime(), PLANS[cur.plan as keyof typeof PLANS]?.days) : null,
      applications: cs.reduce((a, c) => a + (appsByCampaign.get(c.id) ?? 0), 0),
      interviews: interviews.find((i) => i.userId === u.id)?._count._all ?? 0,
      lastActivity: last ?? u.createdAt,
      stage: stageOf(t),
    };
  });
  return { total, rows };
}


export async function userDetail(id: string) {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true, name: true, email: true, role: true, createdAt: true, locale: true, careerMode: true, referralCode: true, referredByCode: true,
      telegramChatId: true, telegramLinkedAt: true, notifyPrefs: true, inboxAlias: true,
      profile: { select: { headline: true, city: true, country: true, yearsExperience: true, skills: true, englishLevel: true, cvFileName: true, remotePref: true, updatedAt: true } },
      goal: { select: { primaryRole: true, seniority: true, countries: true, minSalary: true, currency: true, mode: true } },
    },
  });
  if (!user) return null;
  const [campaigns, payments, events, pushSubs, notif, integrations, referredBy, referralsMade, referralsCount, steps] = await Promise.all([
    db.campaign.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, plan: true, status: true, readiness: true, startedAt: true, endsAt: true, lastRunAt: true, hiredAt: true, bonusDays: true, guaranteeStatus: true, priceKzt: true, createdAt: true } }),
    db.payment.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, amount: true, currency: true, provider: true, status: true, plan: true, meta: true, paidAt: true, createdAt: true } }),
    db.event.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 40, select: { id: true, type: true, message: true, createdAt: true } }),
    db.pushSubscription.count({ where: { userId: id } }),
    db.notification.aggregate({ where: { userId: id }, _count: { _all: true, telegramSentAt: true, pushSentAt: true, readAt: true } }),
    db.integration.findMany({ where: { userId: id }, select: { provider: true, createdAt: true } }),
    db.referral.findUnique({ where: { referredUserId: id }, select: { status: true, rewardDays: true, discountKzt: true, createdAt: true, referrer: { select: { id: true, name: true } } } }),
    db.referral.findMany({ where: { referrerId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, rewardDays: true, createdAt: true, referred: { select: { id: true, name: true } } } }),
    db.referral.count({ where: { referrerId: id } }),
    loadStepTimes({ id }),
  ]);
  const campIds = campaigns.map((c) => c.id);
  const [apps, ivs] = campIds.length
    ? await Promise.all([
        db.opportunity.groupBy({ by: ["campaignId"], where: { campaignId: { in: campIds }, submittedAt: { not: null } }, _count: { _all: true } }),
        db.opportunity.groupBy({ by: ["campaignId"], where: { campaignId: { in: campIds }, OR: [{ status: { in: INTERVIEW_OR_LATER } }, { interviews: { some: { round: { not: "assessment" } } } }] }, _count: { _all: true } }),
      ])
    : [[], []];
  const t = steps.map.get(id) ?? { signup: user.createdAt.getTime() };
  return {
    user: { ...user, masked: maskedOf(user.email), email: undefined },
    stage: stageOf(t),
    steps: t,
    campaigns: campaigns.map((c) => ({ ...c, applications: apps.find((a) => a.campaignId === c.id)?._count._all ?? 0, withInterview: ivs.find((a) => a.campaignId === c.id)?._count._all ?? 0 })),
    payments: payments.map((p) => ({ ...p, meta: undefined, revenue: countsAsRevenue(p), refund: refundState(p.meta) })),
    events,
    channels: {
      telegram: Boolean(user.telegramChatId), telegramLinkedAt: user.telegramLinkedAt, push: pushSubs, prefs: j<Record<string, boolean>>(user.notifyPrefs, {}),
      notifications: notif._count._all, viaTelegram: notif._count.telegramSentAt, viaPush: notif._count.pushSentAt, read: notif._count.readAt,
      inboxAlias: Boolean(user.inboxAlias), integrations: integrations.map((i) => i.provider),
    },
    referral: { code: user.referralCode, referredBy, made: referralsMade, madeCount: referralsCount },
  };
}

/* ——————————————————— Payments ——————————————————— */

export const PAYMENTS_PAGE = 50;
export const PAYMENT_STATUSES = ["pending", "paid", "failed", "expired"] as const;

export type PaymentFilter = { status?: string; provider?: string; plan?: string; refund?: boolean };

export function paymentWhere(f: PaymentFilter): Prisma.PaymentWhereInput {
  return {
    ...(f.status ? { status: f.status } : {}),
    ...(f.provider ? { provider: f.provider } : {}),
    ...(f.plan ? { plan: f.plan } : {}),
    // Refund marks live in the JSON meta: a cheap pre-filter in the DB, the exact check in JS (refundState).
    ...(f.refund ? { OR: [{ meta: { contains: "\"refunds\"" } }, { meta: { contains: "refundDue" } }, { meta: { contains: "duplicateCharges" } }, { meta: { contains: "conflictingCampaignId" } }] } : {}),
  };
}

export async function paymentsPage(f: PaymentFilter, page: number) {
  const where = paymentWhere(f);
  const [total, byStatus, providers, rows, paidRows] = await Promise.all([
    db.payment.count({ where }),
    db.payment.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { amount: true } }),
    db.payment.groupBy({ by: ["provider"], _count: { _all: true } }),
    db.payment.findMany({
      where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAYMENTS_PAGE, take: PAYMENTS_PAGE,
      select: { id: true, userId: true, amount: true, currency: true, provider: true, status: true, plan: true, meta: true, paidAt: true, createdAt: true, partnerCode: true, user: { select: { name: true } } },
    }),
    db.payment.findMany({ where: { AND: [where, { status: "paid" }] }, select: { amount: true, provider: true, status: true, meta: true }, take: ROW_CAP * 2 }),
  ]);
  let revenue = 0, refunded = 0, refundedCount = 0;
  for (const p of paidRows) {
    if (countsAsRevenue(p)) revenue += p.amount;
    const r = refundState(p.meta);
    if (r.blocked) { refunded += p.amount; refundedCount++; }
  }
  return {
    total,
    byStatus: PAYMENT_STATUSES.map((s) => ({ status: s, count: byStatus.find((b) => b.status === s)?._count._all ?? 0, amount: byStatus.find((b) => b.status === s)?._sum.amount ?? 0 })),
    providers: providers.map((p) => p.provider).sort(),
    revenue, refunded, refundedCount,
    rows: rows.map((p) => ({ ...p, meta: undefined, revenue: countsAsRevenue(p), refund: refundState(p.meta) })).filter((p) => !f.refund || p.refund.refundDue),
  };
}

/* ——————————————————— Stuck campaigns ——————————————————— */

export const STUCK_REASONS = {
  no_cycle: { label: "Нет цикла агента > 24 ч", tone: "rose" },
  no_apps: { label: "0 заявок за 3 дня", tone: "rose" },
  low_readiness: { label: "Низкий Readiness", tone: "amber" },
  no_replies: { label: "Нет ответов 14 дней", tone: "amber" },
  guarantee: { label: "Кандидат на гарантию", tone: "dark" },
} as const;
export type StuckReason = keyof typeof STUCK_REASONS;
export const LOW_READINESS = 65;
export const STUCK_CAMPAIGN_CAP = 5000;

export function stuckReasons(
  c: { startedAt: Date | null; createdAt: Date; lastRunAt: Date | null; endsAt: Date | null; readiness: number },
  s: { applications: number; replies: number; interviews: number },
  now = Date.now(),
): StuckReason[] {
  const out: StuckReason[] = [];
  const start = (c.startedAt ?? c.createdAt).getTime();
  const age = now - start;
  if (now - (c.lastRunAt?.getTime() ?? start) > DAY) out.push("no_cycle");
  if (age > 3 * DAY && s.applications === 0) out.push("no_apps");
  if (c.readiness < LOW_READINESS) out.push("low_readiness");
  if (age > 14 * DAY && s.applications > 0 && s.replies === 0) out.push("no_replies");
  if (c.endsAt && c.endsAt.getTime() - now <= 7 * DAY && s.interviews === 0) out.push("guarantee");
  return out;
}

export async function stuckCampaigns(now = new Date()) {
  const where: Prisma.CampaignWhereInput = { status: { in: ["active", "paused"] } };
  const [campaigns, apps, replies, ivs, pending] = await Promise.all([
    db.campaign.findMany({
      where, orderBy: { createdAt: "asc" }, take: STUCK_CAMPAIGN_CAP,
      select: { id: true, userId: true, plan: true, status: true, readiness: true, startedAt: true, endsAt: true, lastRunAt: true, createdAt: true, bonusDays: true, guaranteeStatus: true, user: { select: { name: true } } },
    }),
    db.opportunity.groupBy({ by: ["campaignId"], where: { campaign: where, submittedAt: { not: null } }, _count: { _all: true } }),
    db.opportunity.groupBy({ by: ["campaignId"], where: { campaign: where, status: { in: REPLIED_STATUSES } }, _count: { _all: true } }),
    db.opportunity.groupBy({ by: ["campaignId"], where: { campaign: where, OR: [{ status: { in: INTERVIEW_OR_LATER } }, { interviews: { some: { round: { not: "assessment" } } } }] }, _count: { _all: true } }),
    db.approval.groupBy({ by: ["userId"], where: { status: "pending", opportunity: { campaign: where } }, _count: { _all: true } }),
  ]);
  const n = (rows: { campaignId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.campaignId, r._count._all]));
  const A = n(apps), R = n(replies), I = n(ivs);
  const P = new Map(pending.map((p) => [p.userId, p._count._all]));
  const t = now.getTime();
  const all = campaigns.map((c) => {
    const s = { applications: A.get(c.id) ?? 0, replies: R.get(c.id) ?? 0, interviews: I.get(c.id) ?? 0 };
    return {
      id: c.id, userId: c.userId, name: c.user.name, plan: c.plan, status: c.status, readiness: c.readiness, lastRunAt: c.lastRunAt, endsAt: c.endsAt,
      guaranteeStatus: c.guaranteeStatus, pending: P.get(c.userId) ?? 0, ...s,
      day: campaignDay(c, t, PLANS[c.plan as keyof typeof PLANS]?.days),
      overdue: c.endsAt != null && c.endsAt <= now,
      reasons: c.status === "paused" ? [] : stuckReasons(c, s, t),
    };
  });
  const weight = (r: StuckReason[]) => r.reduce((a, x) => a + (STUCK_REASONS[x].tone === "rose" ? 10 : STUCK_REASONS[x].tone === "dark" ? 6 : 3), 0);
  const stuck = all.filter((c) => c.reasons.length).sort((a, b) => weight(b.reasons) - weight(a.reasons) || (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0));
  const counts = Object.fromEntries((Object.keys(STUCK_REASONS) as StuckReason[]).map((k) => [k, stuck.filter((c) => c.reasons.includes(k)).length])) as Record<StuckReason, number>;
  return { stuck, active: all.filter((c) => c.status === "active").length, paused: all.filter((c) => c.status === "paused").length, counts, capped: campaigns.length >= STUCK_CAMPAIGN_CAP };
}

export { FUNNEL_STEPS };
