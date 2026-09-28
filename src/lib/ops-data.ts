// Agent C — shared read-side queries for the campaign operating screens.
import "server-only";
import { db } from "./db";

/** The campaign the operating screens show: the latest non-draft one (active, paused, hired or expired). */
export function currentCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
}

/** The campaign the agent can still work on (active or paused). */
export function runningCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: { in: ["active", "paused"] } }, orderBy: { createdAt: "desc" } });
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
