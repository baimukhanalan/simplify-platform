import "server-only";
import { db, j } from "../db";
import { assessReadiness } from "../engine/readiness";
import { toUSD } from "../engine/fx";

export async function assessReadinessFor(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, goal: true, facts: true, _count: { select: { stories: true } } } });
  const p = u.profile, g = u.goal;
  if (!p || !g) return 0;
  return assessReadiness({
    profile: { yearsExperience: p.yearsExperience, skills: j(p.skills, []), englishLevel: p.englishLevel, cvText: p.cvText, summary: p.summary, workAuth: j(p.workAuth, []), needsSponsorship: p.needsSponsorship, linkedin: p.linkedin, github: p.github, portfolio: p.portfolio },
    facts: u.facts, stories: u._count.stories,
    goal: { primaryRole: g.primaryRole, seniority: g.seniority, minSalary: toUSD(g.minSalary, g.currency), countries: j(g.countries, []), workModes: j(g.workModes, []), dreamCompanies: j(g.dreamCompanies, []), sponsorshipNeeded: g.sponsorshipNeeded },
  }).score;
}
