// Pure: turns the engine's readiness checks into the six parameters, blockers and the agent's plan.
import type { Readiness, ReadinessCheck } from "@/lib/engine/readiness";
import { REGIONS, ROLE_FAMILIES, SENIORITY_LABEL, fmtMoney } from "@/lib/engine/taxonomy";
import { marketDemandScore } from "@/lib/engine/market";
import { REGION_RU, plural } from "../../../_components/ru";
import { createTranslator, type Messages, type T } from "@/lib/i18n/translator";
import { regionName, seniorityName } from "@/lib/i18n/labels";
import { readinessPageRu } from "@/lib/i18n/dictionaries/ru/readiness-page";

export type ReadinessData = {
  readiness: Readiness;
  /** The goal's market in the goal currency (readiness.market): per year, or per month for a ₸ / local goal. */
  range: Readiness["market"];
  family: string;
  /** An open or accepted offer already pays at least the goal minimum: the minimum is proven, never «lower it». */
  offerMeetsMinimum?: boolean;
  goal: { primaryRole: string; seniority: string; minSalary: number; currency: string; countries: string[]; workModes: string[]; dreamCompanies: string[]; sponsorshipNeeded: boolean; extraRoles: string[] };
  actualSeniority: string;
  yearsExperience: number;
  englishLevel: string;
  hasLinkedin: boolean;
  needsSponsorship: boolean;
  withMetrics: number;
  /** The user's own skills (Career Profile) — evidence for «навыки уже подходят» on adjacent roles. */
  skills: string[];
  stories: number;
  mocks: number;
  jobsForRole: number;
  missingSkills: string[];
};

/** « в месяц» for a monthly (₸) market, nothing for a yearly one. */
export const perPeriod = (m: Pick<Readiness["market"], "period">) => (m.period === "month" ? " в месяц" : "");
/** «$48 000–$68 000» / «350 000–520 000 ₸ в месяц» — the market range in the goal currency. */
export const marketRangeText = (m: Readiness["market"]) => `${fmtMoney(m.low, m.currency)}–${fmtMoney(m.high, m.currency)}${perPeriod(m)}`;

export type Level = "strong" | "mid" | "weak";
/** `noteLang` = "ru" when the note is engine text (stays Russian) shown in another language. */
export type Param = { key: string; label: string; score: number; level: Level; note: string; noteLang?: string };

export const LEVEL_LABEL: Record<Level, string> = { strong: "Сильно", mid: "Средне", weak: "Слабо" };
const level = (n: number): Level => (n >= 75 ? "strong" : n >= 50 ? "mid" : "weak");
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const LOCAL = new Set(["KZ", "CIS"]);

/** Russian translator over this namespace only: readinessView() without a `t` (onboarding) renders exactly as before. */
const RU_T = createTranslator("ru", { readinessPage: readinessPageRu } as Messages);

export function isInternational(countries: string[]) {
  return countries.some((c) => !LOCAL.has(c));
}

/** The goal title (role only) and its market subtitle — one definition for every screen (src/lib/engine/taxonomy.ts). */
export { goalMarket, goalTitle } from "@/lib/engine/taxonomy";

/** «3 года» · «3 жыл» · «3 years» (one decimal: «2,5 года»). */
export const yearsText = (t: T, y: number) => t("readinessPage.years", { n: Math.round(y * 10) / 10 });
/** The goal level in the current language (Junior/Middle… stay as they are; «Стажёр» translates). */
const levelName = (t: T, key: string) => (t.has("seniority.intern") ? seniorityName(t, key) : SENIORITY_LABEL[key] ?? key);
const regionLabel = (t: T, key: string) => (t.has("regions.KZ") ? regionName(t, key) : REGION_RU[key] ?? REGIONS[key]?.label ?? key);
const rangeText = (t: T, m: Readiness["market"]) =>
  t(m.period === "month" ? "readinessPage.rangeMonth" : "readinessPage.rangeYear", { low: t.money(m.low, m.currency), high: t.money(m.high, m.currency) });

