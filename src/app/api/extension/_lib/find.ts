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
  const rows = await db.opportunity.findMany({
    where: {
      campaign: { userId },
      OR: [
        // ATS pages: the ATS job id is in every stored URL of that job. Any other page: the stored URL is this very
        // host + path (http/https, with or without www., a trailing slash, /apply, a query or a hash) — never «every
        // role on this host», which on a big career site buried the right one past any take limit.
        ...(key.ats === "url" ? urlPrefixes(key.id).map((url) => ({ job: { url } })) : [{ job: { url: { contains: urlNeedle(key), ...insensitive } } }]),
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

/**
 * Stored Job.url filters that can normalize to `hostPath` (normalizeUrl: lowercase host without www., path without a
 * trailing slash or /apply): the exact URL, or the URL followed by "/", "?" or "#", for each scheme and www. variant.
 * Anything wider (/jobs/12 vs /jobs/123) is dropped by the exact jobKey comparison afterwards.
 */
export function urlPrefixes(hostPath: string) {
  const slash = hostPath.indexOf("/");
  const host = slash < 0 ? hostPath : hostPath.slice(0, slash);
  const path = slash < 0 ? "" : hostPath.slice(slash);
  // The page path comes percent-encoded (URL parser); a stored URL may carry the same path unencoded.
  let decoded = path;
  try { decoded = decodeURI(path); } catch { /* malformed escape: the encoded form only */ }
  const paths = decoded === path ? [path] : [path, decoded];
  const bases = ["https://", "http://"].flatMap((s) => [host, `www.${host}`].flatMap((h) => paths.map((p) => `${s}${h}${p}`)));
  return bases.flatMap((b) => [
    { equals: b, ...insensitive },
    { startsWith: `${b}/`, ...insensitive },
    { startsWith: `${b}?`, ...insensitive },
    { startsWith: `${b}#`, ...insensitive },
  ]);
}
