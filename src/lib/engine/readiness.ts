import { ROLE_FAMILIES, SENIORITY_LABEL, classifyRole, seniorityFromYears, seniorityIndex, REGIONS } from "./taxonomy";
import { marketRange } from "./market";
import { interviewReadiness, type InterviewReadiness } from "./interview-readiness";
import { count, fmtYearsRu } from "../ru";

export type ReadinessInput = {
  profile: { yearsExperience: number; skills: string[]; englishLevel: string; cvText: string; summary: string; workAuth: string[]; needsSponsorship: boolean; linkedin: string; github: string; portfolio: string };
  facts: { kind: string; metrics: string; verified: boolean }[];
  stories: number;
  /** Overall scores of the user's mock interviews (for the shared interview readiness). */
  mockScores?: number[];
  goal: { primaryRole: string; seniority: string; minSalary: number; countries: string[]; workModes: string[]; dreamCompanies: string[]; sponsorshipNeeded: boolean };
};

export type ReadinessCheck = { key: string; label: string; score: number; weight: number; note: string; status: "ok" | "warn" | "bad" };
export type Readiness = { score: number; verdict: "ready" | "stretch" | "unrealistic"; probability: "high" | "medium" | "low" | "very_low"; checks: ReadinessCheck[]; suggestions: string[]; suggestedSeniority: string; suggestedRoles: string[]; interview: InterviewReadiness };

const EN = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 } as Record<string, number>;

export function assessReadiness(input: ReadinessInput): Readiness {
  const { profile, facts, goal } = input;
  const family = classifyRole(goal.primaryRole || "");
  const fam = ROLE_FAMILIES[family] ?? ROLE_FAMILIES.other;
  const checks: ReadinessCheck[] = [];
  const suggestions: string[] = [];
  const push = (c: Omit<ReadinessCheck, "status">) => checks.push({ ...c, status: c.score >= 75 ? "ok" : c.score >= 45 ? "warn" : "bad" });

  // CV quality
  const cvLen = profile.cvText.length;
  const withMetrics = facts.filter((f) => (f.kind === "employment" || f.kind === "project") && f.metrics).length;
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
  const range = marketRange(family, goal.seniority, goal.countries);
  const salScore = !goal.minSalary ? 80 : goal.minSalary <= range.mid ? 100 : goal.minSalary <= range.high ? 60 : 20;
  push({ key: "salary", label: "Зарплатные ожидания", score: salScore, weight: 1, note: `Рынок ≈ $${Math.round(range.low / 1000)}k–$${Math.round(range.high / 1000)}k` });
  if (salScore < 50) suggestions.push(`Ожидание $${Math.round(goal.minSalary / 1000)}k выше рынка для ${SENIORITY_LABEL[goal.seniority] ?? goal.seniority}. Снизь минимум до ~$${Math.round(range.mid / 1000)}k или подними уровень.`);

  // Geography & authorization
  const authCountries = new Set(profile.workAuth);
  const targetCountries = goal.countries.flatMap((r) => REGIONS[r]?.countries ?? [r]);
  const onsiteOnly = !goal.workModes.includes("remote");
  const authorizedSomewhere = targetCountries.includes("*") || targetCountries.some((c) => authCountries.has(c));
  const geoScore = !onsiteOnly ? (authorizedSomewhere ? 100 : 70) : authorizedSomewhere ? 90 : profile.needsSponsorship ? 25 : 60;
  push({ key: "geo", label: "География и право на работу", score: geoScore, weight: 1.2, note: authorizedSomewhere ? "Есть право работы в целевых странах" : "Нужна виза/спонсорство" });
  if (geoScore < 50) suggestions.push("Onsite-роли за рубежом без права на работу почти всегда блокируются. Добавь remote или страны со спонсорством.");

  // Portfolio / links
  const links = [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).length;
  push({ key: "portfolio", label: "Портфолио и ссылки", score: Math.min(100, 30 + links * 25), weight: 0.6, note: `Ссылки: ${links} из 3` });
  if (!profile.linkedin) suggestions.push("Добавь LinkedIn — многие ATS требуют его в форме.");

  // Interview readiness — the same function as Career Score's component and the Readiness page parameter.
  const interview = interviewReadiness({ stories: input.stories, mockScores: input.mockScores ?? [] });
  push({ key: "interview", label: "Готовность к интервью", score: interview.score, weight: 0.6, note: interview.note });

  const wsum = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(checks.reduce((a, c) => a + c.score * c.weight, 0) / wsum);
  const hardFail = senScore <= 10 || (intl && en <= 2);
  const verdict = hardFail ? "unrealistic" : score >= 70 ? "ready" : "stretch";
  const probability = hardFail ? "very_low" : score >= 80 ? "high" : score >= 65 ? "medium" : "low";
  const suggestedRoles = suggestAdjacentRoles(family, profile.skills);
  if (goal.dreamCompanies.length && score < 70) suggestions.push("Для Target Mode по компаниям мечты сначала подними Readiness до 70+.");
  return { score, verdict, probability, checks, suggestions, suggestedSeniority: gap > 0 ? actual : goal.seniority, suggestedRoles, interview };
}

export function suggestAdjacentRoles(family: string, skills: string[]): string[] {
  const have = new Set(skills.map((s) => s.toLowerCase()));
  return Object.entries(ROLE_FAMILIES)
    .filter(([k]) => k !== "other" && k !== family)
    .map(([, f]) => ({ label: f.label, cov: f.skills.filter((s) => have.has(s.toLowerCase())).length / Math.max(1, Math.min(5, f.skills.length)) }))
    .filter((r) => r.cov >= 0.4)
    .sort((a, b) => b.cov - a.cov)
    .slice(0, 3)
    .map((r) => r.label);
}
