// Agent C — shared read-side queries for the campaign operating screens.
import "server-only";
import { db } from "./db";

/** Active/paused but past endsAt: over, even if no agent cycle has written status="expired" yet (e.g. while paused). */
export const isOverdue = (c: { status: string; endsAt: Date | null }, now = new Date()) =>
  (c.status === "active" || c.status === "paused") && c.endsAt != null && c.endsAt <= now;

/** The campaign the operating screens show: the latest non-draft one (active, paused, hired or expired). */
export async function currentCampaign(userId: string) {
  const c = await db.campaign.findFirst({ where: { userId, status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
  // Show a campaign that ran out by date as expired right away; the next agent cycle persists it.
  return c && isOverdue(c) ? { ...c, status: "expired" } : c;
}

/** The campaign the agent can still work on (active or paused, and not past its end date). */
export function runningCampaign(userId: string) {
  return db.campaign.findFirst({
    where: { userId, status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
  });
}

// ——— "Today" numbers (Today screen and Opportunities use the same window and the same definitions) ———

/** Match from which a found role counts as "подошла" (fits). */
export const STRONG_MATCH = 70;

/**
 * Counts for one window of a campaign. `since` is startOfToday() (src/lib/time.ts) for "Сегодня";
 * null = the whole campaign. found = everything discovered; fit = eligible and Match ≥ 70; strong = eligible and
 * Match ≥ the auto-apply threshold; submitted = applications sent in the window.
 */
export async function windowNumbers(campaignId: string, since: Date | null, threshold: number) {
  const created = since ? { createdAt: { gte: since } } : {};
  const eligible = { campaignId, ...created, status: { not: "skipped" }, eligibility: { not: "blocked" } };
  const [found, fit, strong, submitted] = await Promise.all([
    db.opportunity.count({ where: { campaignId, ...created } }),
    db.opportunity.count({ where: { ...eligible, match: { gte: STRONG_MATCH } } }),
    db.opportunity.count({ where: { ...eligible, match: { gte: threshold } } }),
    db.opportunity.count({ where: { campaignId, submittedAt: since ? { gte: since } : { not: null } } }),
  ]);
  return { found, fit, strong, submitted };
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
const CTA: Record<string, string> = { interview: "Prepare", assessment: "Start preparation", offer: "Review offer", hired: "Open Career" };

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

/** Unread notifications for the in-app moment layer: the newest one resolved, plus how many more are waiting. */
export async function unreadMoments(userId: string) {
  const unread = await db.notification.findMany({ where: { userId, readAt: null }, orderBy: { createdAt: "desc" }, take: 20 });
  if (!unread.length) return { top: null, more: 0 };
  return { top: await resolveNotification(unread[0]), more: unread.length - 1 };
}
