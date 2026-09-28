// Pure: turns the engine's readiness checks into the six parameters, blockers and the agent's plan.
import type { Readiness, ReadinessCheck } from "@/lib/engine/readiness";
import { REGIONS, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { REGION_RU } from "../../../_components/ru";

export type ReadinessData = {
  readiness: Readiness;
  range: { low: number; mid: number; high: number };
  family: string;
  goal: { primaryRole: string; seniority: string; minSalary: number; currency: string; countries: string[]; workModes: string[]; dreamCompanies: string[]; sponsorshipNeeded: boolean; extraRoles: string[] };
  actualSeniority: string;
  yearsExperience: number;
  englishLevel: string;
  hasLinkedin: boolean;
  needsSponsorship: boolean;
  withMetrics: number;
  stories: number;
  mocks: number;
  jobsForRole: number;
  missingSkills: string[];
};

export type Level = "strong" | "mid" | "weak";
export type Param = { key: string; label: string; score: number; level: Level; note: string };

export const LEVEL_LABEL: Record<Level, string> = { strong: "Сильно", mid: "Средне", weak: "Слабо" };
const level = (n: number): Level => (n >= 75 ? "strong" : n >= 50 ? "mid" : "weak");
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
export const kUsd = (n: number) => `$${Math.round(n / 1000)}k`;
const LOCAL = new Set(["KZ", "CIS"]);

export function isInternational(countries: string[]) {
  return countries.some((c) => !LOCAL.has(c));
}

/** "International Data Analyst" — the goal as one line. */
export function goalTitle(role: string, countries: string[]) {
  return isInternational(countries) && !/international/i.test(role) ? `International ${role}` : role;
}

export function readinessView(d: ReadinessData) {
  const r = d.readiness;
  const c = (key: string): ReadinessCheck => r.checks.find((x) => x.key === key) ?? { key, label: key, score: 60, weight: 1, note: "", status: "warn" };
  const intl = isInternational(d.goal.countries);

  const skills = c("skills").score;
  const experience = clamp((c("experience").score + c("seniority").score) / 2);
  const cv = clamp(c("cv").score * 0.75 + c("portfolio").score * 0.25);
  // Same score as Career Score's interview component (src/lib/engine/interview-readiness.ts).
  const interview = r.interview.score;
  const demandRaw = d.jobsForRole >= 40 ? 90 : d.jobsForRole >= 15 ? 75 : d.jobsForRole >= 5 ? 55 : d.jobsForRole > 0 ? 40 : 25;
  const demand = clamp(demandRaw * 0.6 + c("salary").score * 0.4);
  const visaMarkets = d.goal.countries.filter((x) => !LOCAL.has(x) && x !== "WORLD");
  const visaLimited = d.needsSponsorship && visaMarkets.length > 0;
  // Needing a visa for named markets caps eligibility even when remote roles keep the engine's geo check green.
  const eligibility = Math.min(visaLimited ? 65 : 100, clamp(c("geo").score * 0.6 + c("language").score * 0.4));

  const params: Param[] = [
    { key: "skills", label: "Skills", score: skills, level: level(skills), note: d.missingSkills.length && skills < 75 ? `Не хватает: ${d.missingSkills.join(", ")}` : "Навыки закрывают требования роли" },
    { key: "experience", label: "Experience", score: experience, level: level(experience), note: `${fmtYears(d.yearsExperience)} опыта · цель ${SENIORITY_LABEL[d.goal.seniority] ?? d.goal.seniority}` },
    { key: "cv", label: "CV quality", score: cv, level: level(cv), note: d.withMetrics ? `${d.withMetrics} ${plural(d.withMetrics, "достижение", "достижения", "достижений")} с цифрами` : "Нет достижений в цифрах" },
    { key: "interview", label: "Interview readiness", score: interview, level: level(interview), note: r.interview.note },
    { key: "demand", label: "Market demand", score: demand, level: level(demand), note: `${d.jobsForRole} ${plural(d.jobsForRole, "открытая вакансия", "открытые вакансии", "открытых вакансий")} по роли · рынок ${kUsd(d.range.low)}–${kUsd(d.range.high)}` },
    { key: "eligibility", label: "International eligibility", score: eligibility, level: level(eligibility), note: intl ? `${d.needsSponsorship ? "Для части рынков нужна рабочая виза" : "Есть право на работу в целевых странах"} · English ${d.englishLevel}` : `Цель — местный рынок · English ${d.englishLevel}` },
  ];

  const blockers: string[] = [];
  const actions: string[] = [];
  const targetsUS = d.goal.countries.includes("US");
  const targetsEU = d.goal.countries.includes("EU");
  const regionNames = visaMarkets.filter((x) => x !== "US").map((x) => REGION_RU[x] ?? REGIONS[x]?.label ?? x).join(", ");

  if (d.needsSponsorship && targetsUS) blockers.push("Нужна спонсорская виза — это сильно ограничивает роли в США.");
  else if (visaLimited && regionNames) blockers.push(`Без права на работу часть вакансий (${regionNames}) недоступна — нужна рабочая виза.`);
  if (d.withMetrics < 2) blockers.push("Мало достижений в цифрах — опыт читается как список обязанностей.");
  if (interview < 50) blockers.push("Подготовка к интервью ниже среднего: нет готовых историй для behavioral-вопросов.");
  if (!d.hasLinkedin) blockers.push("Нет LinkedIn — многие формы заявок его требуют.");
  if (skills < 60 && d.missingSkills.length) blockers.push(`Не хватает ключевых навыков под роль: ${d.missingSkills.join(", ")}.`);
  if (c("seniority").status === "bad") blockers.push(`Уровень цели (${SENIORITY_LABEL[d.goal.seniority] ?? d.goal.seniority}) выше твоего опыта — ${fmtYears(d.yearsExperience)}.`);
  if (c("salary").score < 50) blockers.push(`Минимальная зарплата выше рынка для этого уровня (медиана ${kUsd(d.range.mid)}).`);
  if (intl && c("language").score < 75) blockers.push("Английский ниже B2 — для международных ролей этого мало.");
  if (demandRaw < 50) blockers.push("По этой роли сейчас мало открытых вакансий.");

  if (d.withMetrics < 2 || cv < 75) actions.push("Переупакует твои достижения: из обязанностей — в результаты с цифрами.");
  if (d.needsSponsorship && targetsUS) actions.push(targetsEU ? "Сместит фокус на Европу и remote-роли, где виза не нужна." : "Расширит фокус на Европу и remote-роли, где виза не нужна.");
  else if (visaLimited) actions.push("Будет приоритизировать remote-роли и компании, которые спонсируют визу.");
  if (interview < 75) actions.push("Подготовит истории для интервью из твоего реального опыта.");
  if (cv < 90) actions.push("Усилит CV под каждую вакансию: summary, порядок навыков, ключевые слова.");
  const adjacent = r.suggestedRoles.filter((x) => x !== d.goal.primaryRole && !d.goal.extraRoles.includes(x)).slice(0, 2);
  if ((skills < 75 || demandRaw < 50) && adjacent.length) actions.push(`Добавит смежные роли, где твои навыки уже подходят: ${adjacent.join(", ")}.`);
  actions.push("Каждый день будет искать вакансии и подавать заявки только туда, где ты проходишь по требованиям.");

  return { score: r.score, params, blockers: blockers.slice(0, 5), actions: actions.slice(0, 5) };
}

export function fmtYears(y: number) {
  const n = Math.round(y * 10) / 10;
  return `${n.toLocaleString("ru-RU")} ${Number.isInteger(n) ? plural(n, "год", "года", "лет") : "года"}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
