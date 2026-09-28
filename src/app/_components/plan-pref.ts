// The plan picked on the landing page (?plan=local|international), remembered across /login → onboarding
// in a short-lived first-party cookie so step 5 and /app/campaign can preselect it. Pure: safe on server and client.

import { PLANS } from "@/lib/engine/taxonomy";

export type PlanKey = "local" | "international";

/** What each tier promises — one copy for the landing, onboarding step 5 and anywhere else a plan card is drawn. */
export const PLAN_COPY: Record<PlanKey, { note: string; features: readonly string[] }> = {
  local: { note: "Казахстан и СНГ", features: ["Поиск и заявки по Казахстану и СНГ", `До ${PLANS.local.dailyLimit} заявок в день`, "CV под каждую вакансию", "Подготовка к интервью"] },
  international: { note: "Европа, США, Великобритания, Канада, удалённо по миру", features: ["Всё из Local / CIS", `До ${PLANS.international.dailyLimit} заявок в день`, "Визовые требования учитываются в каждой заявке", "Подготовка к интервью и помощь с оффером"] },
};
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
