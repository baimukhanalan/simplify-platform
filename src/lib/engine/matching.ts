import { REGIONS, ROLE_FAMILIES, SENIORITY_LABEL, fmtMoney, seniorityIndex, seniorityFromYears, classifyRole, normalizeLanguage, wordRe } from "./taxonomy";
import { fmtYearsRu, placeRu } from "../ru";

const WORK_MODE_WORD: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", onsite: "в офисе" };

const COUNTRY_RU_SHORT: Record<string, string> = { US: "США", GB: "Великобритания", AE: "ОАЭ", "*": "весь мир" };
let regionNames: Intl.DisplayNames | null = null;
/** ISO country code → Russian name («KZ» → «Казахстан», «US» → «США»); unknown codes stay as written. */
export function countryRu(code: string): string {
  const c = code.trim().toUpperCase();
  if (COUNTRY_RU_SHORT[c]) return COUNTRY_RU_SHORT[c];
  if (!/^[A-Z]{2}$/.test(c)) return placeRu(code); // legacy lines name the country in English ("Germany")
  try {
    regionNames ??= new Intl.DisplayNames(["ru"], { type: "region" });
    const name = regionNames.of(c);
    return name && name !== c ? name : code;
  } catch {
    return code;
  }
}
const countriesRu = (codes: string[]) => codes.map(countryRu).join(", ");

/**
 * Blocker / gap lines written by older engine versions in English, as stored on existing opportunities → the current
 * Russian wording. New rows are written in Russian already; this only keeps old rows readable.
 */
export function blockerRu(line: string): string {
  return line
    // Stored lines carry ISO codes («Страна вне цели: DE, NL»): names, not codes, in the UI.
    .replace(/^(Страна вне цели|Нужно право на работу): ((?:[A-Z]{2}|\*)(?:, (?:[A-Z]{2}|\*))*)(?=$| —)/, (_, head: string, list: string) => `${head}: ${countriesRu(list.split(", "))}`)
    .replace(/^Onsite\/hybrid, спонсорство визы недоступно$/, "Офис или гибрид, спонсорство визы недоступно")
    .replace(/^Требуется переезд, relocation выключен$/, "Требуется переезд, а переезд у тебя выключен")
    .replace(/^(.+) authorization required$/, (_, list: string) => `Нужно право на работу: ${countriesRu(list.split(/,\s*/))} — спонсорство не указано`)
    .replace(/^Только onsite — /, "Только в офисе — ")
    .replace(/^Формат (remote|hybrid|onsite) вне предпочтений$/, (_, m: string) => `Формат «${WORK_MODE_WORD[m]}» вне предпочтений`);
}

const ADVANCED_DEGREE = wordRe("master|phd|магистр", { end: false });

export type CandidateCtx = {
  skills: string[];
  yearsExperience: number;
  englishLevel: string;
  languages: string[];
  workAuth: string[];
  needsSponsorship: boolean;
  relocation: boolean;
  educationLevel: "none" | "bachelor" | "master" | "phd";
  goal: { primaryRole: string; extraRoles: string[]; seniority: string; minSalary: number; countries: string[]; workModes: string[]; industries: string[]; dreamCompanies: string[]; blockedCompanies: string[]; mode: string };
  allocation: Record<string, number>; // learned segment weights (feedback loop)
  permissions?: { outsideCountries: boolean; belowSalaryFloor: boolean }; // Agent screen
  /** The campaign's plan: its regions are a hard scope (Local / CIS never applies abroad). Omitted = no plan limit. */
  plan?: { key: string; label: string; regions: readonly string[] };
  /**
   * The agent makes the dream-company level call itself (simulation mode): Match ≥ STRONG_MATCH → it applies (the level
   * lines become soft gaps), below → the role stays blocked and is skipped. Nothing is left as the user's decision.
   */
  agentDecides?: boolean;
};

/** Per-role options: `userPicked` = the user pressed Apply/Auto on this role (a level below the goal is then allowed). */
export type ScoreOptions = { userPicked?: boolean };

export type JobCtx = {
  title: string; company: string; roleFamily: string; seniority: string; countries: string[]; remote: string;
  salaryMin: number | null; salaryMax: number | null; technologies: string[]; requirements: string[]; minYears: number;
  education: string; workAuth: string[]; sponsorship: string; languages: string[]; industry: string; massHiring: boolean; postedAt: Date;
};

