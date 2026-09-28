// Career Mode read side: the live Career Score and its history. One loader for the Career screen, the
// "Зафиксировать" action (recordSnapshot) and the demo seed, so the header, the history and the stored rows agree.
import "server-only";
import { db, j } from "./db";
import { careerScore } from "./engine/career";
import { classifyRole } from "./engine/taxonomy";
import { startOfToday } from "./time";

/** Inputs + live Career Score for a user. Every query is scoped to `userId`. */
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
  const mockScores = mocks
    .map((m) => j<{ overall?: unknown }>(m.feedback, {}).overall)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const mockAvg = mockScores.length ? Math.round(mockScores.reduce((a, b) => a + b, 0) / mockScores.length) : null;
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
    mockScores,
    currentSalary,
    demandJobs,
    regions,
  });
  return { user, role, family, demandJobs, mockAvg, mockCount: mockScores.length, currentSalary, salarySource, accepted, ...result };
}
export type CareerData = Awaited<ReturnType<typeof loadCareer>>;

export type CareerPoint = { at: Date; score: number; marketValue: number; live: boolean };

/**
 * Career Score history for the chart/table, oldest first. Today's row (Almaty calendar day) is always the live
 * computation — the same numbers as the Career header: a snapshot taken earlier today is replaced by the live value,
 * and when there is none today a live row is appended. Earlier rows are the stored snapshots as recorded.
 */
export async function careerHistory(userId: string, live: { score: number; marketValue: number }, take = 36): Promise<CareerPoint[]> {
  const today = startOfToday();
  const rows = await db.careerSnapshot.findMany({ where: { userId, createdAt: { lt: today } }, orderBy: { createdAt: "desc" }, take: take - 1, select: { createdAt: true, score: true, marketValue: true } });
  const past = rows.reverse().map((r) => ({ at: r.createdAt, score: r.score, marketValue: r.marketValue, live: false }));
  return [...past, { at: new Date(), score: live.score, marketValue: live.marketValue, live: true }];
}
