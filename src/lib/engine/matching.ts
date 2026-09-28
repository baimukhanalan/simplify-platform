import { REGIONS, ROLE_FAMILIES, seniorityIndex, seniorityFromYears, classifyRole, normalizeLanguage, wordRe } from "./taxonomy";

const ADVANCED_DEGREE = wordRe("master|phd|магистр", { end: false });

export type CandidateCtx = {
  skills: string[];
  yearsExperience: number;
  englishLevel: string;
  languages: string[];
  workAuth: string[];
  needsSponsorship: boolean;
  relocation: boolean;
  educationLevel: "none" | "bachelor" | "master" | "phd";
  goal: { primaryRole: string; extraRoles: string[]; seniority: string; minSalary: number; countries: string[]; workModes: string[]; industries: string[]; dreamCompanies: string[]; blockedCompanies: string[]; mode: string };
  allocation: Record<string, number>; // learned segment weights (feedback loop)
};

export type JobCtx = {
  title: string; company: string; roleFamily: string; seniority: string; countries: string[]; remote: string;
  salaryMin: number | null; salaryMax: number | null; technologies: string[]; requirements: string[]; minYears: number;
  education: string; workAuth: string[]; sponsorship: string; languages: string[]; industry: string; massHiring: boolean; postedAt: Date;
};

export type MatchResult = {
  match: number; reasons: { label: string; ok: boolean }[];
  eligibility: "eligible" | "soft" | "blocked"; blockers: string[]; softGaps: string[];
  pInterview: number; priority: number; lane: "standard" | "target" | "mass"; segment: string; freshnessDays: number;
};

const EN: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

function targetCountries(regions: string[]) {
  return new Set(regions.flatMap((r) => REGIONS[r]?.countries ?? [r]));
}

