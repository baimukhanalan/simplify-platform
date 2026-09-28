import Link from "next/link";
import { Activity, ArrowRightLeft, BadgeDollarSign, FileText, Mail, Mic, Search, Send, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fmtDateTime } from "@/lib/ops";
import { cx } from "@/components/ui";

export type AuditItem = { at: Date; kind: string; title: string; detail?: string; href?: string; tag?: string };

const ICON: Record<string, LucideIcon> = {
  discovery: Search, prepared: FileText, submitted: Send, inbox: Mail, interview_room: Mic, status_change: ArrowRightLeft, approval: ShieldCheck, offer: BadgeDollarSign,
};
const ACCENT: Record<string, string> = { submitted: "bg-cta text-white border-transparent", offer: "bg-green text-white border-transparent", interview_room: "bg-green-soft text-green" };

/** Chronological, oldest first — reads as the story of the application. */
export function AuditTrail({ items }: { items: AuditItem[] }) {
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-px before:bg-line">
      {items.map((it, i) => {
        const Icon = ICON[it.kind] ?? Activity;
        const title = <span className="text-[13.5px] font-medium leading-snug text-head">{it.title}</span>;
        return (
          <li key={`${it.kind}-${i}`} className="relative flex gap-3">
            <span className={cx("relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-stroke bg-white text-teal", ACCENT[it.kind])}>
              <Icon className="size-3.5" strokeWidth={1.7} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              <time dateTime={it.at.toISOString()} className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-4">{fmtDateTime(it.at)}</time>
              {it.href ? <Link href={it.href} className="hover:underline">{title}</Link> : title}
              {it.detail && <span className="break-words text-[12.5px] leading-snug text-ink-3">{it.detail}</span>}
              {it.tag && <span className="mt-0.5 w-fit rounded-full bg-amber-soft px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[.06em] text-amber">{it.tag}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
