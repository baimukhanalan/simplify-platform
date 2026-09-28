// Pure presentation logic for Opportunities: turns engine output (match reasons, eligibility, job vs goal)
// into human sentences — "Why this fits" and «Риски». Safe for server and client.
import { ROLE_FAMILIES, SENIORITY_LABEL, seniorityIndex } from "@/lib/engine/taxonomy";
import { plural } from "../../../_components/ru";

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
const years = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1));
/** "от 1 года", "от 2 лет", "от 2.5 года" — genitive after «от». */
const fromYears = (n: number) => (n % 1 === 0 ? plural(n, ["года", "лет", "лет"]) : "года");

/**
 * Interview probability as a number with a plain-language comparison: "22% — выше среднего".
 * pInterview is capped at 0.6 by the engine; typical strong roles land at 0.1–0.3, so ~6–15% is "around average".
 */
export function interviewChance(o: { eligibility: string; pInterview: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, o.pInterview)) * 100);
  const [qual, tone] =
    o.eligibility === "blocked" ? (["не проходишь по требованиям", "rose"] as const)
    : o.pInterview >= 0.15 ? (["выше среднего", "green"] as const)
    : o.pInterview >= 0.06 ? (["около среднего", "teal"] as const)
    : (["ниже среднего", "amber"] as const);
  return { pct, qual, tone, label: `${pct}% — ${qual}` };
}

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

/** Short positive bullets, most convincing first. */
export function whyFits(o: FitOpp, job: FitJob, c: FitCandidate, limit = 4): string[] {
  const out: string[] = [];
  const skills = o.reasons.filter((r) => r.ok && !/years|salary|≥/i.test(r.label) && r.label !== (ROLE_FAMILIES[job.roleFamily]?.label ?? ""));
  const role = o.reasons.find((r) => r.label === ROLE_FAMILIES[job.roleFamily]?.label);
  if (skills.length) out.push(`Совпадают навыки: ${skills.slice(0, 3).map((r) => r.label).join(", ")}`);
  if (job.industry && hasDomain(job.industry, c.background)) out.push(`Есть опыт в ${job.industry}`);
  if (role?.ok) out.push(`Роль совпадает с целью: ${role.label}`);
  if (job.remote === "remote" && o.eligibility !== "blocked") out.push("Удалённо — доступно тебе");
  else if (c.workModes.includes(job.remote) && o.eligibility !== "blocked") out.push(`${job.remote === "hybrid" ? "Гибрид" : "Офис"} — твой формат`);
  const senGap = seniorityIndex(job.seniority) - seniorityIndex(c.seniority);
  if (senGap === 0 || (senGap === 1 && c.yearsExperience >= job.minYears)) out.push(`Уровень совпадает: ${SENIORITY_LABEL[job.seniority] ?? job.seniority}`);
  if (job.minYears && c.yearsExperience >= job.minYears) out.push(`Опыт ${years(c.yearsExperience)} ${c.yearsExperience % 1 === 0 ? plural(c.yearsExperience, ["год", "года", "лет"]) : "года"} — требуется от ${years(job.minYears)}`);
  const salary = o.reasons.find((r) => /salary/i.test(r.label));
  if (salary?.ok) out.push("Зарплата выше твоего минимума");
  return out.slice(0, limit);
}

/** Honest risks: stated gaps plus what the posting leaves unknown. */
export function risks(o: FitOpp, job: FitJob, c: FitCandidate): string[] {
  const out: string[] = [...o.blockers];
  if (job.minYears && c.yearsExperience < job.minYears) out.push(`Нужен опыт от ${years(job.minYears)} ${fromYears(job.minYears)}, у тебя ${years(c.yearsExperience)}`);
  for (const g of o.softGaps) {
    if (/^Требуется \d/.test(g)) continue; // restated above with the user's exact years
    out.push(job.sponsorship === "yes" && /спонсорство не указано/i.test(g) ? "Нужна виза — компания спонсирует" : g);
  }
  const missing = o.reasons.filter((r) => !r.ok && !/years|salary|≥/i.test(r.label) && r.label !== (ROLE_FAMILIES[job.roleFamily]?.label ?? ""));
  const mentioned = out.join(" ");
  const unlisted = missing.filter((r) => !mentioned.includes(r.label));
  if (unlisted.length) out.push(`Нет в профиле: ${unlisted.map((r) => r.label).join(", ")}`);
  if (!job.salaryMin && !job.salaryMax) out.push("Зарплата не опубликована");
  if (job.sponsorship === "unknown" && c.needsSponsorship && job.remote !== "remote") out.push("Спонсорство визы не указано");
  const age = (Date.now() - job.postedAt.getTime()) / DAY;
  if (age > 30) out.push("Вакансия опубликована больше месяца назад");
  return [...new Set(out)];
}

/** Eligibility as a verdict the user reads in one glance. */
export function eligibilityVerdict(e: string) {
  if (e === "blocked") return { label: "Не проходишь", hint: "Агент на неё не подаёт", tone: "rose" as const };
  if (e === "soft") return { label: "Проходишь", hint: "Есть пробелы, но подать можно", tone: "amber" as const };
  return { label: "Проходишь", hint: "Формальных препятствий нет", tone: "green" as const };
}

/**
 * The CV of one application, labelled the same everywhere (application card, Interview Room): "CV для Kaspi" or just "CV".
 * Internal version counters ("v57-product_analyst") never reach the UI — they grow across users and mean nothing to one.
 */
export const cvVersionLabel = (_v?: string | null, company?: string | null) => (company ? `CV для ${company}` : "CV");

export { plural } from "../../../_components/ru";

/** Requirement lines from sources often carry their own bullet ("- SQL"); the UI draws its own. */
export const cleanRequirement = (r: string) => r.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, "").trim();