export function scoreJob(c: CandidateCtx, job: JobCtx, now = new Date()): MatchResult {
  const reasons: MatchResult["reasons"] = [];
  const blockers: string[] = [];
  const softGaps: string[] = [];
  const have = new Set(c.skills.map((s) => s.toLowerCase()));

  // ——— Match: professional fit ———
  const wanted = [c.goal.primaryRole, ...c.goal.extraRoles].map(classifyRole);
  const roleFit = wanted[0] === job.roleFamily ? 1 : wanted.includes(job.roleFamily) ? 0.85 : 0.35;
  reasons.push({ label: ROLE_FAMILIES[job.roleFamily]?.label ?? job.title, ok: roleFit >= 0.85 });

  const tech = job.technologies.length ? job.technologies : ROLE_FAMILIES[job.roleFamily]?.skills.slice(0, 4) ?? [];
  const hit = tech.filter((t) => have.has(t.toLowerCase()));
  for (const t of tech.slice(0, 6)) reasons.push({ label: t, ok: have.has(t.toLowerCase()) });
  const skillFit = tech.length ? hit.length / tech.length : 0.6;
  for (const t of tech.filter((t) => !have.has(t.toLowerCase())).slice(0, 3)) softGaps.push(`Нет ${t} в профиле`);

  const yearsFit = job.minYears <= c.yearsExperience ? 1 : job.minYears - c.yearsExperience <= 1 ? 0.7 : 0.3;
  if (job.minYears) reasons.push({ label: `${job.minYears}+ years`, ok: yearsFit === 1 });
  if (yearsFit < 1) softGaps.push(`Требуется ${job.minYears}+ лет, у вас ${c.yearsExperience}`);

  const senGap = seniorityIndex(job.seniority) - seniorityIndex(seniorityFromYears(c.yearsExperience));
  const senFit = senGap <= 0 ? (senGap < -1 ? 0.7 : 1) : senGap === 1 ? 0.6 : 0.15;

  let salaryFit = 1;
  if (c.goal.minSalary && job.salaryMax) {
    salaryFit = job.salaryMax >= c.goal.minSalary ? 1 : job.salaryMax >= c.goal.minSalary * 0.85 ? 0.6 : 0.2;
    reasons.push({ label: `Salary ≥ $${Math.round(c.goal.minSalary / 1000)}k`, ok: salaryFit === 1 });
    if (salaryFit < 1) softGaps.push("Вилка ниже вашего минимума");
  }
  const industryFit = !c.goal.industries.length || !job.industry ? 0.8 : c.goal.industries.some((i) => job.industry.toLowerCase().includes(i.toLowerCase())) ? 1 : 0.6;

  const match = Math.round(100 * (0.32 * roleFit + 0.33 * skillFit + 0.13 * yearsFit + 0.1 * senFit + 0.07 * salaryFit + 0.05 * industryFit));

  // ——— Eligibility: hard blockers ———
  const targets = targetCountries(c.goal.countries);
  const auth = new Set(c.workAuth);
  const anywhere = targets.has("*");
  const jobInTarget = job.countries.length === 0 || anywhere || job.countries.some((x) => targets.has(x) || x === "*");
  if (!jobInTarget) blockers.push(`Страна вне цели: ${job.countries.join(", ")}`);

  const needsPresence = job.remote !== "remote";
  const authorizedForJob = job.countries.some((x) => auth.has(x)) || job.countries.includes("*");
  if (needsPresence && !authorizedForJob) {
    if (job.sponsorship === "no") blockers.push("Onsite/hybrid, спонсорство визы недоступно");
    else if (!c.relocation) blockers.push("Требуется переезд, relocation выключен");
    else softGaps.push("Нужна виза — спонсорство не указано");
  }
  if (job.workAuth.length && !job.workAuth.some((x) => auth.has(x))) {
    if (job.sponsorship === "no" || !c.needsSponsorship) blockers.push(`Нужно право на работу: ${job.workAuth.join(", ")}`);
    else if (job.sponsorship === "yes") softGaps.push("Потребуется спонсорство (компания спонсирует)");
    else blockers.push(`${job.workAuth.join(", ")} authorization required`);
  }
  if (!c.goal.workModes.includes(job.remote) && !c.goal.workModes.includes("any")) {
    if (job.remote === "onsite") blockers.push("Только onsite — не входит в ваши форматы");
    else softGaps.push(`Формат ${job.remote} вне предпочтений`);
  }
  const en = EN[c.englishLevel] ?? 3;
  const jobLangs = job.languages.map(normalizeLanguage);
  if (jobLangs.includes("English") && en < 3) blockers.push("Требуется английский B1+");
  const spoken = new Set(c.languages.map(normalizeLanguage)); // "Русский" ≡ "Russian"
  for (const l of jobLangs.filter((l) => l !== "English")) if (!spoken.has(l)) blockers.push(`Требуется язык: ${l}`);
  if (ADVANCED_DEGREE.test(job.education) && (c.educationLevel === "none" || c.educationLevel === "bachelor")) blockers.push(`Обязательное образование: ${job.education}`);
  if (senGap >= 2) blockers.push(`Уровень ${job.seniority} недостижим с текущим опытом`);
  if (c.goal.blockedCompanies.some((b) => b && job.company.toLowerCase().includes(b.toLowerCase()))) blockers.push("Компания в вашем стоп-листе");

  const eligibility = blockers.length ? "blocked" : softGaps.length > 2 ? "soft" : "eligible";

  // ——— Ranking: P(Interview | candidate, job, company, timing) ———
  const freshnessDays = Math.max(0, (now.getTime() - job.postedAt.getTime()) / 86400000);
  const fresh = freshnessDays < 1 ? 1.25 : freshnessDays < 3 ? 1.12 : freshnessDays < 7 ? 1 : freshnessDays < 14 ? 0.82 : freshnessDays < 30 ? 0.6 : 0.35;
  const dream = c.goal.dreamCompanies.some((d) => d && job.company.toLowerCase().includes(d.toLowerCase()));
  const competition = job.remote === "remote" && !job.massHiring ? 0.8 : 1; // global remote roles attract more applicants
  const massBoost = job.massHiring ? 1.35 : 1;
  const segmentWeight = c.allocation[job.roleFamily] ?? 1;
  const base = Math.pow(match / 100, 2.2) * 0.32; // baseline response for a perfect match ≈ 32%
  const pInterview = eligibility === "blocked" ? 0 : Math.min(0.6, base * fresh * competition * massBoost * segmentWeight * (eligibility === "soft" ? 0.7 : 1));
  const lane: MatchResult["lane"] = dream ? "target" : job.massHiring ? "mass" : "standard";
  const modeBias = c.goal.mode === "target" ? (dream ? 3 : 0.2) : c.goal.mode === "mass" ? (job.massHiring ? 1.6 : 0.8) : dream ? 1.3 : 1;
  const priority = Math.round(pInterview * modeBias * 1000) / 1000;

  return { match, reasons, eligibility, blockers, softGaps, pInterview: Math.round(pInterview * 1000) / 1000, priority, lane, segment: job.roleFamily, freshnessDays: Math.round(freshnessDays * 10) / 10 };
}