export type MatchResult = {
  match: number; reasons: { label: string; ok: boolean }[];
  eligibility: "eligible" | "soft" | "blocked"; blockers: string[]; softGaps: string[];
  pInterview: number; priority: number; lane: "standard" | "target" | "mass"; segment: string; freshnessDays: number;
  /** The role is one the goal asks for (primary or extra role; a mass-hiring role in Mass mode). Off-goal roles are never queued by the agent. */
  onGoal: boolean;
  /** A dream-company role held back only by level: shown as the user's decision (DREAM_DECISION), never queued by the agent. */
  userDecision: boolean;
};

/**
 * Years a Senior/Lead title implies when the posting names none: a "Senior Data Analyst" without "5+ years" is still
 * not a role for someone with 2. Middle/junior titles imply nothing (ingest defaults unknown roles to "middle").
 */
export const IMPLIED_MIN_YEARS: Record<string, number> = { senior: 4, lead: 6 };

/** Years the role really asks for: the stated minimum, or what the Senior/Lead title implies, whichever is higher. */
export const requiredYears = (job: Pick<JobCtx, "minYears" | "seniority">) => Math.max(job.minYears || 0, IMPLIED_MIN_YEARS[job.seniority] ?? 0);

/** A gap this large (in years or in seniority levels) is a hard blocker; a one-step stretch stays a soft gap. */
export const HARD_GAP = 2;

/** Match from which a found role counts as «подошла» (fits). The one threshold for Today, Opportunities and engine event texts. */
export const STRONG_MATCH = 70;

const EN: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function targetCountries(regions: string[]) {
  return new Set(regions.flatMap((r) => REGIONS[r]?.countries ?? [r]));
}

/** Plan scope → countries, or null when the plan covers the whole world (International). */
export function planCountries(plan: CandidateCtx["plan"]): Set<string> | null {
  if (!plan || plan.regions.includes("WORLD")) return null;
  return targetCountries([...plan.regions]);
}

/**
 * Is the job inside a Local / CIS plan? A job in KZ/CIS countries is; a worldwide remote role is, unless it asks for work
 * authorization elsewhere ("must be authorized to work in the US" makes it an International role); anything located
 * outside KZ/CIS, or with no location at all for an office role, is not.
 */
export function jobInPlan(job: Pick<JobCtx, "countries" | "remote" | "workAuth">, scope: Set<string> | null) {
  if (!scope) return true;
  if (job.workAuth.some((x) => !scope.has(x))) return false;
  if (job.countries.some((x) => scope.has(x))) return true;
  const worldwide = job.countries.includes("*") || (!job.countries.length && job.remote === "remote");
  return worldwide;
}

/** Internships, trainee and graduate programmes: below a Middle+ goal. */
const BELOW_GOAL_TITLE = wordRe("intern|internship|trainee|graduate program(?:me)?|graduate scheme|стаж\\p{L}*");
export const isEntryProgram = (job: Pick<JobCtx, "title" | "seniority">) => job.seniority === "intern" || BELOW_GOAL_TITLE.test(job.title);

