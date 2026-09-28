// The plan picked on the landing page (?plan=local|international), remembered across /login → onboarding
// in a short-lived first-party cookie so step 5 and /app/campaign can preselect it. Pure: safe on server and client.

export type PlanKey = "local" | "international";
export const PLAN_COOKIE = "simplify_plan";

export function cleanPlan(v: unknown): PlanKey | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "local" || s === "international" ? s : null;
}
