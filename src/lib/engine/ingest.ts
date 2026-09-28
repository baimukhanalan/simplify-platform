import "server-only";
import { db, s } from "../db";
import { classifyRole, seniorityFromTitle, extractSkills, MASS_HIRING_FAMILIES } from "./taxonomy";
import { SEED_JOBS } from "./seed-jobs";

// ——— Normalization: every source is mapped to one vacancy structure ———
export type RawJob = { source: string; externalId: string; company: string; title: string; location: string; description: string; url: string; postedAt: Date; remoteHint?: boolean; salaryText?: string; tags?: string[]; industry?: string };

const COUNTRY_WORDS: [RegExp, string][] = [
  [/\b(united states|usa|u\.s\.|\bus\b|new york|san francisco|seattle|austin|boston|chicago|remote - us|americas)\b/i, "US"],
  [/\b(united kingdom|\buk\b|london|manchester|england)\b/i, "GB"], [/\b(canada|toronto|vancouver|montreal)\b/i, "CA"],
  [/\b(germany|deutschland|berlin|munich|münchen|hamburg|frankfurt|köln|cologne)\b/i, "DE"], [/\b(netherlands|amsterdam|rotterdam)\b/i, "NL"],
  [/\b(poland|warsaw|kraków|krakow|wroclaw)\b/i, "PL"], [/\b(spain|madrid|barcelona)\b/i, "ES"], [/\b(france|paris)\b/i, "FR"], [/\b(ireland|dublin)\b/i, "IE"],
  [/\b(portugal|lisbon|porto)\b/i, "PT"], [/\b(estonia|tallinn)\b/i, "EE"], [/\b(austria|vienna|wien)\b/i, "AT"], [/\b(sweden|stockholm)\b/i, "SE"],
  [/\b(kazakhstan|almaty|astana|алматы|астана)\b/i, "KZ"], [/\b(uzbekistan|tashkent)\b/i, "UZ"], [/\b(uae|dubai|abu dhabi)\b/i, "AE"],
  [/\b(worldwide|anywhere|global)\b/i, "*"], [/\b(europe|emea|eu)\b/i, "EU*"],
];
const EU = ["DE", "NL", "PL", "ES", "FR", "IE", "PT", "SE", "EE", "LT", "CZ", "AT", "BE", "DK", "FI", "IT"];

export function normalize(r: RawJob) {
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
  const sal = (r.salaryText || plain).match(/\$\s?(\d{2,3})(?:[,.]?(\d{3}))?\s?(k)?\s?(?:-|–|to)\s?\$?\s?(\d{2,3})(?:[,.]?(\d{3}))?\s?(k)?/i);
  const toNum = (a?: string, b?: string, k?: string) => (a ? (b ? Number(a + b) : Number(a) * (k || Number(a) < 1000 ? 1000 : 1)) : null);
  let salaryMin = sal ? toNum(sal[1], sal[2], sal[3]) : null;
  let salaryMax = sal ? toNum(sal[4], sal[5], sal[6]) : null;
  if (salaryMin && salaryMin < 15000) salaryMin = salaryMax = null; // hourly/monthly noise
  const massHiring = MASS_HIRING_FAMILIES.includes(roleFamily) && (seniority === "junior" || seniority === "intern" || /hiring multiple|high[- ]volume|several positions|cohort|graduate program|no experience/i.test(plain)) || /graduate program|internship program/i.test(r.title);
  return {
    source: r.source, externalId: r.externalId, dedupeKey: `${r.company}|${r.title}|${loc}`.toLowerCase().replace(/\s+/g, " ").slice(0, 190),
    company: r.company, title: r.title.trim(), roleFamily, seniority, location: loc, countries: s(countries), remote,
    salaryMin, salaryMax, currency: "USD", description: plain.slice(0, 12000), requirements: s(bulletLines(plain).slice(0, 10)),
    technologies: s(extractSkills(text).slice(0, 10)), minYears, education: /(master'?s|phd)[^.]{0,30}required/i.test(plain) ? "Master's required" : "",
    workAuth: s(workAuth), sponsorship, languages: s(languages), industry: r.industry ?? "", companySize: "", massHiring, postedAt: r.postedAt, url: r.url,
  };
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
  // Freshness: anything older than 60 days is retired.
  await db.job.updateMany({ where: { postedAt: { lt: new Date(Date.now() - 60 * 86400000) } }, data: { active: false } });
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

/** Demo corpus: always present so a campaign can run offline. Dates are re-anchored to "now". */
export async function ensureSeedJobs() {
  const count = await db.job.count({ where: { source: "demo" } });
  if (count >= SEED_JOBS.length) return 0;
  return upsertJobs(SEED_JOBS.map((j, i) => ({ ...j, source: "demo", externalId: `demo-${i}`, url: `https://jobs.example.com/demo-${i}`, postedAt: new Date(Date.now() - j.ageHours * 3600000) })));
}
