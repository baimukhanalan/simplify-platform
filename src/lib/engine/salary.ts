// Salary screening answer ("What are your salary expectations?") — pure, safe for client and server.
// Applied by prepare() (src/lib/engine/agent.ts) on top of the package's draft answer, so the Agent screen's
// "Change salary expectation" switch (Autonomy.changeSalary) decides what the agent may say:
//   OFF → always the goal floor range exactly: $floor–$floor×1.15 base, no hedging.
//   ON  → the agent may be flexible ("open to discussing"), and when the job publishes a range whose midpoint
//         is above the floor, it anchors on that midpoint instead of the floor.
import { toUSD } from "./fx";

const k = (usd: number) => `$${Math.round(usd / 1000)}k`;

/** The floor range the goal defines (USD): floor … floor × 1.15. */
export const floorRange = (floorUsd: number) => `${k(floorUsd)}–${k(floorUsd * 1.15)}`;

/** Midpoint of the job's published range in USD, or null when the job publishes nothing. */
export function publishedMidUsd(job: { salaryMin: number | null; salaryMax: number | null; currency?: string | null }) {
  const lo = job.salaryMin ?? job.salaryMax;
  const hi = job.salaryMax ?? job.salaryMin;
  if (!lo || !hi) return null;
  return toUSD(Math.round((lo + hi) / 2), job.currency ?? "USD");
}

/**
 * @param floorUsd  the user's salary floor in USD (Goal.minSalary converted; profile expectation as fallback). 0 = none.
 * @param job       the vacancy's published range (in job.currency).
 * @param mayChange Autonomy.changeSalary.
 */
export function salaryAnswer(floorUsd: number, job: { salaryMin: number | null; salaryMax: number | null; currency?: string | null }, mayChange: boolean): string {
  const floor = Math.max(0, Math.round(floorUsd || 0));
  if (!mayChange) return floor ? `${floorRange(floor)} base` : "Market-rate compensation for this role";
  const mid = publishedMidUsd(job);
  if (mid && mid > floor) return `${k(mid)} base, in line with the published range; flexible and open to discussing the full package`;
  return floor ? `${floorRange(floor)} base; flexible and open to discussing the full package` : "Flexible — open to discussing a market-rate package";
}

export type SalaryTarget = {
  low: number;
  high: number;
  /** floor = the user's own expectation (goal floor range); published = the job's midpoint (only with changeSalary ON);
   *  market = no expectation set, the market estimate is shown as a reference; none = nothing known. */
  source: "floor" | "published" | "market" | "none";
};

/**
 * The number the candidate names out loud — the same rule as the screening answer the agent submitted (salaryAnswer):
 * OFF → floor … floor × 1.15; ON → the published midpoint when it is above the floor. Never a market range lower than the
 * user's own expectation; the market range is only a fallback when no expectation is set.
 */
export function salaryTarget(
  floorUsd: number,
  job: { salaryMin: number | null; salaryMax: number | null; currency?: string | null },
  mayChange: boolean,
  market?: { low: number; high: number } | null,
): SalaryTarget {
  const floor = Math.max(0, Math.round(floorUsd || 0));
  if (mayChange) {
    const mid = publishedMidUsd(job);
    if (mid && mid > floor) return { low: mid, high: mid, source: "published" };
  }
  if (floor) return { low: floor, high: Math.round(floor * 1.15), source: "floor" };
  if (market) return { low: market.low, high: market.high, source: "market" };
  return { low: 0, high: 0, source: "none" };
}

/** The user's salary floor in USD: the goal minimum (converted), else the profile expectation — as the agent uses it. */
export const userFloorUsd = (goal: { minSalary: number; currency: string } | null | undefined, profileExpectationUsd = 0) =>
  goal?.minSalary ? toUSD(goal.minSalary, goal.currency) : profileExpectationUsd || 0;
