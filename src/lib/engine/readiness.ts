import { ROLE_FAMILIES, SENIORITY_LABEL, classifyRole, englishTitle, fmtMoney, fmtMoneyRange, roleSkillEvidence, seniorityFromYears, seniorityIndex, REGIONS } from "./taxonomy";
import { marketRange } from "./market";
import { fromUSD } from "./fx";
import { interviewReadiness, type InterviewReadiness } from "./interview-readiness";
import { count, fmtYearsRu } from "../ru";

export type ReadinessInput = {
  profile: { yearsExperience: number; skills: string[]; englishLevel: string; cvText: string; summary: string; workAuth: string[]; needsSponsorship: boolean; linkedin: string; github: string; portfolio: string };
  facts: { kind: string; metrics: string; verified: boolean }[];
  stories: number;
  /** Overall scores of the user's mock interviews (for the shared interview readiness). */
  mockScores?: number[];
  goal: {
    primaryRole: string; seniority: string; minSalary: number; countries: string[]; workModes: string[]; dreamCompanies: string[]; sponsorshipNeeded: boolean;
    /** False when the user named no target countries (the free /check): the geo line says so instead of claiming a right to work. */
    countriesGiven?: boolean;
    /** Regions the salary market is read for; default = countries. The /check passes the candidate's likely market (KZ/CIS). */
    marketRegions?: string[];
    /** The goal's currency (minSalary itself is USD here): the market line is written in it (₸ per month for KZT). */
    currency?: string;
  };
};

/**
 * One Readiness line. status "neutral" = the input is missing (e.g. no target countries on /check): shown as «не указано»,
 * weight 0 (does not move the total), never a strength or a weakness.
 */
export type ReadinessCheck = { key: string; label: string; score: number; weight: number; note: string; status: "ok" | "warn" | "bad" | "neutral" };
export type Eligibility = {
  /** 0–100; capped at 65 whenever a named foreign market needs a visa. */
  score: number;
  /** The one line shown with the score — built from the same rule, so a strong score never comes with a visa warning. */
  note: string;
  /** The goal includes a named foreign market (EU, UK, US, CA, MENA) or worldwide remote. */
  international: boolean;
  /** Named foreign markets in the goal without a right to work there. */
  visaMarkets: string[];
  visaLimited: boolean;
};
export type Readiness = { family: string; market: ReturnType<typeof marketInGoalCurrency>; score: number; verdict: "ready" | "stretch" | "unrealistic"; probability: "high" | "medium" | "low" | "very_low"; checks: ReadinessCheck[]; suggestions: string[]; suggestedSeniority: string; suggestedRoles: string[]; interview: InterviewReadiness; eligibility: Eligibility };

const NAMED_FOREIGN = ["EU", "UK", "US", "CA", "MENA"];

/** The market is local: every region is Kazakhstan or the CIS (then salaries read in ₸ per month). */
export const isLocalMarket = (regions: string[]) => regions.length > 0 && regions.every((r) => r === "KZ" || r === "CIS");

/** A USD/year model figure as ₸ per month, rounded to 10 000 ₸. */
export const usdYearToKztMonth = (usd: number) => Math.round((usd * 500) / 12 / 10000) * 10000;

/**
 * The salary market line. A local (KZ/CIS) market reads in ₸ per month with USD per year second:
 * «Рынок Казахстана и СНГ ≈ 480 000–680 000 ₸ в месяц (≈ $11 000–16 000 в год)»; otherwise «Рынок ≈ $52 000–73 000 в год».
 */
export function marketNote(range: { low: number; high: number }, regions: string[], currency = "USD") {
  const cur = (currency || "USD").toUpperCase();
  // A ₸ goal (or a local market) reads in ₸ per month, USD per year second — never a bare «$22 000–$31 000» for a ₸ goal.
  if (isLocalMarket(regions) || cur === "KZT") {
    const where = isLocalMarket(regions) ? (regions.includes("CIS") ? "Рынок Казахстана и СНГ" : "Рынок Казахстана") : "Рынок";
    return `${where} ≈ ${fmtMoneyRange(usdYearToKztMonth(range.low), usdYearToKztMonth(range.high), "KZT")} в месяц (≈ ${fmtMoneyRange(range.low, range.high)} в год)`;
  }
  // Another goal currency (EUR, GBP…): per year in that currency, USD second.
  if (cur !== "USD" && fromUSD(1000, cur) !== 1000) {
    const step = (n: number) => Math.round(fromUSD(n, cur) / 1000) * 1000;
    return `Рынок ≈ ${fmtMoneyRange(step(range.low), step(range.high), cur)} в год (≈ ${fmtMoneyRange(range.low, range.high)})`;
  }
  return `Рынок ≈ ${fmtMoneyRange(range.low, range.high)} в год`;
}

