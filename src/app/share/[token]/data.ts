import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { clampText, firstName, journeyStats } from "@/app/app/hired/_lib/journey";
import type { T } from "@/lib/i18n/translator";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

export const MAX_ROLE = 80;
export const MAX_COMPANY = 60;

/**
 * Public journey card data. Deliberately minimal: first name, role, company and campaign counts.
 * No email, last name, salary or anything else from the account ever leaves this function.
 * Role/company appear only when the accepted offer is linked to an application the campaign submitted —
 * free-text from a manually added offer is never published. All text is length-clamped.
 */
export const loadShare = cache(async (token: string) => {
  if (!TOKEN.test(token)) return null;
  const campaign = await db.campaign.findUnique({ where: { shareToken: token }, include: { user: { select: { name: true } } } });
  if (!campaign || campaign.status !== "hired") return null;
  const s = await journeyStats(campaign);
  return {
    name: firstName(campaign.user.name, ""), // empty → the page shows its translated «Кандидат»
    role: clampText(s.publicOffer?.role, MAX_ROLE),
    company: clampText(s.publicOffer?.company, MAX_COMPANY),
    applications: s.applications,
    interviews: s.interviews,
    daysToOffer: s.daysToOffer,
  };
});

type Head = { name: string; role: string | null; company: string | null };
const shownName = (t: T, name: string) => name || t("sharePage.candidate");

/** Public headline in the visitor's language around the owner's English moment ("HIRED."); role/company stay as written. */
export function headline(t: T, d: Head) {
  const name = shownName(t, d.name);
  if (d.role && d.company) return t("sharePage.headline", { name, role: d.role, company: d.company });
  if (d.role) return t("sharePage.headlineRole", { name, role: d.role });
  return t("sharePage.headlineName", { name });
}

/** OG card title: «Имя · роль в компании» (the card already shows HIRED.). */
export function ogTitle(t: T, d: Head) {
  const name = shownName(t, d.name);
  if (d.role && d.company) return t("sharePage.ogTitle", { name, role: d.role, company: d.company });
  if (d.role) return t("sharePage.ogTitleRole", { name, role: d.role });
  return name;
}

/** "12 заявок · 3 интервью · 21 день до оффера". */
export function statsLine(t: T, d: { applications: number; interviews: number; daysToOffer: number | null }) {
  return [
    t("sharePage.statApplications", { n: d.applications }),
    t("sharePage.statInterviews", { n: d.interviews }),
    ...(d.daysToOffer != null ? [t("sharePage.statDays", { n: d.daysToOffer })] : []),
  ].join(" · ");
}