/** The six parameters, blockers and plan. Pass the page's `t` for the user's language; without it the text is Russian. */
export function readinessView(d: ReadinessData, t: T = RU_T) {
  const r = d.readiness;
  const c = (key: string): ReadinessCheck => r.checks.find((x) => x.key === key) ?? { key, label: key, score: 60, weight: 1, note: "", status: "warn" };
  const intl = isInternational(d.goal.countries);
  // Engine notes (readiness.ts) stay Russian: marked for screen readers and the browser in another language.
  const engine = t.locale === "ru" ? undefined : "ru";

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
  const years = yearsText(t, d.yearsExperience);
  const goalLevel = levelName(t, d.goal.seniority);

  const params: Param[] = [
    { key: "skills", label: t("readinessPage.param.skills"), score: skills, level: level(skills), note: d.missingSkills.length && skills < 75 ? t("readinessPage.note.skillsMissing", { skills: d.missingSkills.join(", ") }) : t("readinessPage.note.skillsOk") },
    { key: "experience", label: t("readinessPage.param.experience"), score: experience, level: level(experience), note: t("readinessPage.note.experience", { years, level: goalLevel }) },
    { key: "cv", label: t("readinessPage.param.cv"), score: cv, level: level(cv), note: d.withMetrics ? t("readinessPage.note.cvMetrics", { n: d.withMetrics }) : t("readinessPage.note.cvNone") },
    { key: "interview", label: t("readinessPage.param.interview"), score: interview, level: level(interview), note: r.interview.note, noteLang: engine },
    { key: "demand", label: t("readinessPage.param.demand"), score: demand, level: level(demand), note: t("readinessPage.note.demand", { n: d.jobsForRole, range: rangeText(t, d.range) }) },
    { key: "eligibility", label: t("readinessPage.param.eligibility"), score: eligibility, level: level(eligibility), note: r.eligibility.note, noteLang: engine },
  ];

  const blockers: string[] = [];
  const actions: string[] = [];
  const targetsUS = d.goal.countries.includes("US");
  const targetsEU = d.goal.countries.includes("EU");
  const regionNames = visaMarkets.filter((x) => x !== "US").map((x) => regionLabel(t, x)).join(", ");

  if (d.needsSponsorship && targetsUS) blockers.push(t("readinessPage.blocker.sponsorUS"));
  else if (visaLimited && regionNames) blockers.push(t("readinessPage.blocker.visa", { regions: regionNames }));
  if (d.withMetrics < 2) blockers.push(t("readinessPage.blocker.metrics"));
  if (interview < 50) blockers.push(t("readinessPage.blocker.interview"));
  if (!d.hasLinkedin) blockers.push(t("readinessPage.blocker.linkedin"));
  if (skills < 60 && d.missingSkills.length) blockers.push(t("readinessPage.blocker.skills", { skills: d.missingSkills.join(", ") }));
  if (c("seniority").status === "bad") blockers.push(t("readinessPage.blocker.seniority", { level: goalLevel, years }));
  if (c("salary").score < 50 && !d.offerMeetsMinimum) {
    const median = t(d.range.period === "month" ? "readinessPage.medianMonth" : "readinessPage.medianYear", { amount: t.money(d.range.mid, d.range.currency) });
    blockers.push(t("readinessPage.blocker.salary", { median }));
  }
  if (intl && c("language").score < 75) blockers.push(t("readinessPage.blocker.english"));
  const fewJobs = d.jobsForRole < 5;
  if (fewJobs) blockers.push(t("readinessPage.blocker.fewJobs"));

  if (d.withMetrics < 2 || cv < 75) actions.push(t("readinessPage.action.metrics"));
  if (d.needsSponsorship && targetsUS) actions.push(targetsEU ? t("readinessPage.action.shiftEU") : t("readinessPage.action.widenEU"));
  else if (visaLimited) actions.push(t("readinessPage.action.sponsors"));
  if (interview < 75) actions.push(t("readinessPage.action.stories"));
  if (cv < 90) actions.push(t("readinessPage.action.cv"));
  const adjacent = r.suggestedRoles.filter((x) => x !== d.goal.primaryRole && !d.goal.extraRoles.includes(x)).slice(0, 2);
  if ((skills < 75 || fewJobs) && adjacent.length) {
    const proven = adjacent.filter((role) => adjacentSkills(role, d.skills).length >= MIN_ADJACENT_SKILLS);
    actions.push(proven.length === adjacent.length
      ? t("readinessPage.action.adjacentProven", { roles: adjacent.join(", ") })
      : t("readinessPage.action.adjacent", { roles: adjacent.join(", ") }));
  }
  actions.push(t("readinessPage.action.daily"));

  return { score: r.score, params, blockers: blockers.slice(0, 5), actions: actions.slice(0, 5) };
}

export function fmtYears(y: number) {
  const n = Math.round(y * 10) / 10;
  return `${n.toLocaleString("ru-RU")} ${Number.isInteger(n) ? plural(n, ["год", "года", "лет"]) : "года"}`;
}


/** Adjacent roles claim «навыки уже подходят» only with at least this many of the role's core skills in the profile. */
export const MIN_ADJACENT_SKILLS = 2;

/** The role family's core skills the user already has (by the family label, e.g. "Product Analyst"). */
export function adjacentSkills(roleLabel: string, skills: string[]): string[] {
  const family = Object.values(ROLE_FAMILIES).find((f) => f.label === roleLabel);
  if (!family) return [];
  const have = new Set(skills.map((x) => x.toLowerCase()));
  return family.skills.filter((x) => have.has(x.toLowerCase()));
}