/**
 * The market range in the goal's own currency, for any screen that shows numbers (Readiness, /check): ₸ per month for a
 * ₸ goal or a local market, else per year in the goal currency. `line` = marketNote.
 */
export function marketInGoalCurrency(range: { low: number; mid: number; high: number }, regions: string[], currency = "USD") {
  const cur = (currency || "USD").toUpperCase();
  const line = marketNote(range, regions, cur);
  if (isLocalMarket(regions) || cur === "KZT") return { currency: "KZT", period: "month" as const, low: usdYearToKztMonth(range.low), mid: usdYearToKztMonth(range.mid), high: usdYearToKztMonth(range.high), usdYear: range, line };
  const conv = (n: number) => (cur === "USD" ? n : Math.round(fromUSD(n, cur) / 1000) * 1000);
  return { currency: cur, period: "year" as const, low: conv(range.low), mid: conv(range.mid), high: conv(range.high), usdYear: range, line };
}
const VISA_CAP = 65;

/**
 * «Право на работу за рубежом»: score and note from one rule. KZ/CIS need no visa (EAEU / visa-free for a KZ citizen);
 * worldwide remote needs none either; a named foreign market needs the right to work there, else the score is capped
 * and the note names the markets. English weighs in for any international goal.
 */
export function internationalEligibility(i: { countries: string[]; workAuth: string[]; englishLevel: string; geoScore: number; langScore: number }): Eligibility {
  const auth = new Set(i.workAuth);
  const international = i.countries.some((c) => NAMED_FOREIGN.includes(c) || c === "WORLD");
  const visaMarkets = i.countries.filter((c) => NAMED_FOREIGN.includes(c) && !(REGIONS[c]?.countries ?? [c]).some((x) => auth.has(x)));
  const visaLimited = visaMarkets.length > 0;
  const english = `английский ${i.englishLevel}`;
  if (!international) return { score: Math.round(i.geoScore), note: `Цель — Казахстан и СНГ, виза не нужна · ${english}`, international, visaMarkets, visaLimited: false };
  const raw = Math.round(i.geoScore * 0.6 + i.langScore * 0.4);
  if (visaLimited) {
    const names = visaMarkets.map((c) => REGIONS[c]?.label ?? c).join(", ");
    return { score: Math.min(VISA_CAP, raw), note: `Нужна рабочая виза: ${names} · ${english}`, international, visaMarkets, visaLimited };
  }
  const covered = i.countries.filter((c) => NAMED_FOREIGN.includes(c)).map((c) => REGIONS[c]?.label ?? c);
  const where = [covered.length ? `есть право на работу (${covered.join(", ")})` : "", i.countries.includes("WORLD") ? "удалённые роли без привязки к стране" : ""].filter(Boolean).join(", ");
  return { score: raw, note: `Виза не нужна: ${where} · ${english}`, international, visaMarkets, visaLimited };
}

const EN = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 } as Record<string, number>;

/** The role family the user's skills are the strongest evidence for (roleSkillEvidence first, then plain coverage). */
export function bestFamilyBySkills(skills: string[]) {
  const have = new Set(skills.map((x) => x.toLowerCase()));
  const evidenced = Object.keys(ROLE_FAMILIES).filter((k) => roleSkillEvidence(k, skills).ok);
  let best = "other", bestCov = 0;
  for (const [k, f] of Object.entries(ROLE_FAMILIES)) {
    if (k === "other" || !f.skills.length || (evidenced.length && !evidenced.includes(k))) continue;
    const cov = f.skills.filter((x) => have.has(x.toLowerCase())).length / Math.min(5, f.skills.length);
    if (cov > bestCov) { best = k; bestCov = cov; }
  }
  return best;
}

/**
 * THE role family of a target, for Readiness, /check and the market range alike: the title as typed (English keywords),
 * then its English form («Аналитик данных» → Data Analyst), then — for a title no rule knows — the skills' best guess.
 * One resolver, so /check never shows two market ranges for one target.
 */
export function resolveFamily(target: string, skills: string[] = []) {
  const direct = classifyRole(target || "");
  if (direct !== "other") return direct;
  const en = englishTitle(target || "", "");
  const translated = en ? classifyRole(en) : "other";
  if (translated !== "other") return translated;
  return skills.length ? bestFamilyBySkills(skills) : "other";
}

