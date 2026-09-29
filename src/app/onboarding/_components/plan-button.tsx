"use client";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/** Submit button that shows pending only for the plan that was actually chosen. */
export function PlanButton({ plan, featured, children }: { plan: string; featured?: boolean; children: React.ReactNode }) {
  const { pending, data } = useFormStatus();
  const t = useT();
  const mine = pending && data?.get("plan") === plan;
  return (
    <button
      type="submit" name="plan" value={plan} disabled={pending}
      className={cx(
        "mt-auto inline-flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium transition-all active:scale-[.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green",
        featured ? "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]" : "glass !rounded-full text-head hover:bg-white",
      )}
    >
      {mine && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {mine ? t("onboarding.launching") : children}
    </button>
  );
}
