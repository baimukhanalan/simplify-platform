import { ROLE_FAMILIES, classifyRole, seniorityFromYears } from "./taxonomy";
import { marketDemandScore, marketRange } from "./market";
import { interviewReadiness } from "./interview-readiness";

const EN: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export function careerScore(i: { role: string; skills: string[]; yearsExperience: number; englishLevel: string; workAuth: string[]; relocation: boolean; stories: number; mockScores?: number[]; /** @deprecated pass mockScores */ mockAvg?: number | null; currentSalary: number; demandJobs: number; regions: string[] }) {
  const family = classifyRole(i.role);
  const fam = ROLE_FAMILIES[family] ?? ROLE_FAMILIES.other;
  const have = new Set(i.skills.map((s) => s.toLowerCase()));
  const coverage = fam.skills.length ? fam.skills.filter((s) => have.has(s.toLowerCase())).length / Math.min(5, fam.skills.length) : 0.5;
  const seniority = seniorityFromYears(i.yearsExperience);
  const range = marketRange(family, seniority, i.regions.length ? i.regions : ["WORLD"]);
  const marketValue = Math.round((range.mid * (0.9 + 0.2 * Math.min(1, coverage))) / 1000) * 1000;
  const components = {
    // Same function as the Readiness "Market demand" parameter (./market.ts).
    marketDemand: marketDemandScore(i.demandJobs),
    // Years in the field — NOT Readiness's "Experience", which measures how the profile backs the goal level.
    skillStrength: Math.min(100, Math.round(40 + coverage * 60)),
    experience: Math.min(100, Math.round(30 + i.yearsExperience * 11)),
    // The same interview readiness as the Readiness page and the Career Readiness check (./interview-readiness.ts).
    interviewReadiness: interviewReadiness({ stories: i.stories, mockScores: i.mockScores ?? (i.mockAvg != null ? [i.mockAvg] : []) }).score,
    internationalMobility: Math.min(100, (EN[i.englishLevel] ?? 3) * 12 + (i.relocation ? 18 : 0) + Math.min(2, i.workAuth.length) * 5),
    compensationPosition: i.currentSalary ? Math.max(5, Math.min(100, Math.round((i.currentSalary / marketValue) * 75))) : 50,
  };
  const score = Math.round(Object.values(components).reduce((a, b) => a + b, 0) / 6);
  const gap = i.currentSalary ? marketValue - i.currentSalary : 0;
  return { score, components, marketValue, range, gap, underpaid: i.currentSalary > 0 && gap / marketValue > 0.15 };
}

/**
 * Two different scores, named apart so identical labels never show different numbers:
 * Readiness = «готовность к цели» (the goal you chose), Career Score = «положение на рынке» (where you stand today).
 * Shared components (Market demand, Interview readiness) come from the same functions on both screens.
 */
export const SCORE_NAMES = {
  readiness: { en: "Readiness", ru: "Готовность к цели" },
  career: { en: "Career Score", ru: "Положение на рынке" },
} as const;

export const COMPONENT_LABEL: Record<string, string> = {
  marketDemand: "Market demand", skillStrength: "Skill strength", experience: "Years in the field",
  interviewReadiness: "Interview readiness", internationalMobility: "International mobility", compensationPosition: "Compensation position",
};

/** Russian labels for the Career Score breakdown. "Стаж" (years) — never «Опыт», which is Readiness's goal-fit parameter. */
export const COMPONENT_LABEL_RU: Record<string, string> = {
  marketDemand: "Спрос на рынке", skillStrength: "Навыки", experience: "Стаж в профессии",
  interviewReadiness: "Готовность к интервью", internationalMobility: "Международная мобильность", compensationPosition: "Компенсация",
};
