import Link from "next/link";
import { ArrowRight, Gift } from "lucide-react";
import { cx } from "@/components/ui";
import { REFERRAL_DISCOUNT_PCT, REFERRAL_REWARD_DAYS } from "@/lib/referral";

/** Slim «Пригласи друга» entry point: light (Campaign page) or dark (HIRED screen). */
export function ReferralCta({ tone = "light", className }: { tone?: "light" | "dark"; className?: string }) {
  const dark = tone === "dark";
  return (
    <Link
      href="/app/referral"
      className={cx(
        "group flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-3",
        dark ? "border border-white/12 bg-white/[.05] text-white hover:bg-white/10 focus-visible:outline-[#7fe3b6]" : "glass hover:bg-white focus-visible:outline-green",
        className,
      )}
    >
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", dark ? "bg-[#7fe3b6]/15 text-[#7fe3b6]" : "bg-green-soft text-green")}>
        <Gift className="size-4" strokeWidth={1.8} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx("text-[14px] font-medium", dark ? "text-white" : "text-head")}>Пригласи друга</span>
        <span className={cx("text-[12.5px]", dark ? "text-white/55" : "text-ink-3")}>
          Другу — −{REFERRAL_DISCOUNT_PCT}% на первую кампанию, тебе — +{REFERRAL_REWARD_DAYS} дней к своей.
        </span>
      </span>
      <ArrowRight className={cx("size-4 shrink-0 transition-transform group-hover:translate-x-0.5", dark ? "text-[#8fc7ad]" : "text-teal")} strokeWidth={1.8} aria-hidden />
    </Link>
  );
}
