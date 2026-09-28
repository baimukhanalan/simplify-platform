import { ROLE_FAMILIES, classifyRole, seniorityFromYears, seniorityIndex, REGIONS } from "./taxonomy";
import { marketRange } from "./market";

export type ReadinessInput = {
  profile: { yearsExperience: number; skills: string[]; englishLevel: string; cvText: string; summary: string; workAuth: string[]; needsSponsorship: boolean; linkedin: string; github: string; portfolio: string };
  facts: { kind: string; metrics: string; verified: boolean }[];
  stories: number;
  goal: { primaryRole: string; seniority: string; minSalary: number; countries: string[]; workModes: string[]; dreamCompanies: string[]; sponsorshipNeeded: boolean };
};

export type ReadinessCheck = { key: string; label: string; score: number; weight: number; note: string; status: "ok" | "warn" | "bad" };
export type Readiness = { score: number; verdict: "ready" | "stretch" | "unrealistic"; probability: "high" | "medium" | "low" | "very_low"; checks: ReadinessCheck[]; suggestions: string[]; suggestedSeniority: string; suggestedRoles: string[] };

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
  push({ key: "cv", label: "Качество CV", score: cvScore, weight: 1, note: withMetrics ? `${withMetrics} пунктов с измеримым результатом` : "Нет измеримых результатов" });
  if (withMetrics < 2) suggestions.push("Пройдите мини-интервью по опыту: добавьте 2–3 измеримых результата (было → стало).");

  // Experience completeness
  const verified = facts.filter((f) => f.verified).length;
  const expScore = Math.min(100, work * 20 + verified * 8);
  push({ key: "experience", label: "Полнота опыта", score: expScore, weight: 1, note: `${work} позиций/проектов, ${verified} подтверждено` });

  // Hard skills
  const have = new Set(profile.skills.map((s) => s.toLowerCase()));
  const need = fam.skills;
  const covered = need.filter((s) => have.has(s.toLowerCase()));
  const skillScore = need.length ? Math.round((covered.length / Math.min(need.length, 5)) * 100) : 60;
  push({ key: "skills", label: "Hard skills под роль", score: Math.min(100, skillScore), weight: 1.4, note: need.length ? `Есть: ${covered.join(", ") || "—"}` : "Роль не распознана" });
  const missing = need.filter((s) => !have.has(s.toLowerCase())).slice(0, 3);
  if (missing.length && skillScore < 75) suggestions.push(`Закройте пробел в навыках: ${missing.join(", ")} — подойдёт короткий portfolio-проект.`);

  // Seniority realism
  const actual = seniorityFromYears(profile.yearsExperience);
  const gap = seniorityIndex(goal.seniority) - seniorityIndex(actual);
  const senScore = gap <= 0 ? 100 : gap === 1 ? 55 : 10;
  push({ key: "seniority", label: "Реалистичность уровня", score: senScore, weight: 1.6, note: `Опыт ${profile.yearsExperience} г. ≈ ${actual}; цель — ${goal.seniority}` });
  if (gap >= 2) suggestions.push(`Цель «${goal.seniority}» при ${profile.yearsExperience} г. опыта имеет очень низкую вероятность. Реалистичнее — ${actual}, как промежуточный шаг.`);

  // Language
  const intl = goal.countries.some((c) => !["KZ", "CIS"].includes(c));
  const en = EN[profile.englishLevel] ?? 3;
  const langScore = !intl ? 90 : en >= 5 ? 100 : en === 4 ? 75 : en === 3 ? 40 : 10;
  push({ key: "language", label: "Английский", score: langScore, weight: intl ? 1.2 : 0.4, note: `Уровень ${profile.englishLevel}${intl ? ", международный поиск" : ""}` });
  if (intl && en < 4) suggestions.push("Для международных ролей нужен английский B2+. Сфокусируйтесь на СНГ-рынке или remote-ролях с B1.");

  // Salary realism
  const range = marketRange(family, goal.seniority, goal.countries);
  const salScore = !goal.minSalary ? 80 : goal.minSalary <= range.mid ? 100 : goal.minSalary <= range.high ? 60 : 20;
  push({ key: "salary", label: "Зарплатные ожидания", score: salScore, weight: 1, note: `Рынок ≈ $${Math.round(range.low / 1000)}k–$${Math.round(range.high / 1000)}k` });
  if (salScore < 50) suggestions.push(`Ожидание $${Math.round(goal.minSalary / 1000)}k выше рынка для ${goal.seniority}. Снизьте минимум до ~$${Math.round(range.mid / 1000)}k или поднимите уровень.`);

  // Geography & authorization
  const authCountries = new Set(profile.workAuth);
  const targetCountries = goal.countries.flatMap((r) => REGIONS[r]?.countries ?? [r]);
  const onsiteOnly = !goal.workModes.includes("remote");
  const authorizedSomewhere = targetCountries.includes("*") || targetCountries.some((c) => authCountries.has(c));
  const geoScore = !onsiteOnly ? (authorizedSomewhere ? 100 : 70) : authorizedSomewhere ? 90 : profile.needsSponsorship ? 25 : 60;
  push({ key: "geo", label: "География и право на работу", score: geoScore, weight: 1.2, note: authorizedSomewhere ? "Есть право работы в целевых странах" : "Нужна виза/спонсорство" });
  if (geoScore < 50) suggestions.push("Onsite-роли за рубежом без права на работу почти всегда блокируются. Добавьте remote или страны со спонсорством.");

  // Portfolio / links
  const links = [profile.linkedin, profile.github, profile.portfolio].filter(Boolean).length;
  push({ key: "portfolio", label: "Портфолио и ссылки", score: Math.min(100, 30 + links * 25), weight: 0.6, note: `${links}/3 ссылок` });
  if (!profile.linkedin) suggestions.push("Добавьте LinkedIn — многие ATS требуют его в форме.");

  // Interview material
  push({ key: "stories", label: "STAR-истории для интервью", score: Math.min(100, input.stories * 25), weight: 0.6, note: `${input.stories} подтверждённых историй` });

  const wsum = checks.reduce((a, c) => a + c.weight, 0);
  const score = Math.round(checks.reduce((a, c) => a + c.score * c.weight, 0) / wsum);
  const hardFail = senScore <= 10 || (intl && en <= 2);
  const verdict = hardFail ? "unrealistic" : score >= 70 ? "ready" : "stretch";
  const probability = hardFail ? "very_low" : score >= 80 ? "high" : score >= 65 ? "medium" : "low";
  const suggestedRoles = suggestAdjacentRoles(family, profile.skills);
  if (goal.dreamCompanies.length && score < 70) suggestions.push("Для Target Mode по компаниям мечты сначала поднимите readiness до 70+.");
  return { score, verdict, probability, checks, suggestions, suggestedSeniority: gap > 0 ? actual : goal.seniority, suggestedRoles };
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