export function scoreJob(c: CandidateCtx, job: JobCtx, now = new Date(), opts: ScoreOptions = {}): MatchResult {
  const reasons: MatchResult["reasons"] = [];
  const blockers: string[] = [];
  const softGaps: string[] = [];
  const have = new Set(c.skills.map((s) => s.toLowerCase()));

  // ——— Match: professional fit ———
  const wanted = [c.goal.primaryRole, ...c.goal.extraRoles].map(classifyRole);
  const roleFit = wanted[0] === job.roleFamily ? 1 : wanted.includes(job.roleFamily) ? 0.85 : 0.35;
  reasons.push({ label: ROLE_FAMILIES[job.roleFamily]?.label ?? job.title, ok: roleFit >= 0.85 });

  const tech = job.technologies.length ? job.technologies : ROLE_FAMILIES[job.roleFamily]?.skills.slice(0, 4) ?? [];
  const hit = tech.filter((t) => have.has(t.toLowerCase()));
  for (const t of tech.slice(0, 6)) reasons.push({ label: t, ok: have.has(t.toLowerCase()) });
  const skillFit = tech.length ? hit.length / tech.length : 0.6;
  for (const t of tech.filter((t) => !have.has(t.toLowerCase())).slice(0, 3)) softGaps.push(`Нет ${t} в профиле`);

  const needYears = requiredYears(job);
  const yearsGap = needYears - c.yearsExperience;
  const yearsFit = yearsGap <= 0 ? 1 : yearsGap <= 1 ? 0.7 : 0.3;
  if (needYears) reasons.push({ label: `${needYears}+ years`, ok: yearsFit === 1 });
  if (yearsFit < 1 && yearsGap < HARD_GAP) softGaps.push(`Требуется ${fmtYearsRu(needYears, "+")}, у тебя ${fmtYearsRu(c.yearsExperience)}`);

  const senGap = seniorityIndex(job.seniority) - seniorityIndex(seniorityFromYears(c.yearsExperience));
  const senFit = senGap <= 0 ? (senGap < -1 ? 0.7 : 1) : senGap === 1 ? 0.6 : 0.15;

  let salaryFit = 1;
  if (c.goal.minSalary && job.salaryMax) {
    salaryFit = job.salaryMax >= c.goal.minSalary ? 1 : job.salaryMax >= c.goal.minSalary * 0.85 ? 0.6 : 0.2;
    reasons.push({ label: `Зарплата от ${fmtMoney(c.goal.minSalary)}`, ok: salaryFit === 1 });
    if (salaryFit < 1) softGaps.push("Вилка ниже твоего минимума");
  }
  const industryFit = !c.goal.industries.length || !job.industry ? 0.8 : c.goal.industries.some((i) => job.industry.toLowerCase().includes(i.toLowerCase())) ? 1 : 0.6;

  const match = Math.round(100 * (0.32 * roleFit + 0.33 * skillFit + 0.13 * yearsFit + 0.1 * senFit + 0.07 * salaryFit + 0.05 * industryFit));

  // ——— Eligibility: hard blockers ———
  // The plan first: a Local / CIS campaign never applies outside KZ/CIS, whatever the goal or the Agent screen say.
  if (c.plan && !jobInPlan(job, planCountries(c.plan))) blockers.push(`Вне тарифа ${c.plan.label}`);
  const targets = targetCountries(c.goal.countries);
  const auth = new Set(c.workAuth);
  const anywhere = targets.has("*");
  const jobInTarget = job.countries.length === 0 || anywhere || job.countries.some((x) => targets.has(x) || x === "*");
  if (!jobInTarget) (c.permissions?.outsideCountries ? softGaps : blockers).push(`Страна вне цели: ${countriesRu(job.countries)}`);
  if (salaryFit < 1 && c.permissions && !c.permissions.belowSalaryFloor && job.salaryMax && job.salaryMax < c.goal.minSalary) blockers.push("Зарплата ниже твоего минимума");

  const needsPresence = job.remote !== "remote";
  const authorizedForJob = job.countries.some((x) => auth.has(x)) || job.countries.includes("*");
  if (needsPresence && !authorizedForJob) {
    if (job.sponsorship === "no") blockers.push("Офис или гибрид, спонсорство визы недоступно");
    else if (!c.relocation) blockers.push("Требуется переезд, а переезд у тебя выключен");
    else softGaps.push("Нужна виза — спонсорство не указано");
  }
  if (job.workAuth.length && !job.workAuth.some((x) => auth.has(x))) {
    if (job.sponsorship === "no" || !c.needsSponsorship) blockers.push(`Нужно право на работу: ${countriesRu(job.workAuth)}`);
    else if (job.sponsorship === "yes") softGaps.push("Потребуется спонсорство (компания спонсирует)");
    else blockers.push(`Нужно право на работу: ${countriesRu(job.workAuth)} — спонсорство не указано`);
  }
  if (!c.goal.workModes.includes(job.remote) && !c.goal.workModes.includes("any")) {
    if (job.remote === "onsite") blockers.push("Только в офисе — не входит в твои форматы");
    else softGaps.push(`Формат «${WORK_MODE_WORD[job.remote] ?? job.remote}» вне предпочтений`);
  }
  const en = EN[c.englishLevel] ?? 3;
  const jobLangs = job.languages.map(normalizeLanguage);
  if (jobLangs.includes("English") && en < 3) blockers.push("Требуется английский B1+");
  const spoken = new Set(c.languages.map(normalizeLanguage)); // "Русский" ≡ "Russian"
  for (const l of jobLangs.filter((l) => l !== "English")) if (!spoken.has(l)) blockers.push(`Требуется язык: ${l}`);
  if (ADVANCED_DEGREE.test(job.education) && (c.educationLevel === "none" || c.educationLevel === "bachelor")) blockers.push(`Обязательное образование: ${job.education}`);
  // Roles clearly above the candidate are never applied to: two+ years short of the requirement or two+ levels up.
  if (yearsGap >= HARD_GAP) blockers.push(`Нужно ${fmtYearsRu(needYears, "+")} опыта, у тебя ${fmtYearsRu(c.yearsExperience)} — роль на уровень выше`);
  else if (senGap >= HARD_GAP) blockers.push(`Уровень ${SENIORITY_LABEL[job.seniority] ?? job.seniority} недостижим с текущим опытом`);
  if (c.goal.blockedCompanies.some((b) => b && job.company.toLowerCase().includes(b.toLowerCase()))) blockers.push("Компания в твоём стоп-листе");
  // The goal's level drives which roles fit: an internship or a graduate programme is below a Middle+ goal. The user's own
  // Apply/Auto on the role overrides it (then it is only a note).
  if (seniorityIndex(c.goal.seniority) >= seniorityIndex("middle") && isEntryProgram(job)) (opts.userPicked ? softGaps : blockers).push(BELOW_GOAL);

  // A dream company blocked only by level (below the goal, or one level/years step too far) is the user's call, not a silent
  // skip: the lines become soft gaps and the role waits for the user's Apply / Skip (DREAM_DECISION marks it).
  const dream = c.goal.dreamCompanies.some((d) => d && job.company.toLowerCase().includes(d.toLowerCase()));
  let userDecision = false;
  if (dream && blockers.length && blockers.every(isLevelBlocker)) {
    if (opts.userPicked || !c.agentDecides) {
      softGaps.unshift(...blockers.splice(0));
      if (!opts.userPicked) { softGaps.unshift(DREAM_DECISION); userDecision = true; }
    } else if (match >= STRONG_MATCH) softGaps.unshift(...blockers.splice(0));
  }

  const eligibility = blockers.length ? "blocked" : softGaps.length > 2 ? "soft" : "eligible";

  // ——— Ranking: P(Interview | candidate, job, company, timing) ———
  const freshnessDays = Math.max(0, (now.getTime() - job.postedAt.getTime()) / 86400000);
  const fresh = freshnessDays < 1 ? 1.25 : freshnessDays < 3 ? 1.12 : freshnessDays < 7 ? 1 : freshnessDays < 14 ? 0.82 : freshnessDays < 30 ? 0.6 : 0.35;
  const competition = job.remote === "remote" && !job.massHiring ? 0.8 : 1; // global remote roles attract more applicants
  const massBoost = job.massHiring ? 1.35 : 1;
  const segmentWeight = c.allocation[job.roleFamily] ?? 1;
  const base = Math.pow(match / 100, 2.2) * 0.32; // baseline response for a perfect match ≈ 32%
  const pInterview = eligibility === "blocked" ? 0 : Math.min(0.6, base * fresh * competition * massBoost * segmentWeight * (eligibility === "soft" ? 0.7 : 1));
  const lane: MatchResult["lane"] = dream ? "target" : job.massHiring ? "mass" : "standard";
  const modeBias = c.goal.mode === "target" ? (dream ? 3 : 0.2) : c.goal.mode === "mass" ? (job.massHiring ? 1.6 : 0.8) : dream ? 1.3 : 1;
  const priority = Math.round(pInterview * modeBias * 1000) / 1000;

  const onGoal = wanted.includes(job.roleFamily) || (c.goal.mode === "mass" && job.massHiring);

  return { match, reasons, eligibility, blockers, softGaps, pInterview: Math.round(pInterview * 1000) / 1000, priority, lane, segment: job.roleFamily, freshnessDays: Math.round(freshnessDays * 10) / 10, onGoal, userDecision };
}

