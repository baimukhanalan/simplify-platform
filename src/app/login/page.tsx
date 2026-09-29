import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser, safeNext } from "@/lib/auth";
import { intentFromParams, intentQuery } from "../_components/campaign-intent";
import { cleanPlan } from "../_components/plan-pref";
import { AuthExperience } from "./_components/auth-experience";
import { REFERRAL_COOKIE } from "@/lib/referral";
import { getDictionary, getT } from "@/lib/i18n/server";
import { DICTIONARIES } from "@/lib/i18n/dictionaries";
import { I18nScope } from "@/lib/i18n/scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("meta.login"), description: t("meta.loginDescription") };
}

/** The sign-in/sign-up actions answer in Russian: {Russian text → current language} for the srv* messages. */
async function serverErrorMap() {
  const dict = await getDictionary();
  const out: Record<string, string> = {};
  for (const [k, ru] of Object.entries(DICTIONARIES.ru.auth)) if (k.startsWith("srv")) out[ru] = dict.auth[k as keyof typeof dict.auth];
  return out;
}

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
  const mode = one(sp.mode) === "signup" || ref || ((intent || plan) && one(sp.mode) !== "login") ? "signup" : "login";
  // A friend's invite remembered by /r/<code> prefills the field (it doesn't switch the page to signup by itself).
  const remembered = ref || (await cookies()).get(REFERRAL_COOKIE)?.value?.toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32) || "";
  return (
    <I18nScope ns={["auth", "preview"]}>
      <AuthExperience initialMode={mode} refCode={remembered} next={next} intent={intent} plan={plan} serverErrors={await serverErrorMap()} />
    </I18nScope>
  );
}
