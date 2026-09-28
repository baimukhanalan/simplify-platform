// Career Mode read side: the live Career Score and its history. One loader for the Career screen, the
// "Зафиксировать" action (recordSnapshot) and the demo seed, so the header, the history and the stored rows agree.
import "server-only";
import { db, j } from "./db";
import { careerScore } from "./engine/career";
import { REGIONS, classifyRole } from "./engine/taxonomy";
import { toUSD } from "./engine/fx";
import { userFloorUsd } from "./engine/salary";
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
  // Current compensation is a real number only after HIRED (the accepted offer, final base when negotiated). Before that
  // it is the user's expectation — profile expectation, else the goal floor — and must be labelled as such.
  const expectation = userFloorUsd(null, p?.salaryExpectation ?? 0) || userFloorUsd(g);
  const currentSalary = accepted ? toUSD(accepted.finalBase ?? accepted.base, accepted.currency) : expectation;
  const salarySource: "offer" | "profile" | "goal" | "none" = accepted ? "offer" : p?.salaryExpectation ? "profile" : currentSalary ? "goal" : "none";
  const compensationKind: "actual" | "expectation" | "none" = accepted ? "actual" : currentSalary ? "expectation" : "none";
  const compensationLabel = compensationKind === "actual" ? "по принятому офферу" : salarySource === "profile" ? "ожидание из профиля, не текущая зарплата" : salarySource === "goal" ? "минимум из цели, не текущая зарплата" : "";
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
  // "Underpaid" compares a real salary with the market; an expectation below market is not underpayment.
  return { user, role, family, regions, demandJobs, mockAvg, mockCount: mockScores.length, currentSalary, salarySource, compensationKind, compensationLabel, accepted, ...result, underpaid: compensationKind === "actual" && result.underpaid };
}

/** A job is in the goal's regions: one of its countries is targeted, it is open worldwide, or it is remote and the goal includes WORLD. */
export function jobInRegions(job: { countries: string; remote: string }, regions: string[]) {
  const targets = new Set(regions.flatMap((r) => REGIONS[r]?.countries ?? [r]));
  const countries = j<string[]>(job.countries, []);
  if (targets.has("*") && job.remote === "remote") return true;
  return countries.some((c) => c === "*" || targets.has(c));
}

/**
 * Salary Intelligence: active roles of the user's family, in the goal regions only, whose midpoint pays 25%+ above the
 * current compensation (or the expectation, see compensationKind). `count` is the full number, `list` the top `take`.
 */
export async function betterPayingRoles(c: Pick<CareerData, "family" | "currentSalary" | "regions">, take = 6) {
  const threshold = Math.round(c.currentSalary * 1.25);
  if (!c.currentSalary) return { threshold, count: 0, list: [] };
  const rows = await db.job.findMany({
    where: { active: true, roleFamily: c.family, currency: "USD", salaryMax: { gte: threshold } },
    orderBy: { salaryMax: "desc" },
    take: 500,
    select: { id: true, title: true, company: true, location: true, remote: true, countries: true, salaryMin: true, salaryMax: true, url: true },
  });
  const regions = c.regions.length ? c.regions : ["WORLD"];
  const mid = (x: { salaryMin: number | null; salaryMax: number | null }) => (x.salaryMin && x.salaryMax ? (x.salaryMin + x.salaryMax) / 2 : x.salaryMax ?? x.salaryMin ?? 0);
  const qualifying = rows
    .filter((x) => jobInRegions(x, regions))
    .map((x) => ({ ...x, mid: mid(x) }))
    .filter((x) => x.mid >= threshold)
    .sort((a, b) => b.mid - a.mid);
  return { threshold, count: qualifying.length, list: qualifying.slice(0, take) };
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