export const BELOW_GOAL = "Уровень ниже цели";

/** Soft-gap marker: a dream-company role held back only by level — the agent never takes it on its own; the user decides. */
export const DREAM_DECISION = "Компания мечты — реши сам";

/** Level lines: below the goal (internship / graduate programme), or years / seniority above the candidate. */
export function isLevelBlocker(line: string) {
  const t = blockerRu(line);
  return t === BELOW_GOAL || /^Нужно .+ опыта, у тебя .+ — роль на уровень выше$/.test(t) || /^Уровень .+ недостижим с текущим опытом$/.test(t);
}

/**
 * Blockers the user may override with Apply / Auto: only «Уровень ниже цели» (any company) or, at a dream company, any
 * level line. Everything else (visa, language, the plan, the user's own filters…) stays a hard stop. Empty = not blocked.
 */
export function isOverridable(blockers: string[] | string, opts: { dream?: boolean } = {}) {
  const list = Array.isArray(blockers) ? blockers : (() => { try { const v = JSON.parse(blockers || "[]"); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } })();
  return list.length > 0 && list.every((b) => blockerRu(b) === BELOW_GOAL || (opts.dream === true && isLevelBlocker(b)));
}

/**
 * Who fails whom. "filter" = the job fails the user's own choices (salary floor, work format, relocation, regions, the
 * plan, the stop-list, the goal's roles and level) — nothing is wrong with the user. "requirement" = the user doesn't meet
 * what the employer asks (work authorization/visa, language, degree, years, level). Works on stored Russian lines and on
 * legacy English ones (via blockerRu).
 */
