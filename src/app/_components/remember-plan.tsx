"use client";
import { useEffect } from "react";
import { PLAN_COOKIE, type PlanKey } from "./plan-pref";

/** Stores the plan chosen on the landing page for a day, so it survives signup/login redirects. Renders nothing. */
export function RememberPlan({ plan }: { plan: PlanKey | null }) {
  useEffect(() => {
    if (!plan) return;
    try {
      document.cookie = `${PLAN_COOKIE}=${plan}; path=/; max-age=86400; samesite=lax`;
    } catch { /* cookies disabled: step 5 simply shows no preselection */ }
  }, [plan]);
  return null;
}
