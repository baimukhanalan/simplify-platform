import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser, safeNext } from "@/lib/auth";
import { AuthExperience } from "./_components/auth-experience";

export const metadata: Metadata = { title: "Вход", description: "Start your campaign — войдите или создайте аккаунт Simplify." };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(Array.isArray(sp.next) ? sp.next[0] : sp.next);
  if (await currentUser()) redirect(next);
  const ref = one(sp.ref).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 32);
  const mode = one(sp.mode) === "signup" || ref ? "signup" : "login";
  return <AuthExperience initialMode={mode} refCode={ref} next={next} />;
}
