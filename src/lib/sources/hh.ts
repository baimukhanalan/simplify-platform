import "server-only";
import { db, j } from "../db";
import type { RawJob } from "../engine/ingest";
import { EXPERIENCE_YEARS, HH_KZ_AREA, getVacancy, hhEnabled, kzAreas, resolveKzCity, salaryOf, salaryTextOf, searchVacancies, type HhVacancy, type HhVacancyItem } from "../hh/client";

/**
 * hh.kz vacancy source (official API, application token — no HTML scraping). Off unless HH_CLIENT_ID/SECRET are set.
 * Query terms come from the goals (primaryRole + extraRoles) of users with a running campaign; the area is Kazakhstan (40)
 * plus the users' own cities (Profile.city → hh area). Fresh vacancies only (30 days); requests are capped per run.
 */
export type HhQueryContext = {
  /** Admin override (Operations → ingest «q»): search only this text. */
  query?: string;
  /** Hard cap on search requests per run (hh rate limits). */
  maxRequests?: number;
  /** Pages per (term, area). */
  maxPages?: number;
  /** Vacancies to enrich with GET /vacancies/{id} (key_skills, full description) per run. */
  detailLimit?: number;
  /** Freshness window, days. */
  days?: number;
};

const strip = (html?: string | null) => (html ?? "").replace(/<highlighttext>|<\/highlighttext>/g, "");

/** One hh vacancy → RawJob (pure). `kz`: the vacancy's area lies in Kazakhstan. */
export function mapHhVacancy(v: HhVacancyItem | HhVacancy, kz = true): RawJob {
  const full = v as HhVacancy;
  const salary = salaryOf(v);
  const remote = v.schedule?.id === "remote" || (v.work_format ?? []).some((w) => w.id?.toUpperCase() === "REMOTE");
  const snippet = [strip(v.snippet?.responsibility), strip(v.snippet?.requirement)].filter(Boolean).join("\n");
  const exp = v.experience?.id;
  return {
    source: "hh",
    externalId: `hh-${v.id}`,
    company: v.employer?.name?.trim() || "Работодатель на hh.kz",
    title: v.name,
    location: v.area?.name ? (kz ? `${v.area.name}, Казахстан` : v.area.name) : kz ? "Казахстан" : "",
    description: full.description || snippet,
    url: v.alternate_url ?? `https://hh.kz/vacancy/${v.id}`,
    postedAt: new Date(v.published_at ?? v.created_at ?? Date.now()),
    remoteHint: remote,
    salaryText: salaryTextOf(salary),
    salary,
    minYears: exp && exp in EXPERIENCE_YEARS ? EXPERIENCE_YEARS[exp] : undefined,
    tags: (full.key_skills ?? []).map((k) => k.name).filter(Boolean).slice(0, 20),
    industry: full.industries?.[0]?.name ?? v.professional_roles?.[0]?.name,
  };
}

/** Search terms + cities from running campaigns' goals. */
async function queryPlan(ctx: HhQueryContext) {
  if (ctx.query?.trim()) return { terms: [ctx.query.trim()], cities: [] as string[] };
  const rows = await db.campaign.findMany({
    where: { status: "active" },
    select: { user: { select: { goal: { select: { primaryRole: true, extraRoles: true } }, profile: { select: { city: true } } } } },
    take: 200,
  });
  const terms = new Map<string, string>();
  const cities = new Set<string>();
  for (const r of rows) {
    const g = r.user.goal;
    for (const t of [g?.primaryRole ?? "", ...j<string[]>(g?.extraRoles, [])]) {
      const clean = t.trim().slice(0, 80);
      if (clean) terms.set(clean.toLowerCase(), clean);
    }
    if (r.user.profile?.city) cities.add(r.user.profile.city);
  }
  return { terms: [...terms.values()].slice(0, 10), cities: [...cities].slice(0, 5) };
}

export async function hhSource(ctx: HhQueryContext = {}): Promise<RawJob[]> {
  if (!hhEnabled()) return [];
  const maxRequests = ctx.maxRequests ?? 24, maxPages = ctx.maxPages ?? 2, detailLimit = ctx.detailLimit ?? 25;
  const dateFrom = new Date(Date.now() - (ctx.days ?? 30) * 86400000);
  const { terms, cities } = await queryPlan(ctx);
  if (!terms.length) return [];

  const kzIds = new Set((await kzAreas()).map((a) => a.id));
  const cityIds = (await Promise.all(cities.map((c) => resolveKzCity(c).catch(() => null)))).filter((x): x is string => Boolean(x) && x !== HH_KZ_AREA);
  // The user's own cities first (one page each), then Kazakhstan-wide.
  const plan: { text: string; area: string; pages: number }[] = [];
  for (const text of terms) {
    for (const area of [...new Set(cityIds)]) plan.push({ text, area, pages: 1 });
    plan.push({ text, area: HH_KZ_AREA, pages: maxPages });
  }

  const seen = new Map<string, HhVacancyItem>();
  let requests = 0;
  outer: for (const q of plan) {
    for (let page = 0; page < q.pages; page++) {
      if (requests >= maxRequests) break outer;
      requests++;
      const res = await searchVacancies({ text: q.text, area: q.area, per_page: 50, page, date_from: dateFrom });
      for (const v of res.items ?? []) if (!v.archived && !seen.has(v.id)) seen.set(v.id, v);
      if (page + 1 >= (res.pages ?? 0)) break;
    }
  }

  // Enrich the first few with the full card (key_skills, description); only for rows we don't have yet.
  const existing = new Set((await db.job.findMany({ where: { source: "hh", externalId: { in: [...seen.keys()].map((id) => `hh-${id}`) } }, select: { externalId: true } })).map((r) => r.externalId));
  let details = 0;
  const out: RawJob[] = [];
  for (const v of seen.values()) {
    let card: HhVacancyItem | HhVacancy = v;
    if (details < detailLimit && !existing.has(`hh-${v.id}`)) {
      details++;
      card = await getVacancy(v.id).catch(() => v);
    }
    out.push(mapHhVacancy(card, !v.area?.id || kzIds.has(String(v.area.id))));
  }
  return out;
}
