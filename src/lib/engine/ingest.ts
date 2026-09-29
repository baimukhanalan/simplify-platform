import "server-only";
import { db, s, noNul } from "../db";
import { classifyRole, seniorityFromTitle, extractSkills, wordRe, MASS_HIRING_FAMILIES } from "./taxonomy";
import { SEED_JOBS } from "./seed-jobs";
import { hhNormalize, type HhRawSalary } from "../hh/normalize";
import { hhSource } from "../sources/hh";
import { openFromKazakhstan, type KzVerdict } from "./kz-eligibility";
import type { SourceCtx, SourceFn } from "../sources/http";
import { errMsg } from "../sources/http";
import { ATS, type AtsName, DEFAULT_BOARDS, envBoards, readAts } from "../sources/ats";
import { arbeitnow, himalayas, jobicy, remotive } from "../sources/remote-feeds";

// ——— Normalization: every source is mapped to one vacancy structure ———
export type RawJob = { source: string; externalId: string; company: string; title: string; location: string; description: string; url: string; postedAt: Date; remoteHint?: boolean; salaryText?: string; tags?: string[]; industry?: string;
  /** hh only (src/lib/sources/hh.ts): structured salary and experience bucket, used instead of text guessing. */
  salary?: HhRawSalary; minYears?: number;
  /** Structured workplace from the source (ATS flags), preferred over guessing from the location text. */
  workplace?: "remote" | "hybrid" | "onsite" };

// Unicode-aware boundaries (wordRe): `\b` does not work next to Cyrillic, so "Алматы" never matched.
const COUNTRY_WORDS: [RegExp, string][] = ([
  ["united states|usa|u\\.s\\.|us|new york|san francisco|seattle|austin|boston|chicago|remote - us|americas", "US"],
  ["united kingdom|uk|london|manchester|england", "GB"], ["canada|toronto|vancouver|montreal", "CA"],
  ["germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|köln|cologne", "DE"], ["netherlands|amsterdam|rotterdam", "NL"],
  ["poland|warsaw|kraków|krakow|wroclaw", "PL"], ["spain|madrid|barcelona", "ES"], ["france|paris", "FR"], ["ireland|dublin", "IE"],
  ["portugal|lisbon|porto", "PT"], ["estonia|tallinn", "EE"], ["austria|vienna|wien", "AT"], ["sweden|stockholm", "SE"],
  ["kazakhstan|almaty|astana|nur-sultan|shymkent|karaganda|karagandy|aktobe|atyrau|pavlodar|казахстан|алматы|астана|шымкент|караганда|актобе|атырау|павлодар", "KZ"],
  ["uzbekistan|tashkent|узбекистан|ташкент", "UZ"], ["kyrgyzstan|bishkek|кыргызстан|бишкек", "KG"], ["armenia|yerevan|армения|ереван", "AM"],
  ["tbilisi|тбилиси|грузия", "GE"], ["azerbaijan|baku|азербайджан|баку", "AZ"], ["belarus|minsk|беларусь|минск", "BY"], ["russia|moscow|россия|москва", "RU"],
  ["uae|dubai|abu dhabi", "AE"],
  ["worldwide|anywhere|global", "*"], ["europe|emea|eu", "EU*"],
] as const).map(([words, code]) => [wordRe(words), code]);
const EU = ["DE", "NL", "PL", "ES", "FR", "IE", "PT", "SE", "EE", "LT", "CZ", "AT", "BE", "DK", "FI", "IT"];

const dedupeKeyOf = (company: string, title: string, location: string) => `${company}|${title}|${location}`.toLowerCase().replace(/\s+/g, " ").slice(0, 190);

/**
 * Fold the «open from Kazakhstan» verdict into the job's countries, which the plan / eligibility logic reads:
 * a role naming KZ / Central Asia / CIS gets "KZ"; a worldwide remote role gets "*"; a remote role pinned elsewhere keeps its
 * named countries, or gets the pinned region's codes instead of a false "*"; a bare «Remote» with no signal stays "*" (as before).
 */
export function kzCountries(countries: string[], remote: string, kz: KzVerdict): string[] {
  const concrete = countries.filter((c) => c !== "*");
  if (kz.open) {
    if (kz.named) return [...new Set([...countries, "KZ"])];
    return remote === "remote" ? [...new Set([...concrete, "*"])] : countries;
  }
  if (remote !== "remote") return countries;
  if (kz.verdict === "pinned") return concrete.length ? concrete : kz.pin;
  return countries.length ? countries : ["*"];
}

