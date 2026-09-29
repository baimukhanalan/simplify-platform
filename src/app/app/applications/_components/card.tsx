import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Chip, cx } from "@/components/ui";
import { statusTone } from "@/lib/ops";
import type { T } from "@/lib/i18n/translator";
import { shortDateT, statusT } from "../../opportunities/_lib/labels";

export type AppCardData = {
  id: string;
  status: string;
  submittedAt: Date | null;
  job: { company: string; title: string; source: string };
  pkg: { cvVersion: string } | null;
};

/**
 * One application. The whole card links to its page — status changes live there, not on the list,
 * so a stray tap on a phone cannot move an application.
 */
export function ApplicationCard({ t, a, showStatus, compact }: { t: T; a: AppCardData; showStatus?: boolean; compact?: boolean }) {
  return (
    <Link
      href={`/app/applications/${a.id}`}
      className={cx(
        "group flex h-full flex-col gap-2 rounded-2xl border border-stroke bg-white/85 shadow-[0_1px_2px_rgb(0_0_0/.04)] transition-shadow hover:shadow-(--shadow-glass) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
        compact ? "p-3" : "p-4",
      )}
    >
      <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-[12.5px] font-medium text-ink">{a.job.company}</span>
        {showStatus && <Chip tone={statusTone(a.status)} className="shrink-0">{statusT(t, a.status)}</Chip>}
      </span>
      <span className="line-clamp-2 text-[14.5px] leading-snug text-head group-hover:underline">{a.job.title}</span>
      <span className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-ink-3">
        <span>{t.rich("apps.submittedOn", { date: shortDateT(t, a.submittedAt) }, { n: (c) => <span className="num text-ink-2">{c}</span> })}</span>
        <ArrowRight className="size-3.5 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
