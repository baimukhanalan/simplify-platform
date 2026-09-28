// Pure: turns the engine's readiness checks into the six parameters, blockers and the agent's plan.
import type { Readiness, ReadinessCheck } from "@/lib/engine/readiness";
import { REGIONS, SENIORITY_LABEL, fmtMoney } from "@/lib/engine/taxonomy";
import { marketDemandScore } from "@/lib/engine/market";
import { REGION_RU, plural } from "../../../_components/ru";

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
const LOCAL = new Set(["KZ", "CIS"]);

export function isInternational(countries: string[]) {
  return countries.some((c) => !LOCAL.has(c));
}

/** The goal title (role only) and its market subtitle — one definition for every screen (src/lib/engine/taxonomy.ts). */
export { goalMarket, goalTitle } from "@/lib/engine/taxonomy";

export function readinessView(d: ReadinessData) {
  const r = d.readiness;
  const c = (key: string): ReadinessCheck => r.checks.find((x) => x.key === key) ?? { key, label: key, score: 60, weight: 1, note: "", status: "warn" };
  const intl = isInternational(d.goal.countries);

  const skills = c("skills").score;
  const experience = clamp((c("experience").score + c("seniority").score) / 2);
  const cv = clamp(c("cv").score * 0.75 + c("portfolio").score * 0.25);
  // Same score as Career Score's interview component (src/lib/engine/interview-readiness.ts).
  const interview = r.interview.score;
  // One formula with Career Score's «Спрос на рынке» (src/lib/engine/market.ts): same data → same number on both screens.
  const demand = clamp(marketDemandScore(d.jobsForRole));
  const visaMarkets = d.goal.countries.filter((x) => !LOCAL.has(x) && x !== "WORLD");
  const visaLimited = d.needsSponsorship && visaMarkets.length > 0;
  // «Право на работу за рубежом»: score and note come from one engine rule (internationalEligibility, readiness.ts).
  const eligibility = clamp(r.eligibility.score);

  const params: Param[] = [
    { key: "skills", label: "Навыки", score: skills, level: level(skills), note: d.missingSkills.length && skills < 75 ? `Не хватает: ${d.missingSkills.join(", ")}` : "Навыки закрывают требования роли" },
    { key: "experience", label: "Опыт под цель", score: experience, level: level(experience), note: `${fmtYears(d.yearsExperience)} опыта · цель ${SENIORITY_LABEL[d.goal.seniority] ?? d.goal.seniority}` },
    { key: "cv", label: "Качество CV", score: cv, level: level(cv), note: d.withMetrics ? `${d.withMetrics} ${plural(d.withMetrics, ["достижение", "достижения", "достижений"])} с цифрами` : "Нет достижений в цифрах" },
    { key: "interview", label: "Готовность к интервью", score: interview, level: level(interview), note: r.interview.note },
    { key: "demand", label: "Спрос на рынке", score: demand, level: level(demand), note: `${d.jobsForRole} ${plural(d.jobsForRole, ["открытая вакансия", "открытые вакансии", "открытых вакансий"])} по роли · рынок ${fmtMoney(d.range.low)}–${fmtMoney(d.range.high)}` },
    { key: "eligibility", label: "Право на работу за рубежом", score: eligibility, level: level(eligibility), note: r.eligibility.note },
  ];

  const blockers: string[] = [];
  const actions: string[] = [];
  const targetsUS = d.goal.countries.includes("US");
  const targetsEU = d.goal.countries.includes("EU");
  const regionNames = visaMarkets.filter((x) => x !== "US").map((x) => REGION_RU[x] ?? REGIONS[x]?.label ?? x).join(", ");

  if (d.needsSponsorship && targetsUS) blockers.push("Нужна спонсорская виза — это сильно ограничивает роли в США.");
  else if (visaLimited && regionNames) blockers.push(`Без права на работу часть вакансий (${regionNames}) недоступна — нужна рабочая виза.`);
  if (d.withMetrics < 2) blockers.push("Мало достижений в цифрах — опыт читается как список обязанностей.");
  if (interview < 50) blockers.push("Подготовка к интервью ниже среднего: нет готовых историй для поведенческих вопросов.");
  if (!d.hasLinkedin) blockers.push("Нет LinkedIn — многие формы заявок его требуют.");
  if (skills < 60 && d.missingSkills.length) blockers.push(`Не хватает ключевых навыков под роль: ${d.missingSkills.join(", ")}.`);
  if (c("seniority").status === "bad") blockers.push(`Уровень цели (${SENIORITY_LABEL[d.goal.seniority] ?? d.goal.seniority}) выше твоего опыта — ${fmtYears(d.yearsExperience)}.`);
  if (c("salary").score < 50) blockers.push(`Минимальная зарплата выше рынка для этого уровня (медиана ${fmtMoney(d.range.mid)}).`);
  if (intl && c("language").score < 75) blockers.push("Английский ниже B2 — для международных ролей этого мало.");
  const fewJobs = d.jobsForRole < 5;
  if (fewJobs) blockers.push("По этой роли сейчас мало открытых вакансий.");

  if (d.withMetrics < 2 || cv < 75) actions.push("Переупакует твои достижения: из обязанностей — в результаты с цифрами.");
  if (d.needsSponsorship && targetsUS) actions.push(targetsEU ? "Сместит фокус на Европу и удалённые роли, где виза не нужна." : "Расширит фокус на Европу и удалённые роли, где виза не нужна.");
  else if (visaLimited) actions.push("В первую очередь будет выбирать удалённые роли и компании, которые спонсируют визу.");
  if (interview < 75) actions.push("Подготовит истории для интервью из твоего реального опыта.");
  if (cv < 90) actions.push("Усилит CV под каждую вакансию: краткое описание, порядок навыков, ключевые слова.");
  const adjacent = r.suggestedRoles.filter((x) => x !== d.goal.primaryRole && !d.goal.extraRoles.includes(x)).slice(0, 2);
  if ((skills < 75 || fewJobs) && adjacent.length) actions.push(`Добавит смежные роли, где твои навыки уже подходят: ${adjacent.join(", ")}.`);
  actions.push("Каждый день будет искать вакансии и подавать заявки только туда, где ты проходишь по требованиям.");

  return { score: r.score, params, blockers: blockers.slice(0, 5), actions: actions.slice(0, 5) };
}

export function fmtYears(y: number) {
  const n = Math.round(y * 10) / 10;
  return `${n.toLocaleString("ru-RU")} ${Number.isInteger(n) ? plural(n, ["год", "года", "лет"]) : "года"}`;
}

