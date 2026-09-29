import "server-only";
import { db, insensitive } from "@/lib/db";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { jobKey, urlNeedle } from "./match";

/**
 * The user's Opportunity for a page URL: same ATS job id (or host + path) as the stored Job.url. Owner-scoped through the
 * campaign. Several campaigns can hold the same vacancy — the live one wins: prepared/applied before found, then newest.
 */
export async function findOpportunityForUrl(userId: string, pageUrl: string) {
  const key = jobKey(pageUrl);
  if (!key) return null;
  const needle = urlNeedle(key);
  const rows = await db.opportunity.findMany({
    where: {
      campaign: { userId },
      OR: [
        { job: { url: { contains: needle, ...insensitive } } },
        ...(key.ats === "hh" ? [{ job: { source: "hh", externalId: key.id } }] : []),
      ],
    },
    include: { job: { select: { company: true, title: true, url: true, source: true, externalId: true } }, pkg: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const hits = rows.filter((o) => (o.job.url && jobKey(o.job.url)?.key === key.key) || (key.ats === "hh" && o.job.source === "hh" && o.job.externalId === key.id));
  const rank = (o: (typeof hits)[number]) => (o.status === "skipped" ? 0 : APPLIED_OR_LATER.includes(o.status) ? 2 : o.pkg ? 3 : 1);
  return hits.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}
