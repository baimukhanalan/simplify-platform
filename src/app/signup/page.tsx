import { redirect } from "next/navigation";

/** /signup is an alias: same auth experience in signup mode, preserving ?ref, ?next, ?plan and the first-screen answers. */
export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ mode: "signup" });
  for (const k of ["ref", "next", "plan", "role", "where", "salary"]) {
    const v = sp[k];
    const val = Array.isArray(v) ? v[0] : v;
    if (val) q.set(k, val);
  }
  redirect(`/login?${q.toString()}`);
}
