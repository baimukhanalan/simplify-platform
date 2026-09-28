import "server-only";
import { db, s, noNul } from "../db";
import { classifyRole, seniorityFromTitle, extractSkills, wordRe, MASS_HIRING_FAMILIES } from "./taxonomy";
import { SEED_JOBS } from "./seed-jobs";

// ——— Normalization: every source is mapped to one vacancy structure ———
export type RawJob = { source: string; externalId: string; company: string; title: string; location: string; description: string; url: string; postedAt: Date; remoteHint?: boolean; salaryText?: string; tags?: string[]; industry?: string };

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

export function normalize(raw: RawJob) {
  // External feeds occasionally carry NUL bytes, which Postgres rejects in text columns.
  const r = { ...raw, company: noNul(raw.company), title: noNul(raw.title), location: noNul(raw.location ?? ""), description: noNul(raw.description ?? ""), salaryText: raw.salaryText && noNul(raw.salaryText), industry: raw.industry && noNul(raw.industry) };
  const text = `${r.title}\n${r.location}\n${r.description}`;
  const plain = stripHtml(r.description);
  const loc = r.location || "";
  let countries = COUNTRY_WORDS.filter(([re]) => re.test(loc)).map(([, c]) => c);
  if (countries.includes("EU*")) countries = [...countries.filter((c) => c !== "EU*"), ...EU];
  const remote = r.remoteHint || /\bremote\b/i.test(loc) ? "remote" : /hybrid/i.test(`${loc} ${plain.slice(0, 1500)}`) ? "hybrid" : "onsite";
  if (remote === "remote" && !countries.length) countries = ["*"];
  const roleFamily = classifyRole(r.title);
  const years = plain.match(/(\d{1,2})\+?\s*(?:-\s*\d+\s*)?(?:years|yrs)/i);
  const minYears = years ? Math.min(15, Number(years[1])) : 0;
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
  const [salaryMin, salaryMax] = parseSalary(r.salaryText || plain);
  const massHiring = MASS_HIRING_FAMILIES.includes(roleFamily) && (seniority === "junior" || seniority === "intern" || /hiring multiple|high[- ]volume|several positions|cohort|graduate program|no experience/i.test(plain)) || /graduate program|internship program/i.test(r.title);
  return {
    source: r.source, externalId: r.externalId, dedupeKey: dedupeKeyOf(r.company, r.title, loc),
    company: r.company, title: r.title.trim(), roleFamily, seniority, location: loc, countries: s(countries), remote,
    salaryMin, salaryMax, currency: "USD", description: plain.slice(0, 12000), requirements: s(bulletLines(plain).slice(0, 10)),
    technologies: s(extractSkills(text).slice(0, 10)), minYears, education: /(master'?s|phd)[^.]{0,30}required/i.test(plain) ? "Master's required" : "",
    workAuth: s(workAuth), sponsorship, languages: s(languages), industry: r.industry ?? "", companySize: "", massHiring, postedAt: r.postedAt, url: /^https?:\/\//i.test(r.url) ? r.url : "",
  };
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
async function getJSON(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "SimplifyCareerAgent/1.0" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

export const SOURCES: Record<string, (q: string) => Promise<RawJob[]>> = {
  remotive: async (q) => {
    const d = await getJSON(`https://remotive.com/api/remote-jobs?limit=80${q ? `&search=${encodeURIComponent(q)}` : ""}`);
    return (d.jobs ?? []).map((j: Record<string, string>) => ({ source: "remotive", externalId: String(j.id), company: j.company_name, title: j.title, location: `Remote ${j.candidate_required_location ?? ""}`, description: j.description ?? "", url: j.url, postedAt: new Date(j.publication_date), remoteHint: true, salaryText: j.salary, industry: j.category }));
  },
  arbeitnow: async () => {
    const d = await getJSON("https://www.arbeitnow.com/api/job-board-api");
    return (d.data ?? []).slice(0, 100).map((j: Record<string, unknown>) => ({ source: "arbeitnow", externalId: String(j.slug), company: String(j.company_name), title: String(j.title), location: `${j.location}${j.remote ? " Remote" : ""}, Germany`, description: String(j.description ?? ""), url: String(j.url), postedAt: new Date(Number(j.created_at) * 1000), remoteHint: Boolean(j.remote) }));
  },
  greenhouse: async () => {
    const boards = (process.env.SIMPLIFY_GREENHOUSE_BOARDS ?? "gitlab,remotecom,wise").split(",").map((b) => b.trim()).filter(Boolean);
    const all = await Promise.allSettled(boards.map(async (b) => {
      const d = await getJSON(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs?content=true`);
      return (d.jobs ?? []).slice(0, 60).map((j: { id: number; title: string; location?: { name: string }; absolute_url: string; updated_at: string; content?: string; company_name?: string }) => ({ source: "greenhouse", externalId: `${b}-${j.id}`, company: j.company_name ?? b, title: j.title, location: j.location?.name ?? "", description: j.content ?? "", url: j.absolute_url, postedAt: new Date(j.updated_at) }));
    }));
    return all.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  },
  lever: async () => {
    const cos = (process.env.SIMPLIFY_LEVER_COMPANIES ?? "palantir").split(",").map((b) => b.trim()).filter(Boolean);
    const all = await Promise.allSettled(cos.map(async (c) => {
      const d = await getJSON(`https://api.lever.co/v0/postings/${c}?mode=json&limit=60`);
      return (d ?? []).map((j: { id: string; text: string; categories?: { location?: string }; hostedUrl: string; createdAt: number; descriptionPlain?: string; workplaceType?: string }) => ({ source: "lever", externalId: j.id, company: c.charAt(0).toUpperCase() + c.slice(1), title: j.text, location: j.categories?.location ?? "", description: j.descriptionPlain ?? "", url: j.hostedUrl, postedAt: new Date(j.createdAt), remoteHint: j.workplaceType === "remote" }));
    }));
    return all.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  },
};

export async function upsertJobs(raw: RawJob[]) {
  let added = 0;
  for (const r of raw) {
    if (!r.title || !r.company) continue;
    const n = normalize(r);
    const existing = await db.job.findUnique({ where: { dedupeKey: n.dedupeKey }, select: { id: true } });
    if (existing) await db.job.update({ where: { id: existing.id }, data: { active: true, fetchedAt: new Date() } });
    else { await db.job.create({ data: n }); added++; }
  }
  // Freshness: anything older than 60 days is retired. Demo rows are kept fresh by reanchorDemoJobs instead.
  await db.job.updateMany({ where: { source: { not: "demo" }, postedAt: { lt: new Date(Date.now() - 60 * 86400000) } }, data: { active: false } });
  return added;
}

export async function ingestLive(query = "") {
  const report: Record<string, number | string> = {};
  for (const [name, fn] of Object.entries(SOURCES)) {
    try {
      const raw = await fn(query);
      report[name] = await upsertJobs(raw);
    } catch (e) {
      report[name] = `error: ${e instanceof Error ? e.message : e}`;
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
