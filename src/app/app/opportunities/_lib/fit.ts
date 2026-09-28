// Pure presentation logic for Opportunities: turns engine output (match reasons, eligibility, job vs goal)
// into human sentences — "Why this fits" and "Risks". Safe for server and client.
import { ROLE_FAMILIES, SENIORITY_LABEL, seniorityIndex } from "@/lib/engine/taxonomy";

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

/** Interview probability bucket. pInterview is capped at 0.6 by the engine; typical strong roles land at 0.1–0.3. */
export function interviewChance(o: { eligibility: string; pInterview: number }) {
  if (o.eligibility === "blocked") return { label: "Low", tone: "rose" as const };
  if (o.pInterview >= 0.15) return { label: "High", tone: "green" as const };
  if (o.pInterview >= 0.06) return { label: "Medium", tone: "teal" as const };
  return { label: "Low", tone: "amber" as const };
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
  if (skills.length) out.push(`${skills.slice(0, 3).map((r) => r.label).join(", ")} match`);
  if (job.industry && hasDomain(job.industry, c.background)) out.push(`${job.industry} experience`);
  if (role?.ok) out.push(`Роль совпадает с целью: ${role.label}`);
  if (job.remote === "remote" && o.eligibility !== "blocked") out.push("Remote eligible");
  else if (c.workModes.includes(job.remote) && o.eligibility !== "blocked") out.push(`${job.remote === "hybrid" ? "Hybrid" : "Onsite"} — ваш формат`);
  const senGap = seniorityIndex(job.seniority) - seniorityIndex(c.seniority);
  if (senGap === 0 || (senGap === 1 && c.yearsExperience >= job.minYears)) out.push(`Seniority aligned (${SENIORITY_LABEL[job.seniority] ?? job.seniority})`);
  if (job.minYears && c.yearsExperience >= job.minYears) out.push(`Опыт ${years(c.yearsExperience)} г. ≥ ${years(job.minYears)} требуемых`);
  const salary = o.reasons.find((r) => /salary/i.test(r.label));
  if (salary?.ok) out.push("Зарплата выше вашего минимума");
  return out.slice(0, limit);
}

/** Honest risks: stated gaps plus what the posting leaves unknown. */
export function risks(o: FitOpp, job: FitJob, c: FitCandidate): string[] {
  const out: string[] = [...o.blockers];
  if (job.minYears && c.yearsExperience < job.minYears) out.push(`Требуется ${years(job.minYears)}+ лет, у вас ${years(c.yearsExperience)}`);
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
  if (e === "blocked") return { label: "Fail", hint: "Формально не проходите — агент не подаёт", tone: "rose" as const };
  if (e === "soft") return { label: "Pass", hint: "Проходите, но есть пробелы", tone: "amber" as const };
  return { label: "Pass", hint: "Формальных препятствий нет", tone: "green" as const };
}

/** "v14-data_analyst" → "Version 14". */
export const cvVersionLabel = (v: string | null | undefined) => {
  if (!v) return "—";
  const n = /^v(\d+)/i.exec(v)?.[1];
  return n ? `Version ${n}` : v;
};

/** Russian plural: plural(5, ["вакансия", "вакансии", "вакансий"]). */
export function plural(n: number, forms: [string, string, string]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Requirement lines from sources often carry their own bullet ("- SQL"); the UI draws its own. */
export const cleanRequirement = (r: string) => r.replace(/^\s*(?:[-•*–]|\d+[.)])\s*/, "").trim();
