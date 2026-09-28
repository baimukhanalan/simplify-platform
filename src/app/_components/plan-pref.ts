// The plan picked on the landing page (?plan=local|international), remembered across /login → onboarding
// in a short-lived first-party cookie so step 5 and /app/campaign can preselect it. Pure: safe on server and client.

export type PlanKey = "local" | "international";
export const PLAN_COOKIE = "simplify_plan";

export function cleanPlan(v: unknown): PlanKey | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "local" || s === "international" ? s : null;
}

/** Regions the Local / CIS plan covers; any goal region outside them needs International. */
const LOCAL_REGIONS = new Set(["KZ", "CIS"]);

/**
 * The plan that fits a goal: Local when every target region is KZ/CIS, International otherwise.
 * Null when there is no goal yet (nothing to recommend). Never changes the display order — Local is always first.
 */
export function fitPlan(countries: readonly string[] | null | undefined): PlanKey | null {
  if (!countries?.length) return null;
  return countries.every((c) => LOCAL_REGIONS.has(c.toUpperCase())) ? "local" : "international";
}

/** Tier order everywhere (landing, onboarding, campaign): Local first, then International. */
export const PLAN_ORDER: readonly PlanKey[] = ["local", "international"];
