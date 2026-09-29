import "server-only";
import { db, j } from "../db";
import { FICTIONAL_SOURCE } from "../mode";
import { scoreJob, STRONG_MATCH, planCountries, type CandidateCtx, type JobCtx } from "./matching";
import { classifyRole, goalTitle, normalizeLanguage, roleKey, seniorityFromYears, seniorityIndex, SENIORITY, type Seniority } from "./taxonomy";
import { CORPUS_REGIONS, FX_PREFIX, VARIANT_SPAN, tailorSignature, tailoredSeeds, type Region, type TailorSpec } from "./seed-jobs";
import { upsertFictional } from "./ingest";

/** Unseen internal roles that fit the goal (on-goal, not blocked, Match ≥ STRONG_MATCH) the agent should always have. */
export const COVERAGE_MIN = 15;
/** Never generate more than this many tailored roles for one goal spec. */
const MAX_PER_SPEC = 600;

const EN: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

/** The tailor spec for a candidate: goal family / level / regions (inside the plan), formats, skills and constraints. */
export function tailorSpecFor(c: CandidateCtx): TailorSpec {
  const family = classifyRole(c.goal.primaryRole);
  const byYears = seniorityFromYears(c.yearsExperience);
  const goalLevel = (SENIORITY as readonly string[]).includes(c.goal.seniority) ? (c.goal.seniority as Seniority) : byYears;
  // Never above what the years can reach (one step up at most): such roles would be hard-blocked anyway.
  const level = SENIORITY[Math.min(seniorityIndex(goalLevel), seniorityIndex(byYears) + 1)];
  const scope = planCountries(c.plan);
  const inPlan = (r: Region) => !scope || r === "WORLD" || (r === "KZ" ? scope.has("KZ") : r === "CIS" ? scope.has("UZ") : r === "EU" ? scope.has("DE") : r === "UK" ? scope.has("GB") : r === "US" ? scope.has("US") : scope.has("AE"));
  const wanted = c.goal.countries.map((x) => (x === "CA" ? "WORLD" : x)).filter((x): x is Region => (CORPUS_REGIONS as string[]).includes(x));
  let regions = [...new Set(wanted)].filter(inPlan);
  if (!regions.length) regions = (["KZ", "WORLD"] as Region[]).filter(inPlan);
  const spoken = new Set(c.languages.map(normalizeLanguage));
  return {
    family, title: goalTitle(c.goal.primaryRole), level, regions, workModes: c.goal.workModes.length ? c.goal.workModes : ["remote", "hybrid"],
    skills: c.skills, minSalaryUsd: c.goal.minSalary || 0, workAuth: c.workAuth, english: (EN[c.englishLevel] ?? 3) >= 3,
    relocation: c.relocation, russian: spoken.has("Russian"), maxYears: c.yearsExperience,
  };
}

const toCtx = (job: { title: string; company: string; roleFamily: string; seniority: string; countries: string; remote: string; salaryMin: number | null; salaryMax: number | null; technologies: string; requirements: string; minYears: number; education: string; workAuth: string; sponsorship: string; languages: string; industry: string; massHiring: boolean; postedAt: Date }): JobCtx => ({
  ...job, countries: j<string[]>(job.countries, []), technologies: j<string[]>(job.technologies, []), requirements: j<string[]>(job.requirements, []),
  workAuth: j<string[]>(job.workAuth, []), languages: j<string[]>(job.languages, []),
});

/**
 * Internal roles that fit this candidate and are not in any of the user's campaigns yet (nor the same company + role).
 * `wanted` = the goal's role families.
 */
export async function unseenFittingRoles(userId: string, c: CandidateCtx) {
  const wanted = [...new Set([c.goal.primaryRole, ...c.goal.extraRoles].map(classifyRole))];
  const [jobs, mine] = await Promise.all([
    db.job.findMany({
      where: { source: FICTIONAL_SOURCE, active: true, roleFamily: { in: wanted } },
      select: { id: true, title: true, company: true, roleFamily: true, seniority: true, countries: true, remote: true, salaryMin: true, salaryMax: true, technologies: true, requirements: true, minYears: true, education: true, workAuth: true, sponsorship: true, languages: true, industry: true, massHiring: true, postedAt: true },
    }),
    db.opportunity.findMany({ where: { campaign: { userId } }, select: { jobId: true, job: { select: { company: true, title: true } } } }),
  ]);
  const seen = new Set(mine.map((o) => o.jobId));
  const taken = new Set(mine.map((o) => roleKey(o.job.company, o.job.title)));
  return jobs.filter((job) => {
    if (seen.has(job.id) || taken.has(roleKey(job.company, job.title))) return false;
    const r = scoreJob(c, toCtx(job));
    return r.onGoal && r.eligibility !== "blocked" && r.match >= STRONG_MATCH && r.freshnessDays <= 30;
  }).length;
}

/**
 * Keeps the internal corpus stocked for a goal: when fewer than COVERAGE_MIN unseen fitting roles are left, roles
 * tailored to the goal (family, level, regions, formats, the user's own tools) are added — new postings, as a live
 * market would bring. Deterministic: the same goal always gets the same roles, never duplicates. Returns how many
 * roles were added.
 */
export async function ensureFictionalCoverage(userId: string, c: CandidateCtx, min = COVERAGE_MIN) {
  let have = await unseenFittingRoles(userId, c);
  if (have >= min) return 0;
  const spec = tailorSpecFor(c);
  const sig = tailorSignature(spec);
  let added = 0;
  let jump = 0; // index to continue from when the last batch added nothing: the next variant block (new titles)
  for (let round = 0; round < 4 && have < min; round++) {
    const prefix = `${FX_PREFIX}g-${sig}-`;
    const made = await db.job.findMany({ where: { source: FICTIONAL_SOURCE, externalId: { startsWith: prefix } }, select: { externalId: true } });
    if (made.length >= MAX_PER_SPEC) break;
    // Continue after the highest index generated so far (the generator skips indices it can't place).
    const offset = Math.max(jump, made.reduce((m, x) => Math.max(m, Number(x.externalId.slice(prefix.length)) + 1 || 0), 0));
    const seeds = tailoredSeeds(spec, min - have + 5, offset);
    const n = seeds.length ? await upsertFictional(seeds) : 0;
    added += n;
    const before = have;
    have = await unseenFittingRoles(userId, c);
    // Nothing new (every combination of this block is taken or already seen): vary the templates — the next block
    // brings team variants of the titles at other companies / cities, so narrow goals never run dry.
    if (!n || have <= before) jump = (Math.floor(offset / VARIANT_SPAN) + 1) * VARIANT_SPAN;
  }
  return added;
}
