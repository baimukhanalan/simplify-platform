// Localized names for shared domain values (regions, levels, plans). Pure: pass the `t` from getT() or useT().
import type { T } from "./translator";

const REGION_KEYS = ["KZ", "CIS", "EU", "UK", "US", "CA", "MENA", "WORLD"] as const;
type RegionKey = (typeof REGION_KEYS)[number];
const isRegion = (k: string): k is RegionKey => (REGION_KEYS as readonly string[]).includes(k);

/** «Европа» · «Еуропа» · «Europe»; REMOTE is an alias of WORLD; unknown keys are shown as written. */
export function regionName(t: T, key: string) {
  const k = key.toUpperCase() === "REMOTE" ? "WORLD" : key.toUpperCase();
  return isRegion(k) ? t(`regions.${k}`) : key;
}
export const regionNames = (t: T, keys: string[]) => [...new Set(keys.map((k) => regionName(t, k)))].join(", ");

const NAMED_FOREIGN = new Set(["EU", "UK", "US", "CA", "MENA"]);

/** The goal's market line, same rules as goalMarket() (src/lib/engine/taxonomy.ts), in the current language. */
export function marketLine(t: T, countries: string[]) {
  const name = (c: string) => (c === "MENA" ? t("regions.marketMENA") : c === "WORLD" ? t("regions.marketWORLD") : regionName(t, c));
  const international = countries.some((c) => NAMED_FOREIGN.has(c) || c === "WORLD");
  const list = countries.map(name).join(", ");
  if (!international) return countries.includes("KZ") && countries.includes("CIS") ? t("regions.kzAndCis") : list || t("regions.kzAndCis");
  const label = t("regions.international");
  return list ? `${label} · ${list}` : label;
}

const LEVELS = ["intern", "junior", "middle", "senior", "lead"] as const;
export function seniorityName(t: T, key: string) {
  return (LEVELS as readonly string[]).includes(key) ? t(`seniority.${key as (typeof LEVELS)[number]}`) : key;
}

/** Plan card copy (src/app/_components/plan-pref.ts PLAN_COPY), localized. */
export function planCopy(t: T, plan: "local" | "international", dailyLimit: number) {
  return plan === "local"
    ? { note: t("plans.localNote"), features: [t("plans.localF1"), t("plans.localF2", { n: dailyLimit }), t("plans.localF3"), t("plans.localF4")] }
    : { note: t("plans.intlNote"), features: [t("plans.intlF1"), t("plans.intlF2", { n: dailyLimit }), t("plans.intlF3"), t("plans.intlF4")] };
}

/** Dictionary prefix per onboarding step key (src/lib/onboarding.ts ONBOARDING_STEPS): t(`onboarding.${STEP_KEY[k]}Label`). */
export const STEP_KEY = { sources: "stepSources", chat: "stepChat", goal: "stepGoal", readiness: "stepReadiness", plan: "stepPlan" } as const;
