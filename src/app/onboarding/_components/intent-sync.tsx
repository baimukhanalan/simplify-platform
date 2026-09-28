"use client";
import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyIntent } from "@/lib/actions/onboarding";
import { INTENT_USED_COOKIE, clearStoredIntent, readStoredIntent, type Intent } from "../../_components/campaign-intent";

/**
 * Turns the first-screen answers into the Goal once the user has an account.
 * Sources: the URL (signed-in users, login → next) or sessionStorage (the signup action redirects to a bare /onboarding).
 * Only an empty goal is filled; an existing goal is confirmed on the Goal step instead.
 */
export function IntentSync({ goalEmpty, urlIntent }: { goalEmpty: boolean; urlIntent: Intent | null }) {
  const router = useRouter();
  const ran = useRef(false);
  const [saving, start] = useTransition();

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const intent = urlIntent ?? readStoredIntent();
    if (!intent) return;
    // A goal already exists: nothing to apply, the stored answers are stale.
    if (!goalEmpty) { clearStoredIntent(); return; }
    start(async () => {
      try {
        await applyIntent(intent);
        // Only now is the intent safely in the Goal; on failure it stays in sessionStorage for the next attempt.
        clearStoredIntent();
        // Lets the Goal step say «Заполнил по твоим ответам на первом экране» only when that is what happened.
        document.cookie = `${INTENT_USED_COOKIE}=1; path=/onboarding; max-age=${7 * 86400}; samesite=lax`;
        if (urlIntent) router.replace("/onboarding"); else router.refresh();
      } catch { /* the Goal step still lets the user enter it by hand */ }
    });
  }, [goalEmpty, urlIntent, router]);

  return saving ? (
    <p role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit rounded-full border border-green/20 bg-white/90 px-4 py-2 text-[13px] text-head shadow-(--shadow-glass) animate-fade">
      Сохраняю твою цель…
    </p>
  ) : null;
}
