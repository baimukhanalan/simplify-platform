import "server-only";
import { db, j, s } from "./db";
import { parseCV, type ParsedCV } from "./engine/profile";
import { assessReadiness, suggestAdjacentRoles, type Readiness, type ReadinessInput } from "./engine/readiness";
import { scoreJob, type CandidateCtx, type MatchResult } from "./engine/matching";
import { jobCtx } from "./engine/agent";
import { ensureSeedJobs } from "./engine/ingest";
import { buildPackageHeuristic, type FactLite, type ProfileLite } from "./engine/personalize";
import { ROLE_FAMILIES, classifyRole, seniorityFromYears } from "./engine/taxonomy";
import { toUSD } from "./engine/fx";

/* ——————————————————————————— Onboarding wizard ——————————————————————————— */

export const ONBOARDING_STEPS = [
  { n: 1, key: "cv", label: "CV", title: "Загрузите CV" },
  { n: 2, key: "facts", label: "Опыт", title: "Проверьте опыт" },
  { n: 3, key: "interview", label: "Мини-интервью", title: "Усильте опыт" },
  { n: 4, key: "prefs", label: "Право на работу", title: "Предпочтения и авторизация" },
  { n: 5, key: "goal", label: "Career Goal", title: "Цель кампании" },
  { n: 6, key: "readiness", label: "Readiness", title: "Реалистичность цели" },
  { n: 7, key: "plan", label: "План", title: "Запуск кампании" },
] as const;
export const LAST_STEP = ONBOARDING_STEPS.length;

export async function markStepDone(userId: string, step: number) {
  const done = await completedSteps(userId);
  if (done.has(step)) return;
  await db.event.create({ data: { userId, type: "onboarding_step", message: `Онбординг: шаг «${ONBOARDING_STEPS[step - 1]?.label ?? step}» пройден`, data: s({ step }) } });
}

export async function completedSteps(userId: string) {
  const events = await db.event.findMany({ where: { userId, type: "onboarding_step" }, select: { data: true } });
  return new Set(events.map((e) => j<{ step?: number }>(e.data, {}).step).filter((n): n is number => typeof n === "number"));
}

/** Where to resume: the first step not yet completed (also inferring from existing data for older accounts). */
export function resumeStep(done: Set<number>, hints: { hasCv: boolean; hasGoal: boolean }) {
  const inferred = new Set(done);
  if (hints.hasCv) inferred.add(1);
  if (hints.hasGoal) inferred.add(5);
  for (const st of ONBOARDING_STEPS) if (!inferred.has(st.n)) return st.n;
  return LAST_STEP;
}

type UserForReadiness = {
  profile: { yearsExperience: number; skills: string; englishLevel: string; cvText: string; summary: string; workAuth: string; needsSponsorship: boolean; linkedin: string; github: string; portfolio: string } | null;
  goal: { primaryRole: string; seniority: string; minSalary: number; currency?: string; countries: string; workModes: string; dreamCompanies: string; sponsorshipNeeded: boolean } | null;
  facts: { kind: string; metrics: string; verified: boolean }[];
};

export function readinessInputFor(u: UserForReadiness, stories: number): ReadinessInput {
  const p = u.profile, g = u.goal;
  return {
    profile: {
      yearsExperience: p?.yearsExperience ?? 0, skills: j(p?.skills, []), englishLevel: p?.englishLevel ?? "B1", cvText: p?.cvText ?? "", summary: p?.summary ?? "",
      workAuth: j(p?.workAuth, []), needsSponsorship: p?.needsSponsorship ?? true, linkedin: p?.linkedin ?? "", github: p?.github ?? "", portfolio: p?.portfolio ?? "",
    },
    facts: u.facts,
    stories,
    goal: {
      primaryRole: g?.primaryRole ?? "", seniority: g?.seniority ?? "junior", minSalary: toUSD(g?.minSalary ?? 0, g?.currency), countries: j(g?.countries, []),
      workModes: j(g?.workModes, ["remote"]), dreamCompanies: j(g?.dreamCompanies, []), sponsorshipNeeded: g?.sponsorshipNeeded ?? true,
    },
  };
}

export async function readinessForUser(userId: string): Promise<Readiness> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, goal: true, facts: true, _count: { select: { stories: true } } } });
  return assessReadiness(readinessInputFor(u, u._count.stories));
}

/* ——————————————————————————— Free Career Check ——————————————————————————— */

export type CheckResult = {
  v: 1;
  target: string;
  roleLabel: string;
  seniority: string;
  years: number;
  english: string;
  skills: string[];
  factsCount: number;
  metricsCount: number;
  by: "claude" | "engine";
  readiness: Readiness;
  strengths: string[];
  weaknesses: string[];
  roles: string[];
  job: null | {
    title: string; company: string; location: string; remote: string; salary: string | null; industry: string;
    match: number; reasons: MatchResult["reasons"]; eligibility: MatchResult["eligibility"]; blockers: string[]; softGaps: string[]; pInterview: number;
  };
  positioning: null | { before: string; headline: string; after: string; skillsBefore: string[]; skillsAfter: string[] };
};

const EN_IDX: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function bestFamilyBySkills(skills: string[]) {
  const have = new Set(skills.map((x) => x.toLowerCase()));
  let best = "other", bestCov = 0;
  for (const [k, f] of Object.entries(ROLE_FAMILIES)) {
    if (k === "other" || !f.skills.length) continue;
    const cov = f.skills.filter((x) => have.has(x.toLowerCase())).length / Math.min(5, f.skills.length);
    if (cov > bestCov) { best = k; bestCov = cov; }
  }
  return best;
}

