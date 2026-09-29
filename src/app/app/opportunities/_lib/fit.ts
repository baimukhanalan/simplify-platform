// Pure presentation logic for Opportunities: turns engine output (match reasons, eligibility, job vs goal)
// into human sentences — "Why this fits" and «Риски» — in the interface language (pass `t`). Safe for server and client.
import { ROLE_FAMILIES, seniorityIndex } from "@/lib/engine/taxonomy";
import { isOverridable } from "@/lib/engine/matching";
import type { T } from "@/lib/i18n/translator";
import { seniorityName } from "@/lib/i18n/labels";
import { industryT } from "./labels";

export type Reason = { label: string; ok: boolean };

export type FitJob = {
  roleFamily: string;
  seniority: string;
  minYears: number;
  remote: string;
  industry: string;
  salaryMin: number | null;
  salaryMax: number | null;
  sponsorship: string;
  postedAt: Date;
};

export type FitCandidate = {
  yearsExperience: number;
  seniority: string; // goal seniority
  workModes: string[];
  industries: string[];
  needsSponsorship: boolean;
  /** Free text from the profile summary and employment facts — used to detect domain experience (FinTech, e-commerce…). */
  background: string;
};

export type FitOpp = { match: number; eligibility: string; pInterview: number; reasons: Reason[]; blockers: string[]; softGaps: string[] };

const DAY = 86400000;
/** Years as the UI shows them: one decimal at most (2,5). */
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Engine reasons are skills, the role, years ("3+ years") or salary («Зарплата от $60 000») — classify by label shape. */
const isYearsReason = (label: string) => /\byears?\b|≥/i.test(label);
const isSalaryReason = (label: string) => /^зарплата|salary/i.test(label.trim());

/**
 * Interview probability as a number with a plain-language comparison: "22% — выше среднего".
 * Calibrated on the shown (rounded) percent so the words never disagree with the number: < 8% «ниже среднего»,
 * 8–15% «средняя», > 15% «выше среднего». Without `t` the words are Russian.
 */
export function interviewChance(o: { eligibility: string; pInterview: number }, t?: T) {
  const pct = Math.round(Math.max(0, Math.min(1, o.pInterview)) * 100);
  const [key, tone] =
    o.eligibility === "blocked" ? (["chanceBlocked", "rose"] as const)
    : pct > 15 ? (["chanceAbove", "green"] as const)
    : pct >= 8 ? (["chanceAverage", "teal"] as const)
    : (["chanceBelow", "amber"] as const);
  const qual = t ? t(`opps.${key}`) : CHANCE_RU[key];
  return { pct, qual, tone, label: t ? t("opps.chanceLabel", { pct, qual }) : `${pct}% — ${qual}` };
}
const CHANCE_RU = { chanceBlocked: "не проходишь по требованиям", chanceAbove: "выше среднего", chanceAverage: "средняя", chanceBelow: "ниже среднего" } as const;

const INDUSTRY_ALIASES: Record<string, string[]> = {
  fintech: ["fintech", "finance", "bank", "payments", "kaspi", "credit"],
  "e-commerce": ["e-commerce", "ecommerce", "retail", "marketplace"],
  retail: ["retail", "e-commerce", "stores"],
  saas: ["saas", "b2b"],
};

function hasDomain(industry: string, background: string) {
  const ind = industry.toLowerCase().trim();
  if (!ind) return false;
  const bg = background.toLowerCase();
  const keys = INDUSTRY_ALIASES[ind] ?? Object.entries(INDUSTRY_ALIASES).find(([k]) => ind.includes(k))?.[1] ?? [ind];
  return keys.some((k) => bg.includes(k));
}

/** Short positive bullets, most convincing first. Skill and role labels are shown as the engine names them. */
export function whyFits(t: T, o: FitOpp, job: FitJob, c: FitCandidate, limit = 4): string[] {
  const out: string[] = [];
  const roleLabel = ROLE_FAMILIES[job.roleFamily]?.label ?? "";
  const skills = o.reasons.filter((r) => r.ok && !isYearsReason(r.label) && !isSalaryReason(r.label) && r.label !== roleLabel);
  const role = o.reasons.find((r) => r.label === roleLabel);
  if (skills.length) out.push(t("opps.whySkills", { list: skills.slice(0, 3).map((r) => r.label).join(", ") }));
  if (job.industry && hasDomain(job.industry, c.background)) out.push(t("opps.whyDomain", { industry: industryT(t, job.industry, true) }));
  if (role?.ok) out.push(t("opps.whyRole", { role: role.label }));
  if (job.remote === "remote" && o.eligibility !== "blocked") out.push(t("opps.whyRemote"));
  else if (c.workModes.includes(job.remote) && o.eligibility !== "blocked") out.push(t(job.remote === "hybrid" ? "opps.whyHybrid" : "opps.whyOnsite"));
  const senGap = seniorityIndex(job.seniority) - seniorityIndex(c.seniority);
  if (senGap === 0 || (senGap === 1 && c.yearsExperience >= job.minYears)) out.push(t("opps.whyLevel", { level: seniorityName(t, job.seniority) }));
  if (job.minYears && c.yearsExperience >= job.minYears) out.push(t("opps.whyYears", { years: round1(c.yearsExperience), min: round1(job.minYears) }));
  const salary = o.reasons.find((r) => isSalaryReason(r.label));
  if (salary?.ok) out.push(t("opps.whySalary"));
  return out.slice(0, limit);
}

