// Goal option labels in the page language (pure: pass the `t` from getT() or useT()). Stored values stay as they are.
import { regionName } from "@/lib/i18n/labels";
import type { T } from "@/lib/i18n/translator";
import type { goalPageRu } from "@/lib/i18n/dictionaries/ru/goal-page";

/** In the goal the WORLD region sits next to the «Удалённо» work format — name it distinctly here. */
export const goalRegion = (t: T, k: string) => (k.toUpperCase() === "WORLD" ? t("goalPage.options.world") : regionName(t, k));

const WORK_MODES = ["remote", "hybrid", "onsite", "any"] as const;
export const workModeLabel = (t: T, k: string) =>
  (WORK_MODES as readonly string[]).includes(k) ? t(`goalPage.options.workMode.${k as (typeof WORK_MODES)[number]}`) : k;

const SIZES = ["any", "startup", "scaleup", "corporate"] as const;
export const sizeLabel = (t: T, k: string) => ((SIZES as readonly string[]).includes(k) ? t(`goalPage.options.size.${k as (typeof SIZES)[number]}`) : k);

const MODES = ["autonomous", "target", "mass"] as const;
export type GoalMode = (typeof MODES)[number];
export const isGoalMode = (k: string): k is GoalMode => (MODES as readonly string[]).includes(k);
/** Short mode name (form cards, summary chip). */
export const modeLabel = (t: T, k: string) => (isGoalMode(k) ? t(`goalPage.options.mode.${k}`) : k);
/** Mode name with its meaning (goal overview line). */
export const modeLongLabel = (t: T, k: string) => (isGoalMode(k) ? t(`goalPage.options.modeLong.${k}`) : k);

type IndustryKey = keyof typeof goalPageRu.options.industry;
/** Stored industry value (lower-cased) → label key; same coverage as INDUSTRY_RU. Unknown values (e.g. «AI / ML») show as written. */
const INDUSTRY: Record<string, IndustryKey> = {
  fintech: "fintech", banking: "banking", telecom: "telecom", consulting: "consulting", govtech: "govtech", government: "govtech",
  logistics: "logistics", media: "media", retail: "retail", gaming: "gaming", games: "gaming", finance: "finance", education: "education",
  healthcare: "healthcare", healthtech: "healthtech", medtech: "healthtech", edtech: "edtech", "e-commerce": "ecommerce", ecommerce: "ecommerce",
  insurtech: "insurtech", cybersecurity: "cybersecurity", security: "cybersecurity", mobility: "mobility", travel: "travel",
  "ai / data": "aiData", ai: "aiData", saas: "saas", software: "software", marketplace: "marketplace", proptech: "proptech",
};
export function industryLabel(t: T, industry: string) {
  const k = INDUSTRY[industry.trim().toLowerCase()];
  return k ? t(`goalPage.options.industry.${k}`) : industry;
}
