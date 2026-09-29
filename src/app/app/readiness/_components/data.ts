import "server-only";
import { db, j } from "@/lib/db";
import { assessReadiness } from "@/lib/engine/readiness";
import { ROLE_FAMILIES, seniorityFromYears } from "@/lib/engine/taxonomy";
import { readinessInputFor } from "@/lib/payments/readiness-snapshot";
import { toUSD } from "@/lib/engine/fx";
import type { ReadinessData } from "./model";

/** Readiness for the signed-in user's goal. Returns null when there is no goal/profile yet. */
export async function loadReadiness(userId: string): Promise<ReadinessData | null> {
  // Same input as Career Score and the campaign snapshot (goal minimum in USD, mock scores included).
  const input = await readinessInputFor(userId);
  if (!input?.goal.primaryRole) return null;
  const g = await db.goal.findUniqueOrThrow({ where: { userId }, select: { minSalary: true, currency: true, extraRoles: true } });
  const readiness = assessReadiness(input);
  const { profile: p, goal } = input;
  // The engine's own family and market (in the goal currency, per month for ₸) — never a second classifyRole / USD range.
  const family = readiness.family;
  const range = readiness.market;
  const [jobsForRole, offers] = await Promise.all([
    family === "other" ? 0 : db.job.count({ where: { active: true, roleFamily: family } }),
    db.offer.findMany({ where: { userId, status: { in: ["received", "negotiating", "accepted"] } }, select: { base: true, finalBase: true, currency: true } }),
  ]);
  // The goal minimum (USD here) is met by a real offer: the market says «high», the user's own offer says otherwise.
  const offerMeetsMinimum = goal.minSalary > 0 && offers.some((o) => toUSD(o.finalBase ?? o.base, o.currency) >= goal.minSalary);
  const have = new Set(p.skills.map((x) => x.toLowerCase()));
  return {
    readiness, range, family, offerMeetsMinimum,
    // Shown to the user in their own currency; the model above works in USD.
    goal: { ...goal, minSalary: g.minSalary, currency: g.currency, extraRoles: j<string[]>(g.extraRoles, []) },
    actualSeniority: seniorityFromYears(p.yearsExperience), yearsExperience: p.yearsExperience,
    englishLevel: p.englishLevel, hasLinkedin: Boolean(p.linkedin), needsSponsorship: p.needsSponsorship,
    withMetrics: input.facts.filter((f) => (f.kind === "employment" || f.kind === "project" || f.kind === "achievement") && f.metrics).length,
    stories: readiness.interview.stories, mocks: readiness.interview.mocks, jobsForRole,
    skills: p.skills,
    missingSkills: (ROLE_FAMILIES[family]?.skills ?? []).filter((x) => !have.has(x.toLowerCase())).slice(0, 3),
  };
}
