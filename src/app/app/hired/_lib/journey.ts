import "server-only";
import type { Campaign } from "@prisma/client";
import { db } from "@/lib/db";

const DAY = 86_400_000;

/**
 * Stats for a hired campaign. Used by /app/hired (owner) and /share/[token] (public),
 * so it returns nothing sensitive beyond role/company — callers decide what to show.
 */
export async function journeyStats(campaign: Campaign) {
  const [applications, interviews, linkedOffer] = await Promise.all([
    db.opportunity.count({ where: { campaignId: campaign.id, submittedAt: { not: null } } }),
    db.interview.count({ where: { userId: campaign.userId, opportunity: { campaignId: campaign.id } } }),
    db.offer.findFirst({ where: { userId: campaign.userId, status: "accepted", opportunity: { campaignId: campaign.id } }, orderBy: { createdAt: "desc" } }),
  ]);
  // A manually added offer is not linked to an opportunity; fall back to the latest accepted one.
  const offer = linkedOffer ?? (await db.offer.findFirst({ where: { userId: campaign.userId, status: "accepted" }, orderBy: { createdAt: "desc" } }));
  const end = offer?.createdAt ?? campaign.hiredAt;
  const daysToOffer = campaign.startedAt && end ? Math.max(1, Math.ceil((end.getTime() - campaign.startedAt.getTime()) / DAY)) : null;
  return { applications, interviews, daysToOffer, offer };
}

export async function latestHiredCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: "hired" }, orderBy: { hiredAt: "desc" } });
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "Кандидат";

/** Russian plural: plural(5, ["заявка", "заявки", "заявок"]). */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
