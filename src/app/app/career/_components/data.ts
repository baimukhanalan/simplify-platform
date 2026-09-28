import "server-only";
import { db, j } from "@/lib/db";
import { careerScore } from "@/lib/engine/career";
import { classifyRole } from "@/lib/engine/taxonomy";

/** Inputs + Career Score for a user. Every query is scoped to `userId`. */
export async function loadCareer(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    include: { profile: true, goal: true, _count: { select: { stories: true } } },
  });
  const p = user.profile;
  const g = user.goal;
  const role = g?.primaryRole || p?.headline || "";
  const family = classifyRole(role);
  const [demandJobs, mocks, accepted] = await Promise.all([
    db.job.count({ where: { active: true, roleFamily: family } }),
    db.mockSession.findMany({ where: { interview: { userId } }, select: { feedback: true } }),
    db.offer.findFirst({ where: { userId, status: "accepted" }, orderBy: { createdAt: "desc" } }),
  ]);
  const overalls = mocks
    .map((m) => j<{ overall?: unknown }>(m.feedback, {}).overall)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const mockAvg = overalls.length ? Math.round(overalls.reduce((a, b) => a + b, 0) / overalls.length) : null;
  const currentSalary = accepted ? accepted.finalBase ?? accepted.base : p?.salaryExpectation ?? 0;
  const salarySource: "offer" | "profile" | "none" = accepted ? "offer" : currentSalary ? "profile" : "none";
  const regions = j<string[]>(g?.countries, []);
  const result = careerScore({
    role,
    skills: j(p?.skills, []),
    yearsExperience: p?.yearsExperience ?? 0,
    englishLevel: p?.englishLevel ?? "B1",
    workAuth: j(p?.workAuth, []),
    relocation: p?.relocation ?? false,
    stories: user._count.stories,
    mockAvg,
    currentSalary,
    demandJobs,
    regions,
  });
  return { user, role, family, demandJobs, mockAvg, mockCount: overalls.length, currentSalary, salarySource, accepted, ...result };
}
