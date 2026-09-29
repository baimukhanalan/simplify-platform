// Platform mode (pure; client- and server-safe). One switch for the showcase period:
//
//   SIMPLIFY_MODE=simulation (only when set explicitly) — the fictional-company corpus is live: the agent applies to its roles
//     through the internal ATS adapter and its employers answer on their own (src/lib/engine/simulation.ts). The user does
//     nothing operational: the agent applies to every qualified role within the daily limit, standing answers are given
//     automatically (no approvals, no handoffs), assessments and interview rounds progress on their own. Only the human
//     moments stay: interview prep, debrief (optional), the offer decision. Live-feed vacancies (real companies) keep being
//     ingested for later but never reach discovery, queues, counts or lists (visibleOpportunities / visibleJobsWhere).
//   SIMPLIFY_MODE=live, unset or anything else — no automatic employer activity; everything behaves as the plain
//     production engine. Unknown values fall back to live so a typo can never turn the simulation on.
//
// Nothing in the UI names the mode. It only decides what the engine does.

export type SimplifyMode = "simulation" | "live";

export function simplifyMode(): SimplifyMode {
  const m = process.env.SIMPLIFY_MODE?.trim().toLowerCase();
  return m === "simulation" ? "simulation" : "live";
}

export const isSimulation = () => simplifyMode() === "simulation";

/**
 * Job.source of the internal fictional-company corpus (src/lib/engine/seed-jobs.ts). The stored value stays "demo" for
 * compatibility with existing rows; it is an internal key and is never shown to users (see sourceLabel in src/lib/ops.ts).
 */
export const FICTIONAL_SOURCE = "demo";

/** A vacancy of the fictional corpus. Only these may ever get a simulated submission or simulated employer mail. */
export const isFictionalJob = (job: { source: string } | null | undefined) => job?.source === FICTIONAL_SOURCE;

/**
 * Simulation mode: every user-facing list and count of vacancies covers the fictional corpus only. Live-feed vacancies
 * (real companies) keep being ingested for later, but no screen, count or agent queue reaches them. Live mode: no filter.
 * Wraps an Opportunity `where` (AND keeps any `job` filter of the caller intact).
 */
export function visibleOpportunities<W extends object>(where: W): W {
  return isSimulation() ? ({ AND: [where, { job: { source: FICTIONAL_SOURCE } }] } as unknown as W) : where;
}

/** The same scope for a Job `where` (discovery, Career's better-paying roles, the Career Check sample vacancy). */
export const visibleJobsWhere = (): { source?: string } => (isSimulation() ? { source: FICTIONAL_SOURCE } : {});