export function normalize(raw: RawJob) {
  return normalizeWithVerdict(raw).job;
}

function normalizeWithVerdict(raw: RawJob) {
  // External feeds occasionally carry NUL bytes, which Postgres rejects in text columns.
  const r = { ...raw, company: noNul(raw.company), title: noNul(raw.title), location: noNul(raw.location ?? ""), description: noNul(raw.description ?? ""), salaryText: raw.salaryText && noNul(raw.salaryText), industry: raw.industry && noNul(raw.industry) };
  // hh hook: structured salary (KZT/month → annual USD), experience → minYears, key_skills → stack (src/lib/hh/normalize.ts).
  const hh = r.source === "hh" ? hhNormalize(raw) : null;
  const text = `${r.title}\n${r.location}\n${r.description}${hh?.skillsText ? `\n${hh.skillsText}` : ""}`;
  const plain = stripHtml(r.description);
  const loc = r.location || "";
  let countries = COUNTRY_WORDS.filter(([re]) => re.test(loc)).map(([, c]) => c);
  if (countries.includes("EU*")) countries = [...countries.filter((c) => c !== "EU*"), ...EU];
  const remote = r.workplace ?? (r.remoteHint || /\bremote\b/i.test(loc) ? "remote" : /hybrid/i.test(`${loc} ${plain.slice(0, 1500)}`) ? "hybrid" : "onsite");
  const kz = openFromKazakhstan({ title: r.title, location: loc, description: plain, workplace: remote });
  countries = kzCountries(countries, remote, kz);
  const roleFamily = classifyRole(r.title);
  const years = plain.match(/(\d{1,2})\+?\s*(?:-\s*\d+\s*)?(?:years|yrs)/i);
  const minYears = hh?.minYears ?? (years ? Math.min(15, Number(years[1])) : 0);
  const seniority = seniorityFromTitle(r.title) ?? (minYears >= 6 ? "senior" : minYears >= 3 ? "middle" : minYears >= 1 ? "junior" : "middle");
  const sponsorship = /(unable|not able|cannot|can't|won't|will not|do not|don't)\s+(to\s+)?(offer\s+|provide\s+)?(visa\s+)?sponsor/i.test(plain) ? "no" : /(visa sponsorship|sponsor(ship)? (is )?available|we (can )?sponsor|relocation (support|package))/i.test(plain) ? "yes" : "unknown";
  const workAuth: string[] = [];
  const auth = plain.match(/(?:authori[sz]ed|eligible|right) to work in (?:the )?([A-Z][\w .]+?)(?:[.,;]| without| and)/);
  if (auth) {
    const c = COUNTRY_WORDS.find(([re]) => re.test(auth[1]))?.[1];
    if (c && c !== "*" && c !== "EU*") workAuth.push(c);
  }
  const languages = ["English"];
  for (const [lang, re] of [["German", /(fluent|native|business[- ]level|c1|c2)[^.]{0,40}german|german[^.]{0,30}(fluent|native|required|c1|c2)/i], ["French", /(fluent|native)[^.]{0,40}french|french[^.]{0,30}(fluent|native|required)/i], ["Russian", /(fluent|native)[^.]{0,40}russian|russian[^.]{0,30}(fluent|native|required)/i]] as const) if (re.test(plain)) languages.push(lang);
  const [salaryMin, salaryMax] = hh?.salary ?? parseSalary(r.salaryText || plain);
  const massHiring = MASS_HIRING_FAMILIES.includes(roleFamily) && (seniority === "junior" || seniority === "intern" || /hiring multiple|high[- ]volume|several positions|cohort|graduate program|no experience/i.test(plain)) || /graduate program|internship program/i.test(r.title);
  const job = {
    source: r.source, externalId: r.externalId, dedupeKey: dedupeKeyOf(r.company, r.title, loc),
    company: r.company, title: r.title.trim(), roleFamily, seniority, location: loc, countries: s(countries), remote,
    salaryMin, salaryMax, currency: "USD", description: plain.slice(0, 12000), requirements: s(bulletLines(plain).slice(0, 10)),
    technologies: s(extractSkills(text).slice(0, 10)), minYears, education: /(master'?s|phd)[^.]{0,30}required/i.test(plain) ? "Master's required" : "",
    workAuth: s(workAuth), sponsorship, languages: s(languages), industry: r.industry ?? "", companySize: "", massHiring, postedAt: r.postedAt, url: /^https?:\/\//i.test(r.url) ? r.url : "",
  };
  return { job, kz };
}

// "$60,000 – $80,000", "$60k-80k", "$60 - $80k". Bare 2–3 digit numbers are only thousands when a "k" says so.
const SALARY_RE = /\$\s?(\d{1,3})(?:[,.]?(\d{3}))?\s?(k\b)?\s?(?:-|–|to)\s?\$?\s?(\d{1,3})(?:[,.]?(\d{3}))?\s?(k\b)?/i;
const PERIOD_AFTER = /^\s*(?:usd\s*)?(?:\/\s*|per\s+|an?\s+|each\s+)?(?:hour|hr|h|month|mo)\b|^\s*(?:hourly|monthly)\b/i;
const PERIOD_BEFORE = /(?:hourly|monthly|per hour|per month)\b[^$\n]{0,20}$/i;

/** Annual USD range, or nulls when absent, hourly/monthly, or ambiguous. */
export function parseSalary(text: string): [number | null, number | null] {
  const m = SALARY_RE.exec(text);
  if (!m) return [null, null];
  const end = m.index + m[0].length;
  if (PERIOD_AFTER.test(text.slice(end, end + 24)) || PERIOD_BEFORE.test(text.slice(Math.max(0, m.index - 40), m.index))) return [null, null];
  const k = Boolean(m[3] || m[6]); // "$60-80k": one k covers both ends
  const num = (a: string, b?: string) => (b ? Number(a + b) : k ? Number(a) * 1000 : null);
  const lo = num(m[1], m[2]), hi = num(m[4], m[5]);
  if (!lo || !hi || lo < 15000 || hi < lo) return [null, null]; // still not an annual salary
  return [lo, hi];
}

function stripHtml(h: string) {
  return h.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<\/(p|li|div|h\d|br)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
function bulletLines(t: string) {
  return t.split("\n").map((l) => l.trim()).filter((l) => l.length > 25 && l.length < 220 && /(experience|knowledge|proficien|familiar|ability|degree|skills|years|strong)/i.test(l));
}

// ——— Sources ———
// Readers live in src/lib/sources/** (public ATS boards and job feeds; polite UA, timeouts, retries, a run deadline).
// Each takes (query, ctx) and returns RawJob[]; a reader that ignores ctx (e.g. hh) fits the same map.
export const SOURCES: Record<string, SourceFn> = {
  ...(process.env.HH_CLIENT_ID ? { hh: (q: string) => hhSource({ query: q }) } : {}), // hh.kz official API (src/lib/sources/hh.ts)
  remotive,
  arbeitnow,
  greenhouse: (_q, ctx) => readAts("greenhouse", ctx),
  lever: (_q, ctx) => readAts("lever", ctx),
  ashby: (_q, ctx) => readAts("ashby", ctx),
  workable: (_q, ctx) => readAts("workable", ctx),
  jobicy,
  himalayas: (q, ctx) => himalayas(q, ctx),
};

const DAY = 86400000;
/** ATS postings stay live as long as the board lists them, so their age is no reason to retire them. */
const LISTED_WHILE_OPEN = new Set<string>(ATS);

type UpsertStats = { added: number; seen: number; kzOpen: number; deferred: number };

/** Insert new vacancies, refresh known ones (active + fetchedAt, and geography for rows the same source owns). Batched. */
async function upsertBatch(raw: RawJob[], deadline = Infinity): Promise<UpsertStats> {
  const now = new Date();
  const byKey = new Map<string, ReturnType<typeof normalizeWithVerdict>>();
  for (const r of raw) {
    if (!r.title || !r.company) continue;
    const n = normalizeWithVerdict(r);
    if (!byKey.has(n.job.dedupeKey)) byKey.set(n.job.dedupeKey, n);
  }
  const list = [...byKey.values()];
  const stats: UpsertStats = { added: 0, seen: 0, kzOpen: list.filter((n) => n.kz.open).length, deferred: 0 };
  const CHUNK = 200;
  for (let i = 0; i < list.length; i += CHUNK) {
    if (Date.now() > deadline) { stats.deferred = list.length - i; break; }
    const chunk = list.slice(i, i + CHUNK);
    const existing = await db.job.findMany({ where: { dedupeKey: { in: chunk.map((n) => n.job.dedupeKey) } }, select: { id: true, dedupeKey: true, source: true, countries: true, remote: true } });
    if (existing.length) await db.job.updateMany({ where: { id: { in: existing.map((e) => e.id) } }, data: { active: true, fetchedAt: now } });
    // A classifier change reaches rows already stored: re-derive geography where it differs (same source only).
    const known = new Map(existing.map((e) => [e.dedupeKey, e]));
    for (const n of chunk) {
      const e = known.get(n.job.dedupeKey);
      if (e && e.source === n.job.source && (e.countries !== n.job.countries || e.remote !== n.job.remote)) await db.job.update({ where: { id: e.id }, data: { countries: n.job.countries, remote: n.job.remote } });
    }
    stats.seen += existing.length;
    const fresh = chunk.filter((n) => !known.has(n.job.dedupeKey)).map((n) => n.job);
    if (!fresh.length) continue;
    try {
      stats.added += (await db.job.createMany({ data: fresh })).count;
    } catch {
      for (const data of fresh) { // a concurrent run inserted one of them: fall back row by row
        try { await db.job.create({ data }); stats.added++; } catch { /* already there */ }
      }
    }
  }
  // Freshness: feed postings older than 60 days are retired. Demo rows are kept fresh by reanchorDemoJobs instead.
  await db.job.updateMany({ where: { source: { notIn: ["demo", ...LISTED_WHILE_OPEN] }, active: true, postedAt: { lt: new Date(Date.now() - 60 * DAY) } }, data: { active: false } });
  return stats;
}

export async function upsertJobs(raw: RawJob[]) {
  return (await upsertBatch(raw)).added;
}

/**
 * Boards to read this run for one ATS: the env override as is, else the bundled list rotated so the daily cron covers every
 * board over a few days — boards whose rows were fetched longest ago first. A board with no rows yet (new, empty or dead) is
 * due once per cycle, in a fixed daily group, so dead boards cannot take every run's slots.
 */
export async function pickBoards(ats: AtsName, perRun: number, now = Date.now()) {
  const env = envBoards(ats);
  if (env) return env;
  const all = DEFAULT_BOARDS[ats];
  if (all.length <= perRun) return all;
  const rows = await db.job.findMany({ where: { source: ats, externalId: { contains: ":" } }, select: { externalId: true, fetchedAt: true } });
  const last = new Map<string, number>();
  for (const r of rows) {
    const slug = r.externalId.slice(0, r.externalId.indexOf(":"));
    last.set(slug, Math.max(last.get(slug) ?? 0, r.fetchedAt.getTime()));
  }
  const cycle = Math.ceil(all.length / perRun), day = Math.floor(now / DAY);
  const age = (slug: string, i: number) => {
    const t = last.get(slug);
    return t != null ? now - t : (cycle - ((((day - Math.floor(i / perRun)) % cycle) + cycle) % cycle)) * DAY;
  };
  return all.map((b, i) => ({ b, age: age(b.slug, i), i })).sort((x, y) => y.age - x.age || x.i - y.i).slice(0, perRun).map((x) => x.b);
}

export type SourceReport = { added: number; fetched: number; kzOpen: number; retired: number; deferred: number; boards?: string; errors: string[] };
export type IngestReport = Record<string, SourceReport>;

const envInt = (name: string, dflt: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/**
 * Pull every source (in parallel, each with its own retries), then upsert them one by one — all within `budgetMs`.
 * Retires what a source stopped listing: rows of a fully read ATS board that are no longer on it, and any source's rows
 * not seen for 45 days. Demo rows are never touched.
 */
export async function ingestLive(query = "", opts: { budgetMs?: number; only?: string[] } = {}): Promise<IngestReport> {
  const started = Date.now();
  const budget = opts.budgetMs ?? envInt("SIMPLIFY_INGEST_BUDGET_MS", 120_000);
  const fetchDeadline = started + budget * 0.6, deadline = started + budget;
  const perRun = envInt("SIMPLIFY_ATS_BOARDS_PER_RUN", 25);
  const names = Object.keys(SOURCES).filter((n) => !opts.only || opts.only.includes(n));
  const report: IngestReport = {};

  const pulled = await Promise.all(names.map(async (name) => {
    const ctx: SourceCtx = { deadline: fetchDeadline, errors: [], completeBoards: [], maxPerBoard: envInt("SIMPLIFY_ATS_MAX_PER_BOARD", 150) };
    const isAts = (ATS as readonly string[]).includes(name);
    let raw: RawJob[] = [], failed = false;
    try {
      if (isAts) ctx.boards = await pickBoards(name as AtsName, perRun, started);
      raw = await SOURCES[name](query, ctx);
    } catch (e) {
      failed = true;
      ctx.errors.push(errMsg(e));
    }
    return { name, ctx, raw, failed, isAts };
  }));

  for (const { name, ctx, raw, failed, isAts } of pulled) {
    const r: SourceReport = { added: 0, fetched: raw.length, kzOpen: 0, retired: 0, deferred: 0, errors: ctx.errors.slice(0, 20) };
    if (ctx.errors.length > 20) r.errors.push(`… +${ctx.errors.length - 20}`);
    if (isAts && ctx.boards) r.boards = `${ctx.boardsRead ?? 0}/${ctx.boards.length}`;
    report[name] = r;
    try {
      const u = await upsertBatch(raw, deadline);
      Object.assign(r, { added: u.added, kzOpen: u.kzOpen, deferred: u.deferred });
      if (u.deferred) r.errors.push(`${u.deferred} posting(s) deferred: time budget`);
      if (failed || (!raw.length && ctx.errors.length)) continue; // a failed pull says nothing about what closed
      if (isAts && !u.deferred) {
        for (const slug of ctx.completeBoards ?? []) {
          r.retired += (await db.job.updateMany({ where: { source: name, active: true, externalId: { startsWith: `${slug}:` }, fetchedAt: { lt: new Date(started) } }, data: { active: false } })).count;
        }
      }
      r.retired += (await db.job.updateMany({ where: { source: name, active: true, fetchedAt: { lt: new Date(started - 45 * DAY) } }, data: { active: false } })).count;
    } catch (e) {
      r.errors.push(errMsg(e));
    }
  }
  return report;
}

// SEED_JOBS repeats some company|title|location combos, so the corpus holds fewer rows than entries.
const DEMO_KEYS = new Set(SEED_JOBS.map((j) => dedupeKeyOf(j.company, j.title, j.location))).size;
const demoIndex = (externalId: string) => Number(externalId.replace(/^demo-/, ""));

/** Demo corpus: always present so a campaign can run offline. Dates are re-anchored to "now". */
export async function ensureSeedJobs() {
  const count = await db.job.count({ where: { source: "demo" } });
  const added = count >= DEMO_KEYS ? 0 : await upsertJobs(SEED_JOBS.map((j, i) => ({ ...j, source: "demo", externalId: `demo-${i}`, url: `https://jobs.example.com/demo-${i}`, postedAt: new Date(Date.now() - j.ageHours * 3600000) })));
  await reanchorDemoJobs();
  return added;
}

/**
 * Demo vacancies keep their seeded relative ages (1h … ~50 days) but slide forward with the calendar;
 * otherwise after ~30 days every demo job is stale (and after 60 retired) and campaigns stop qualifying anything.
 */
async function reanchorDemoJobs() {
  const newest = await db.job.findFirst({ where: { source: "demo" }, orderBy: { postedAt: "desc" }, select: { postedAt: true } });
  if (!newest || Date.now() - newest.postedAt.getTime() <= 86400000) return;
  const now = Date.now();
  const rows = await db.job.findMany({ where: { source: "demo" }, select: { id: true, externalId: true } });
  await db.$transaction(rows.map((r) => {
    const ageHours = SEED_JOBS[demoIndex(r.externalId)]?.ageHours ?? 24;
    return db.job.update({ where: { id: r.id }, data: { postedAt: new Date(now - ageHours * 3600000), active: true } });
  }));
}

/**
 * Re-derive every demo vacancy's normalized fields (role family, seniority, years, stack…) from the current normalize().
 * Used by the demo seed so a classifier change reaches rows created by an older version.
 */
export async function renormalizeDemoJobs() {
  await ensureSeedJobs();
  const rows = await db.job.findMany({ where: { source: "demo" }, select: { id: true, externalId: true, postedAt: true } });
  let n = 0;
  for (const r of rows) {
    const seed = SEED_JOBS[demoIndex(r.externalId)];
    if (!seed) continue;
    const x = normalize({ ...seed, source: "demo", externalId: r.externalId, url: `https://jobs.example.com/${r.externalId}`, postedAt: r.postedAt });
    await db.job.update({
      where: { id: r.id },
      data: {
        roleFamily: x.roleFamily, seniority: x.seniority, minYears: x.minYears, massHiring: x.massHiring, technologies: x.technologies, requirements: x.requirements,
        countries: x.countries, remote: x.remote, sponsorship: x.sponsorship, workAuth: x.workAuth, languages: x.languages, education: x.education,
        salaryMin: x.salaryMin, salaryMax: x.salaryMax, description: x.description, industry: x.industry, active: true,
      },
    });
    n++;
  }
  return n;
}
