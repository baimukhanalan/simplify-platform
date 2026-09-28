import "server-only";
import { db, j } from "@/lib/db";
import { assessReadiness } from "@/lib/engine/readiness";
import { toUSD } from "@/lib/engine/fx";
import { marketRange } from "@/lib/engine/market";
import { classifyRole, seniorityFromYears } from "@/lib/engine/taxonomy";

/** Readiness for the signed-in user's goal. Returns null when there is no goal/profile yet. */
export async function loadReadiness(userId: string) {
  const u = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true, goal: true, facts: { select: { kind: true, metrics: true, verified: true } }, _count: { select: { stories: true } } },
  });
  const p = u.profile;
  const g = u.goal;
  if (!p || !g?.primaryRole) return null;
  const goal = {
    primaryRole: g.primaryRole, seniority: g.seniority, minSalary: g.minSalary, countries: j<string[]>(g.countries, []),
    workModes: j<string[]>(g.workModes, []), dreamCompanies: j<string[]>(g.dreamCompanies, []), sponsorshipNeeded: g.sponsorshipNeeded,
  };
  const readiness = assessReadiness({
    profile: { yearsExperience: p.yearsExperience, skills: j(p.skills, []), englishLevel: p.englishLevel, cvText: p.cvText, summary: p.summary, workAuth: j(p.workAuth, []), needsSponsorship: p.needsSponsorship, linkedin: p.linkedin, github: p.github, portfolio: p.portfolio },
    facts: u.facts,
    stories: u._count.stories,
    goal: { ...goal, minSalary: toUSD(goal.minSalary, g.currency) }, // the readiness model is in USD
  });
  const family = classifyRole(g.primaryRole);
  const range = marketRange(family, g.seniority, goal.countries);
  return {
    readiness, range, family, goal: { ...goal, currency: g.currency, extraRoles: j<string[]>(g.extraRoles, []) },
    actualSeniority: seniorityFromYears(p.yearsExperience), yearsExperience: p.yearsExperience,
  };
}
