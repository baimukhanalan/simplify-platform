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
    // Linked = the offer came from an application this campaign actually submitted.
    db.offer.findFirst({ where: { userId: campaign.userId, status: "accepted", opportunity: { campaignId: campaign.id, submittedAt: { not: null } } }, orderBy: { createdAt: "desc" } }),
  ]);
  // A manually added offer is not linked to an opportunity; the owner still sees it, the public page never does.
  const offer = linkedOffer ?? (await db.offer.findFirst({ where: { userId: campaign.userId, status: "accepted" }, orderBy: { createdAt: "desc" } }));
  const end = offer?.createdAt ?? campaign.hiredAt;
  const daysToOffer = campaign.startedAt && end ? Math.max(1, Math.ceil((end.getTime() - campaign.startedAt.getTime()) / DAY)) : null;
  return { applications, interviews, daysToOffer, offer, publicOffer: linkedOffer };
}

/** Public text is user-controlled (name, offer role/company): collapse whitespace and cap the length. */
export const clampText = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${Array.from(t).slice(0, max - 1).join("").trimEnd()}…` : t;
};

export async function latestHiredCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: "hired" }, orderBy: { hiredAt: "desc" } });
}

/** First name for public/owner copy; `fallback` when the name is empty (the callers pass their translated «Кандидат»). */
export const firstName = (name: string, fallback = "Кандидат") => clampText(name.trim().split(/\s+/)[0], 32) || fallback;

/** Russian plural — the shared helper, re-exported for the public share page. */
export { plural } from "@/app/_components/ru";