/**
 * One risk line. `engine`: the engine's own words (blockers, soft gaps) — Russian for now, rendered with lang="ru" in
 * other languages; `blocker`: a hard requirement the user fails; `old`: the «posted over a month ago» line.
 */
export type Risk = { text: string; engine: boolean; blocker?: boolean; old?: boolean };

/** Honest risks: stated gaps plus what the posting leaves unknown. */
export function risks(t: T, o: FitOpp, job: FitJob, c: FitCandidate): Risk[] {
  const out: Risk[] = o.blockers.map((b) => ({ text: b, engine: true, blocker: true }));
  if (job.minYears && c.yearsExperience < job.minYears) out.push({ text: t("opps.riskYears", { min: round1(job.minYears), have: t.num(c.yearsExperience) }), engine: false });
  for (const g of o.softGaps) {
    if (/^Требуется \d/.test(g)) continue; // restated above with the user's exact years
    out.push(job.sponsorship === "yes" && /спонсорство не указано/i.test(g) ? { text: t("opps.riskVisaSponsored"), engine: false } : { text: g, engine: true });
  }
  const missing = o.reasons.filter((r) => !r.ok && !isYearsReason(r.label) && !isSalaryReason(r.label) && r.label !== (ROLE_FAMILIES[job.roleFamily]?.label ?? ""));
  const mentioned = out.map((r) => r.text).join(" ");
  const unlisted = missing.filter((r) => !mentioned.includes(r.label));
  if (unlisted.length) out.push({ text: t("opps.riskNotInProfile", { list: unlisted.map((r) => r.label).join(", ") }), engine: false });
  if (!job.salaryMin && !job.salaryMax) out.push({ text: t("opps.riskNoSalary"), engine: false });
  if (job.sponsorship === "unknown" && c.needsSponsorship && job.remote !== "remote") out.push({ text: t("opps.riskSponsorship"), engine: false });
  const age = (Date.now() - job.postedAt.getTime()) / DAY;
  if (age > 30) out.push({ text: t("opps.riskOld"), engine: false, old: true });
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.text) ? false : (seen.add(r.text), true)));
}

/**
 * Why a role is blocked, as decided by the engine (fitVerdict().kind in src/lib/engine/matching.ts): "filter" = the
 * user's own goal settings exclude it («Не подходит тебе»), "requirement" = the user fails the posting («Не проходишь»).
 */
export type BlockKind = "filter" | "requirement";

/** One short line for the Apply button's title / the skipped state. */
export const blockedNote = (t: T, kind: BlockKind) => t(kind === "filter" ? "opps.blockedFilter" : "opps.blockedRequirement");

/** fitVerdict().headline in the interface language (the reason line stays the engine's). */
export const blockedHeadline = (t: T, kind: BlockKind | null) => t(kind === "filter" ? "opps.headlineFilter" : "opps.headlineRequirement");

/** Eligibility as a verdict the user reads in one glance. */
export function eligibilityVerdict(t: T, e: string, kind: BlockKind | null = "requirement") {
  if (e === "blocked" && kind === "filter") return { label: t("opps.headlineFilter"), hint: t("opps.verdictFilterHint"), tone: "rose" as const };
  if (e === "blocked") return { label: t("opps.headlineRequirement"), hint: t("opps.verdictBlockedHint"), tone: "rose" as const };
  if (e === "soft") return { label: t("opps.verdictPass"), hint: t("opps.verdictSoftHint"), tone: "amber" as const };
  return { label: t("opps.verdictPass"), hint: t("opps.verdictOkHint"), tone: "green" as const };
}

/**
 * The CV of one application, labelled the same everywhere (application card, Interview Room): "CV для Kaspi" or just "CV".
 * Internal version counters ("v57-product_analyst") never reach the UI — they grow across users and mean nothing to one.
 */
export const cvVersionLabel = (_v?: string | null, company?: string | null) => (company ? `CV для ${company}` : "CV");

export { plural } from "../../../_components/ru";

/** Requirement lines from sources often carry their own bullet ("- SQL"); the UI draws its own. */
export const cleanRequirement = (r: string) => r.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, "").trim();

/** Is `company` one of the user's dream companies (Goal.dreamCompanies, same substring rule as the engine)? */
export const isDreamCompany = (company: string, dreamCompanies: string[]) =>
  dreamCompanies.some((d) => d && company.toLowerCase().includes(d.toLowerCase()));

/**
 * For a blocked role the user may still send (isOverridable — src/lib/engine/matching.ts), the line shown above
 * Apply / Auto; null when the block is final (visa, language, the user's own filters…).
 */
export function overrideNote(t: T, eligibility: string, blockers: string[] | string, dream: boolean): string | null {
  if (eligibility !== "blocked" || !isOverridable(blockers, { dream })) return null;
  return t(dream ? "opps.overrideDream" : "opps.overrideLevel");
}
