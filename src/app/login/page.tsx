import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeNext } from "@/lib/auth";
import { intentFromParams, intentQuery } from "../_components/campaign-intent";
import { cleanPlan } from "../_components/plan-pref";
import { AuthExperience } from "./_components/auth-experience";

export const metadata: Metadata = { title: "Вход", description: "Запусти карьерную кампанию — войди или создай аккаунт Simplify." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // Answers from the first screen travel with the URL; after login they land on the Goal step prefilled.
  const intent = intentFromParams(sp);
  // A plan picked on the landing page rides along to onboarding step 5 (and is remembered in a cookie by AuthExperience).
  const plan = cleanPlan(sp.plan);
  const fallback = intent
    ? `/onboarding?${new URLSearchParams([...intentQuery(intent), ...(plan ? [["plan", plan]] : [])])}`
    : plan
      ? `/onboarding?step=5&plan=${plan}`
      : "/app";
  const next = safeNext(one(sp.next), fallback);
  if (await currentUser()) redirect(next);
  const ref = one(sp.ref).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  const mode = one(sp.mode) === "signup" || ref ? "signup" : "login";
  return <AuthExperience initialMode={mode} refCode={ref} next={next} intent={intent} plan={plan} />;
}
