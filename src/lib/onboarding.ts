import "server-only";
import { db, j, s } from "./db";
import { parseCV, type ParsedCV } from "./engine/profile";
import { assessReadiness, suggestAdjacentRoles, type Readiness, type ReadinessInput } from "./engine/readiness";
import { scoreJob, type CandidateCtx, type MatchResult } from "./engine/matching";
import { jobCtx } from "./engine/agent";
import { ensureSeedJobs } from "./engine/ingest";
import { buildPackageHeuristic, type FactLite, type ProfileLite } from "./engine/personalize";
import { ROLE_FAMILIES, REGIONS, classifyRole, seniorityFromYears } from "./engine/taxonomy";
import { toUSD } from "./engine/fx";

/* ——————————————————————————— Onboarding wizard ——————————————————————————— */

export const ONBOARDING_STEPS = [
  { n: 1, key: "sources", label: "Твой опыт", title: "CV, LinkedIn, ссылки" },
  { n: 2, key: "chat", label: "Уточнения", title: "Пара вопросов от агента" },
  { n: 3, key: "goal", label: "Цель", title: "Подтверди цель" },
  { n: 4, key: "readiness", label: "Readiness", title: "Где ты сейчас" },
  { n: 5, key: "plan", label: "Запуск", title: "Выбери кампанию" },
] as const;
export const LAST_STEP = ONBOARDING_STEPS.length;
export const STEP = { sources: 1, chat: 2, goal: 3, readiness: 4, plan: 5 } as const;

export async function markStepDone(userId: string, step: number) {
  const done = await completedSteps(userId);
  if (done.has(step)) return;
  await db.event.create({ data: { userId, type: "onboarding_step", message: `Онбординг: шаг «${ONBOARDING_STEPS[step - 1]?.label ?? step}» пройден`, data: s({ step, v: 2 }) } });
}

export async function completedSteps(userId: string) {
  // v2 = the 5-step conversational onboarding; older 7-step events are ignored.
  const events = await db.event.findMany({ where: { userId, type: "onboarding_step" }, select: { data: true } });
  return new Set(events.map((e) => j<{ step?: number; v?: number }>(e.data, {})).filter((d) => d.v === 2).map((d) => d.step).filter((n): n is number => typeof n === "number"));
}

/** Where to resume: the first step not yet completed (a stored CV counts as step 1 for older accounts). */
export function resumeStep(done: Set<number>, hints: { hasCv: boolean }) {
  const inferred = new Set(done);
  if (hints.hasCv) inferred.add(STEP.sources);
  for (const st of ONBOARDING_STEPS) if (!inferred.has(st.n)) return st.n;
  return LAST_STEP;
}

/* ——————————————————————————— Conversational clarifications (step 2) ——————————————————————————— */

export type ChatOption = { value: string; label: string };
export type ChatTurn = {
  id: string;
  prompt: string;
  hint?: string;
  kind: "text" | "choice";
  options?: ChatOption[];
  placeholder?: string;
  /** Saved answer (option value or text); "" = skipped; null = not answered yet. */
  answer: string | null;
  /** Pre-selected option derived from the CV. */
  suggested?: string;
  factId?: string;
};

const INTL_AUTH: Record<string, { where: string; codes: string[] }> = {
  US: { where: "в США", codes: ["US"] },
  EU: { where: "в Европейском союзе", codes: REGIONS.EU.countries },
  UK: { where: "в Великобритании", codes: ["GB"] },
  CA: { where: "в Канаде", codes: ["CA"] },
  MENA: { where: "в ОАЭ", codes: ["AE"] },
};
export const intlAuthRegions = () => INTL_AUTH;

const CITIZENSHIP_OPTIONS: ChatOption[] = [
  { value: "KZ", label: "Казахстан" }, { value: "UZ", label: "Узбекистан" }, { value: "KG", label: "Кыргызстан" }, { value: "RU", label: "Россия" },
  { value: "BY", label: "Беларусь" }, { value: "UA", label: "Украина" }, { value: "AM", label: "Армения" }, { value: "GE", label: "Грузия" }, { value: "AZ", label: "Азербайджан" },
];
/** Ownership of a role, one naming everywhere (the Profile chip uses the same three words). */
export const OWNERSHIP_LABEL: Record<string, string> = { led: "Самостоятельно", contributed: "Участие", executed: "Исполнение" };
const OWNERSHIP_OPTIONS: ChatOption[] = [
  { value: "led", label: OWNERSHIP_LABEL.led },
  { value: "contributed", label: OWNERSHIP_LABEL.contributed },
  { value: "executed", label: OWNERSHIP_LABEL.executed },
];
const ENGLISH_OPTIONS: ChatOption[] = ["A2", "B1", "B2", "C1", "C2"].map((v) => ({ value: v, label: v }));
const RELOCATION_OPTIONS: ChatOption[] = [
  { value: "yes", label: "Да, переезд возможен" },
  { value: "remote", label: "Нет, только remote" },
  { value: "local", label: "Нет, остаюсь в своём городе" },
];
const NOTICE_OPTIONS: ChatOption[] = [
  { value: "Immediately", label: "Сразу" }, { value: "2 weeks", label: "Через 2 недели" }, { value: "1 month", label: "Через месяц" }, { value: "2 months", label: "Через 2 месяца" },
];

