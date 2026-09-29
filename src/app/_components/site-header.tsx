import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, cx } from "@/components/ui";

/** Minimal top bar for public/entry surfaces (home, Career Check, onboarding). */
export function SiteHeader({ right, className }: { right?: ReactNode; className?: string }) {
  return (
    <header className={cx("mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-4 py-5 sm:px-8", className)}>
      <Link href="/" className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label="Simplify — на главную">
        <Logo />
      </Link>
      {right && <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">{right}</div>}
    </header>
  );
}
