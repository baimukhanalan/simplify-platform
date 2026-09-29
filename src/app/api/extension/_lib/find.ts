import "server-only";
import { db, insensitive } from "@/lib/db";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { ATS_EXTERNAL_ID_SOURCES, externalIdMatches, jobKey, urlNeedle } from "./match";

/**
 * The user's Opportunity for a page URL: same ATS job id (or host + path) as the stored Job.url, or an ATS Job.externalId
 * ending with ":<id>" (hh: "<id>" or "hh-<id>", as src/lib/sources/hh.ts stores it). Owner-scoped through the
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
        ...(key.ats === "hh" ? [{ job: { source: "hh", externalId: { in: [key.id, `hh-${key.id}`] } } }] : []),
        // ATS sources store `${board}:${id}` (the stored Job.url may be a career-site link without the ATS id).
        ...(ATS_EXTERNAL_ID_SOURCES.has(key.ats) ? [{ job: { source: key.ats, externalId: { endsWith: `:${key.id}`, ...insensitive } } }] : []),
      ],
    },
    include: { job: { select: { company: true, title: true, url: true, source: true, externalId: true } }, pkg: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const hits = rows.filter((o) => (o.job.url && jobKey(o.job.url)?.key === key.key) || (key.ats === "hh" && o.job.source === "hh" && (o.job.externalId === key.id || o.job.externalId === `hh-${key.id}`)) || externalIdMatches(key, o.job));
  const rank = (o: (typeof hits)[number]) => (o.status === "skipped" ? 0 : APPLIED_OR_LATER.includes(o.status) ? 2 : o.pkg ? 3 : 1);
  return hits.sort((a, b) => rank(b) - rank(a))[0] ?? null;
}
