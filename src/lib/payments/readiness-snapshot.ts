import "server-only";
import { db, j } from "../db";
import { assessReadiness, type ReadinessInput } from "../engine/readiness";
import { toUSD } from "../engine/fx";

/**
 * Everything assessReadiness needs for a user (goal minimum in USD, mock scores for the shared interview readiness).
 * The Readiness page and the campaign's "Readiness на старте" read the same input, so they show the same score.
 */
export async function readinessInputFor(userId: string): Promise<ReadinessInput | null> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, goal: true, facts: true, _count: { select: { stories: true } } } });
  const p = u.profile, g = u.goal;
  if (!p || !g) return null;
  const mocks = await db.mockSession.findMany({ where: { interview: { userId } }, select: { feedback: true } });
  const mockScores = mocks.map((m) => j<{ overall?: unknown }>(m.feedback, {}).overall).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    profile: { yearsExperience: p.yearsExperience, skills: j(p.skills, []), englishLevel: p.englishLevel, cvText: p.cvText, summary: p.summary, workAuth: j(p.workAuth, []), needsSponsorship: p.needsSponsorship, linkedin: p.linkedin, github: p.github, portfolio: p.portfolio },
    facts: u.facts, stories: u._count.stories, mockScores,
    goal: { primaryRole: g.primaryRole, seniority: g.seniority, minSalary: toUSD(g.minSalary, g.currency), countries: j(g.countries, []), workModes: j(g.workModes, []), dreamCompanies: j(g.dreamCompanies, []), sponsorshipNeeded: g.sponsorshipNeeded },
  };
}

export async function assessReadinessFor(userId: string) {
  const input = await readinessInputFor(userId);
  return input ? assessReadiness(input).score : 0;
}
