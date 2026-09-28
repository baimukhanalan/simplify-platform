import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { clampText, firstName, journeyStats } from "@/app/app/hired/_lib/journey";

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
    name: firstName(campaign.user.name),
    role: clampText(s.publicOffer?.role, MAX_ROLE),
    company: clampText(s.publicOffer?.company, MAX_COMPANY),
    applications: s.applications,
    interviews: s.interviews,
    daysToOffer: s.daysToOffer,
  };
});

export function headline(d: { name: string; role: string | null; company: string | null }) {
  if (d.role && d.company) return `${d.name} got hired as ${d.role} at ${d.company}`;
  if (d.role) return `${d.name} got hired as ${d.role}`;
  return `${d.name} got hired`;
}