export function blockerKind(text: string): "filter" | "requirement" {
  const t = blockerRu(text);
  return FILTER_BLOCKERS.some((re) => re.test(t)) ? "filter" : "requirement";
}
const FILTER_BLOCKERS: RegExp[] = [
  /^Вне тарифа/, /^Страна вне цели/, /^Зарплата ниже твоего минимума/, /не входит в твои форматы/, /^Формат «.+» вне предпочтений/,
  /переезд у тебя выключен/, /стоп-лист/, /^Уровень ниже цели/, /^Роль вне цели/,
];

/**
 * How a scored role must be presented. A hard-blocked role can still have Match 100 (skills fit, but e.g. onsite abroad
 * without a visa): the verdict and its first blocker go FIRST, "Why this fits" is not shown, and the match number is
 * secondary (kept as is — it is the skills fit, not a chance). `blockers` may be the stored JSON string.
 *
 * Two verdicts: «Не проходишь» — an employer requirement the user doesn't meet; «Не подходит тебе» — only the user's own
 * filters rule the role out (salary floor, format, regions/plan, stop-list, level below the goal). For a filter-only block
 * the interview chance is null: 0% there would read as a judgement of the user, and it isn't one.
 */
export function fitVerdict(o: { eligibility: string; match: number; blockers: string[] | string; pInterview?: number }) {
  const raw = Array.isArray(o.blockers) ? o.blockers : (() => { try { const v = JSON.parse(o.blockers || "[]"); return Array.isArray(v) ? (v as string[]) : []; } catch { return []; } })();
  const blockers = raw.map(blockerRu);
  const blocked = o.eligibility === "blocked";
  const kinds = blockers.map((b) => ({ text: b, kind: blockerKind(b) }));
  const requirements = kinds.filter((k) => k.kind === "requirement").map((k) => k.text);
  const filters = kinds.filter((k) => k.kind === "filter").map((k) => k.text);
  const kind: "filter" | "requirement" | null = !blocked ? null : requirements.length || !filters.length ? "requirement" : "filter";
  return {
    blocked,
    /** Why it is blocked: "requirement" (user fails the job) or "filter" (the job fails the user's own choices). */
    kind,
    /** Show before anything else when blocked. */
    headline: !blocked ? null : kind === "filter" ? "Не подходит тебе" : "Не проходишь",
    /** The first failing requirement (or, for a filter-only block, the first filter). */
    reason: !blocked ? null : (kind === "filter" ? filters[0] : requirements[0]) ?? (kind === "filter" ? "Не подходит под твои настройки поиска" : "Не проходишь по формальным требованиям"),
    blockers: blocked ? blockers : [],
    /** The same lines split by kind, requirements first. */
    requirements: blocked ? requirements : [],
    filters: blocked ? filters : [],
    /** «Почему подходит» only for roles the user can actually get. */
    showWhyFits: !blocked,
    /** Match stays the stored value; for a blocked role it reads as skills fit, not a recommendation. */
    match: o.match,
    matchLabel: !blocked ? `Match ${o.match}%` : kind === "filter" ? `Совпадение навыков ${o.match}% · вне твоих настроек` : `Совпадение навыков ${o.match}% · не проходишь`,
    /** Interview probability to show: null for a filter-only block (no judgement), else the stored value. */
    pInterview: blocked && kind === "filter" ? null : o.pInterview ?? null,
  };
}

/** Interview probability for display: null when only the user's own filters block the role (see fitVerdict). */
export function interviewProbability(o: { eligibility: string; blockers: string[] | string; pInterview: number }) {
  return fitVerdict({ ...o, match: 0 }).pInterview;
}
