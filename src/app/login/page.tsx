import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeNext } from "@/lib/auth";
import { intentFromParams, intentQuery } from "../_components/campaign-intent";
import { AuthExperience } from "./_components/auth-experience";

export const metadata: Metadata = { title: "Вход", description: "Запусти карьерную кампанию — войди или создай аккаунт Simplify." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  // Answers from the first screen travel with the URL; after login they land on the Goal step prefilled.
  const intent = intentFromParams(sp);
  const next = safeNext(one(sp.next), intent ? `/onboarding?${intentQuery(intent)}` : "/app");
  if (await currentUser()) redirect(next);
  const ref = one(sp.ref).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  const mode = one(sp.mode) === "signup" || ref ? "signup" : "login";
  return <AuthExperience initialMode={mode} refCode={ref} next={next} intent={intent} />;
}
