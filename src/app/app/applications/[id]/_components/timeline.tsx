import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Activity, ArrowRightLeft, BadgeDollarSign, CalendarClock, CheckCheck, ClipboardList, FileText, Hourglass, Mail, Mic, Send, ShieldCheck, XCircle } from "lucide-react";
import { fmtDateTime } from "@/lib/ops";
import { cx } from "@/components/ui";

export type Step = { at: Date | null; kind: string; title: string; detail?: string; href?: string; tag?: string; upcoming?: boolean };

const ICON: Record<string, LucideIcon> = {
  prepared: FileText, submitted: Send, confirmation: CheckCheck, assessment: ClipboardList, interview: Mic, interview_room: CalendarClock,
  offer: BadgeDollarSign, rejection: XCircle, inbox: Mail, status_change: ArrowRightLeft, approval: ShieldCheck, next: Hourglass,
};
const ACCENT: Record<string, string> = {
  submitted: "bg-cta text-white border-transparent",
  offer: "bg-green text-white border-transparent",
  interview: "border-stroke bg-[#e3f0e9] text-green",
  interview_room: "border-stroke bg-[#e3f0e9] text-green",
  rejection: "border-stroke bg-[#f6e7e7] text-rose",
};

/** The story of one application, oldest first; an optional last "upcoming" step shows what the agent is waiting for. */
export function Timeline({ steps }: { steps: Step[] }) {
  return (
    <ol className="relative flex flex-col gap-4 before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-px before:bg-line">
      {steps.map((s, i) => {
        const Icon = ICON[s.kind] ?? Activity;
        const title = <span className={cx("text-[13.5px] font-medium leading-snug", s.upcoming ? "text-ink-3" : "text-head")}>{s.title}</span>;
        return (
          <li key={`${s.kind}-${i}`} className="relative flex gap-3">
            <span className={cx("relative z-10 grid size-7 shrink-0 place-items-center rounded-full border", s.upcoming ? "border-dashed border-line bg-white text-ink-4" : ACCENT[s.kind] ?? "border-stroke bg-white text-teal")}>
              <Icon className="size-3.5" strokeWidth={1.7} aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
              {s.at ? (
                <time dateTime={s.at.toISOString()} className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-4">{fmtDateTime(s.at)}</time>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[.06em] text-ink-4">{s.upcoming ? "дальше" : "—"}</span>
              )}
              {s.href ? <Link href={s.href} className="w-fit rounded hover:underline focus-visible:outline-2 focus-visible:outline-green">{title}</Link> : title}
              {s.detail && <span className="break-words text-[12.5px] leading-snug text-ink-3">{s.detail}</span>}
              {s.tag && <span className="mt-0.5 w-fit rounded-full bg-amber-soft px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[.06em] text-amber">{s.tag}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