type ChatUser = {
  profile: { citizenship: string; englishLevel: string } | null;
  goal: { countries: string } | null;
  facts: { id: string; kind: string; title: string; org: string; metrics: string; ownership: string; createdAt: Date }[];
  miniAnswers: { factId: string | null; question: string; answer: string }[];
};

/** The agent's questions, in order, with whatever the user already answered. Pure: the same list validates answers on the server. */
export function buildChatTurns(u: ChatUser): ChatTurn[] {
  const turns: ChatTurn[] = [];
  // Answers are stored under the question text; `legacy` finds answers saved under an earlier wording of the same question.
  const saved = (question: string, factId: string | null = null, legacy?: string) =>
    u.miniAnswers.find((a) => (a.question === question || (legacy != null && a.question === legacy)) && (a.factId ?? null) === factId)?.answer ?? null;
  const work = u.facts
    .filter((f) => f.kind === "employment" || f.kind === "project")
    .sort((a, b) => Number(a.kind === "project") - Number(b.kind === "project") || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, 2);

  for (const f of work) {
    const where = f.org ? `«${f.title}» в ${f.org}` : `«${f.title}»`;
    const mq = `Какой измеримый результат был у тебя в роли ${where}?`;
    const m = saved(mq, f.id);
    if (!f.metrics || m !== null) {
      turns.push({ id: `metric:${f.id}`, factId: f.id, prompt: mq, hint: "Было → стало, в цифрах. Например: «конверсия 18% → 26%» или «отчёт за 4 часа вместо 3 дней».", kind: "text", placeholder: "Например: выручка +15% за квартал", answer: m ?? (f.metrics || null) });
    }
    const oq = `Какой была твоя роль в ${where}?`;
    const o = saved(oq, f.id, `А в ${where} ты сам(а) принимал(а) решения или работал(а) по задачам команды?`);
    if (!f.ownership || o !== null) turns.push({ id: `own:${f.id}`, factId: f.id, prompt: oq, hint: "Самостоятельно — решения за тобой. Участие — важная часть команды. Исполнение — задачи ставили другие.", kind: "choice", options: OWNERSHIP_OPTIONS, answer: o ?? (f.ownership || null) });
  }

  const cq = "Какое у тебя гражданство?";
  turns.push({ id: "citizenship", prompt: cq, hint: "От этого зависит, куда я могу подаваться без визы.", kind: "choice", options: CITIZENSHIP_OPTIONS, answer: saved(cq), suggested: u.profile?.citizenship || "KZ" });

  const targets = j<string[]>(u.goal?.countries, []).filter((c) => c in INTL_AUTH);
  for (const r of targets) {
    const q = `Есть ли у тебя право работать ${INTL_AUTH[r].where}?`;
    turns.push({ id: `auth:${r}`, prompt: q, hint: "ВНЖ, рабочая виза, Blue Card, green card или гражданство.", kind: "choice", options: [{ value: "yes", label: "Да, есть" }, { value: "no", label: "Нет, нужна виза" }], answer: saved(q) });
  }

  const rq = "Рассматриваешь переезд, если компания поможет с релокацией?";
  turns.push({ id: "relocation", prompt: rq, kind: "choice", options: RELOCATION_OPTIONS, answer: saved(rq, null, "Готов(а) к переезду, если компания поможет с релокацией?") });
  const eq = "Какой у тебя уровень английского?";
  turns.push({ id: "english", prompt: eq, hint: "Честно — на интервью это всё равно проверят.", kind: "choice", options: ENGLISH_OPTIONS, answer: saved(eq), suggested: u.profile?.englishLevel });
  const nq = "Когда сможешь выйти на новую работу?";
  turns.push({ id: "notice", prompt: nq, kind: "choice", options: NOTICE_OPTIONS, answer: saved(nq) });
  return turns;
}

export async function chatTurnsFor(userId: string) {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      profile: { select: { citizenship: true, englishLevel: true } },
      goal: { select: { countries: true } },
      facts: { select: { id: true, kind: true, title: true, org: true, metrics: true, ownership: true, createdAt: true } },
      miniAnswers: { select: { factId: true, question: true, answer: true } },
    },
  });
  return buildChatTurns(u);
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