export function assessReadiness(input: ReadinessInput): Readiness {
  const { profile, facts, goal } = input;
  const family = resolveFamily(goal.primaryRole || "", profile.skills);
  const fam = ROLE_FAMILIES[family] ?? ROLE_FAMILIES.other;
  const checks: ReadinessCheck[] = [];
  const suggestions: string[] = [];
  const push = (c: Omit<ReadinessCheck, "status">) => checks.push({ ...c, status: c.score >= 75 ? "ok" : c.score >= 45 ? "warn" : "bad" });

  // CV quality
  const cvLen = profile.cvText.length;
  const withMetrics = facts.filter((f) => (f.kind === "employment" || f.kind === "project" || f.kind === "achievement") && f.metrics).length;
  const work = facts.filter((f) => f.kind === "employment" || f.kind === "project").length;
  const cvScore = Math.min(100, (cvLen > 800 ? 40 : cvLen > 300 ? 25 : 5) + Math.min(40, withMetrics * 15) + (profile.summary ? 20 : 5));
  push({ key: "cv", label: "Качество CV", score: cvScore, weight: 1, note: withMetrics ? `${count(withMetrics, ["пункт", "пункта", "пунктов"])} с измеримым результатом` : "Нет измеримых результатов" });
  if (withMetrics < 2) suggestions.push("Пройди мини-интервью по опыту: добавь 2–3 измеримых результата (было → стало).");

  // Experience completeness
  const confirmed = facts.filter((f) => f.verified).length;
  const expScore = Math.min(100, work * 20 + confirmed * 8);
  push({ key: "experience", label: "Полнота опыта", score: expScore, weight: 1, note: work ? `${count(work, ["место работы или проект", "места работы или проекта", "мест работы или проектов"])} в профиле` : "Опыт ещё не добавлен" });

  // Hard skills
  const have = new Set(profile.skills.map((s) => s.toLowerCase()));
  const need = fam.skills;
  const covered = need.filter((s) => have.has(s.toLowerCase()));
  const skillScore = need.length ? Math.round((covered.length / Math.min(need.length, 5)) * 100) : 60;
  push({ key: "skills", label: "Навыки под роль", score: Math.min(100, skillScore), weight: 1.4, note: need.length ? `Есть: ${covered.join(", ") || "—"}` : "Роль не распознана" });
  const missing = need.filter((s) => !have.has(s.toLowerCase())).slice(0, 3);
  if (missing.length && skillScore < 75) suggestions.push(`Закрой пробел в навыках: ${missing.join(", ")} — подойдёт короткий portfolio-проект.`);

  // Seniority realism
  const actual = seniorityFromYears(profile.yearsExperience);
  const gap = seniorityIndex(goal.seniority) - seniorityIndex(actual);
  const senScore = gap <= 0 ? 100 : gap === 1 ? 55 : 10;
  push({ key: "seniority", label: "Реалистичность уровня", score: senScore, weight: 1.6, note: `Опыт ${fmtYearsRu(profile.yearsExperience)} ≈ ${SENIORITY_LABEL[actual] ?? actual}; цель — ${SENIORITY_LABEL[goal.seniority] ?? goal.seniority}` });
  if (gap >= 2) suggestions.push(`Цель «${SENIORITY_LABEL[goal.seniority] ?? goal.seniority}» при опыте ${fmtYearsRu(profile.yearsExperience)} имеет очень низкую вероятность. Реалистичнее — ${SENIORITY_LABEL[actual] ?? actual}, как промежуточный шаг.`);

  // Language
  const intl = goal.countries.some((c) => !["KZ", "CIS"].includes(c));
  const en = EN[profile.englishLevel] ?? 3;
  const langScore = !intl ? 90 : en >= 5 ? 100 : en === 4 ? 75 : en === 3 ? 40 : 10;
  push({ key: "language", label: "Английский", score: langScore, weight: intl ? 1.2 : 0.4, note: `Уровень ${profile.englishLevel}${intl ? ", международный поиск" : ""}` });
  if (intl && en < 4) suggestions.push("Для международных ролей нужен английский B2+. Сфокусируйся на СНГ-рынке или remote-ролях с B1.");

  // Salary realism
  const marketRegions = goal.marketRegions ?? goal.countries;
  const range = marketRange(family, goal.seniority, marketRegions);
  const salScore = !goal.minSalary ? 80 : goal.minSalary <= range.mid ? 100 : goal.minSalary <= range.high ? 60 : 20;
  const market = marketInGoalCurrency(range, marketRegions, goal.currency);
  push({ key: "salary", label: "Зарплатные ожидания", score: salScore, weight: 1, note: market.line });
  const inGoal = (usd: number) => (goal.currency && goal.currency.toUpperCase() !== "USD" ? fmtMoney(Math.round(fromUSD(usd, goal.currency) / 1000) * 1000, goal.currency) : fmtMoney(usd));
  if (salScore < 50) suggestions.push(`Ожидание ${inGoal(goal.minSalary)} выше рынка для ${SENIORITY_LABEL[goal.seniority] ?? goal.seniority}. Снизь минимум до ~${inGoal(range.mid)} или подними уровень.`);

  // Geography & authorization
  const authCountries = new Set(profile.workAuth);
  const targetCountries = goal.countries.flatMap((r) => REGIONS[r]?.countries ?? [r]);
  const onsiteOnly = !goal.workModes.includes("remote");
  const authorizedSomewhere = targetCountries.includes("*") || targetCountries.some((c) => authCountries.has(c));
  const geoScore = !onsiteOnly ? (authorizedSomewhere ? 100 : 70) : authorizedSomewhere ? 90 : profile.needsSponsorship ? 25 : 60;
  const countriesGiven = goal.countriesGiven !== false && goal.countries.length > 0;
  // No target countries named: nothing to judge — a neutral «не указано» line, not a 100 and not a strength.
  if (!countriesGiven) checks.push({ key: "geo", label: "География и право на работу", score: 0, weight: 0, note: "Страны не указаны", status: "neutral" });
  else push({ key: "geo", label: "География и право на работу", score: geoScore, weight: 1.2, note: authorizedSomewhere ? "Есть право работы в целевых странах" : "Нужна виза/спонсорство" });
  if (countriesGiven && geoScore < 50) suggestions.push("Onsite-роли за рубежом без права на работу почти всегда блокируются. Добавь remote или страны со спонсорством.");

  // Portfolio / links
  const links = [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).length;
  push({ key: "portfolio", label: "Портфолио и ссылки", score: Math.min(100, 30 + links * 25), weight: 0.6, note: `Ссылки: ${links} из 3` });
  if (!profile.linkedin) suggestions.push("Добавь LinkedIn — многие ATS требуют его в форме.");

  // Interview readiness — the same function as Career Score's component and the Readiness page parameter.
  const interview = interviewReadiness({ stories: input.stories, mockScores: input.mockScores ?? [] });
  push({ key: "interview", label: "Готовность к интервью", score: interview.score, weight: 0.6, note: interview.note });

  const wsum = checks.reduce((a, c) => a + c.weight, 0) || 1;
  const score = Math.round(checks.reduce((a, c) => a + c.score * c.weight, 0) / wsum);
  const hardFail = senScore <= 10 || (intl && en <= 2);
  const verdict = hardFail ? "unrealistic" : score >= 70 ? "ready" : "stretch";
  const probability = hardFail ? "very_low" : score >= 80 ? "high" : score >= 65 ? "medium" : "low";
  const suggestedRoles = suggestAdjacentRoles(family, profile.skills);
  if (goal.dreamCompanies.length && score < 70) suggestions.push("Для Target Mode по компаниям мечты сначала подними Readiness до 70+.");
  const eligibility = internationalEligibility({ countries: goal.countries, workAuth: profile.workAuth, englishLevel: profile.englishLevel, geoScore, langScore });
  return { family, market, score, verdict, probability, checks, suggestions, suggestedSeniority: gap > 0 ? actual : goal.seniority, suggestedRoles, interview, eligibility };
}

/**
 * Adjacent roles whose skills the user already has («навыки уже подходят»): coverage ≥ 40% of the role's core skills AND
 * roleSkillEvidence — two core skills including a signature one (ML for Data Scientist, ETL/Airflow/dbt/Spark for Data
 * Engineer). SQL / Excel / Python alone never suggest a role.
 */
export function suggestAdjacentRoles(family: string, skills: string[]): string[] {
  const have = new Set(skills.map((s) => s.toLowerCase()));
  return Object.entries(ROLE_FAMILIES)
    .filter(([k]) => k !== "other" && k !== family && roleSkillEvidence(k, skills).ok)
    .map(([, f]) => ({ label: f.label, cov: f.skills.filter((s) => have.has(s.toLowerCase())).length / Math.max(1, Math.min(5, f.skills.length)) }))
    .filter((r) => r.cov >= 0.4)
    .sort((a, b) => b.cov - a.cov)
    .slice(0, 3)
    .map((r) => r.label);
}
