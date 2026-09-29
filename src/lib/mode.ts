// Platform mode (pure; client- and server-safe). One switch for the showcase period:
//
//   SIMPLIFY_MODE=simulation (default when unset) — the fictional-company corpus is live: the agent applies to its roles
//     through the internal ATS adapter and its employers answer on their own (src/lib/engine/simulation.ts). Live-feed
//     vacancies (real companies) are found, matched and prepared exactly as in live mode and always stay a handoff.
//   SIMPLIFY_MODE=live — no automatic employer activity; everything behaves as the plain production engine.
//
// Nothing in the UI names the mode. It only decides what the engine does.

export type SimplifyMode = "simulation" | "live";

export function simplifyMode(): SimplifyMode {
  const m = process.env.SIMPLIFY_MODE?.trim().toLowerCase();
  return m === "live" ? "live" : "simulation";
}

export const isSimulation = () => simplifyMode() === "simulation";

/**
 * Job.source of the internal fictional-company corpus (src/lib/engine/seed-jobs.ts). The stored value stays "demo" for
 * compatibility with existing rows; it is an internal key and is never shown to users (see sourceLabel in src/lib/ops.ts).
 */
export const FICTIONAL_SOURCE = "demo";

/** A vacancy of the fictional corpus. Only these may ever get a simulated submission or simulated employer mail. */
export const isFictionalJob = (job: { source: string } | null | undefined) => job?.source === FICTIONAL_SOURCE;