const fmtSalary = (min: number | null, max: number | null, cur: string) => {
  if (!min && !max) return null;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : `${cur} `;
  return min && max ? `${sym}${k(min)}–${k(max)}` : `${sym}${k((min || max)!)}`;
};

/** Anonymous Career Check: parse → readiness → best vacancy → positioning example. Nothing is invented. */
export async function buildCareerCheck(cvText: string, targetRaw: string): Promise<CheckResult> {
  const { data: parsed, by } = await parseCV(cvText);
  const cv: ParsedCV = parsed;
  const target = targetRaw.trim();
  let family = classifyRole(target || cv.headline || "");
  if (family === "other") family = bestFamilyBySkills(cv.skills);
  const roleLabel = target || ROLE_FAMILIES[family]?.label || "Other";
  const seniority = seniorityFromYears(cv.yearsExperience);
  const english = EN_IDX[cv.englishLevel] ? cv.englishLevel : "B1";
  const intl = (EN_IDX[english] ?? 3) >= 4;
  const countries = intl ? ["KZ", "CIS", "WORLD"] : ["KZ", "CIS"];
  const workModes = ["remote", "hybrid"];

  const readiness = assessReadiness({
    profile: { yearsExperience: cv.yearsExperience, skills: cv.skills, englishLevel: english, cvText, summary: cv.summary, workAuth: ["KZ"], needsSponsorship: true, linkedin: cv.linkedin, github: cv.github, portfolio: "" },
    facts: cv.facts.map((f) => ({ kind: f.kind, metrics: f.metrics, verified: false })),
    stories: 0,
    goal: { primaryRole: roleLabel, seniority, minSalary: 0, countries, workModes, dreamCompanies: [], sponsorshipNeeded: true },
  });

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const c of readiness.checks) {
    if (c.key === "stories" || c.key === "experience") continue; // not meaningful before facts are reviewed
    (c.status === "ok" ? strengths : weaknesses).push(`${c.label}: ${c.note}`);
  }
  if (cv.skills.length >= 5) strengths.unshift(`${cv.skills.length} hard skills распознано в CV`);
  const roles = Array.from(new Set([ROLE_FAMILIES[family]?.label, ...suggestAdjacentRoles(family, cv.skills)].filter((x): x is string => Boolean(x) && x !== "Other"))).slice(0, 4);

  // Best single vacancy from the live/demo corpus.
  await ensureSeedJobs();
  const jobs = await db.job.findMany({ where: { active: true }, orderBy: { postedAt: "desc" }, take: 400 });
  const ctx: CandidateCtx = {
    skills: cv.skills, yearsExperience: cv.yearsExperience, englishLevel: english, languages: ["English", "Russian"], workAuth: ["KZ"], needsSponsorship: true, relocation: false,
    educationLevel: cv.facts.some((f) => f.kind === "education" && /master|магистр|msc/i.test(f.title)) ? "master" : cv.facts.some((f) => f.kind === "education") ? "bachelor" : "none",
    goal: { primaryRole: roleLabel, extraRoles: [], seniority, minSalary: 0, countries, workModes, industries: [], dreamCompanies: [], blockedCompanies: [], mode: "autonomous" },
    allocation: {},
  };
  const rank = (m: MatchResult, fam: string) => (m.eligibility === "blocked" ? 0 : m.eligibility === "soft" ? 1 : 2) * 1000 + (fam === family ? 200 : 0) + m.match;
  let best: { job: (typeof jobs)[number]; m: MatchResult; r: number } | null = null;
  for (const job of jobs) {
    const m = scoreJob(ctx, jobCtx(job));
    const r = rank(m, job.roleFamily);
    if (!best || r > best.r) best = { job, m, r };
  }

  let positioning: CheckResult["positioning"] = null;
  let jobOut: CheckResult["job"] = null;
  if (best) {
    const { job, m } = best;
    const jl = jobCtx(job);
    jobOut = {
      title: job.title, company: job.company, location: job.location, remote: job.remote, salary: fmtSalary(job.salaryMin, job.salaryMax, job.currency), industry: job.industry,
      match: m.match, reasons: m.reasons, eligibility: m.eligibility, blockers: m.blockers, softGaps: m.softGaps, pInterview: m.pInterview,
    };
    const profile: ProfileLite = {
      name: cv.name || "Candidate", email: "", phone: "", location: cv.location, headline: cv.headline, summary: cv.summary, skills: cv.skills,
      yearsExperience: cv.yearsExperience, englishLevel: english, workAuth: ["KZ"], needsSponsorship: true, relocation: false,
      linkedin: "", github: "", portfolio: "", noticePeriod: "2 weeks", salaryExpectation: 0, citizenship: "KZ",
    };
    const facts: FactLite[] = cv.facts.map((f, i) => ({ id: `f${i}`, ...f, verified: false }));
    const pkg = buildPackageHeuristic(profile, facts, jl);
    positioning = {
      before: cv.summary,
      headline: cv.headline,
      after: pkg.summary,
      skillsBefore: cv.skills.slice(0, 10),
      skillsAfter: pkg.skillsOrder.slice(0, 10),
    };
  }

  return {
    v: 1, target, roleLabel, seniority, years: cv.yearsExperience, english, skills: cv.skills,
    factsCount: cv.facts.length, metricsCount: cv.facts.filter((f) => f.metrics).length, by,
    readiness, strengths: strengths.slice(0, 5), weaknesses: weaknesses.slice(0, 5), roles, job: jobOut, positioning,
  };
}
