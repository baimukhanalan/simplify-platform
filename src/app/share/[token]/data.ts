import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { firstName, journeyStats } from "@/app/app/hired/_lib/journey";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Public journey card data. Deliberately minimal: first name, role, company and campaign counts.
 * No email, last name, salary or anything else from the account ever leaves this function.
 */
export const loadShare = cache(async (token: string) => {
  if (!TOKEN.test(token)) return null;
  const campaign = await db.campaign.findUnique({ where: { shareToken: token }, include: { user: { select: { name: true } } } });
  if (!campaign || campaign.status !== "hired") return null;
  const s = await journeyStats(campaign);
  return {
    name: firstName(campaign.user.name),
    role: s.offer?.role ?? null,
    company: s.offer?.company ?? null,
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
