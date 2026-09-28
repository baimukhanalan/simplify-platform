import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cx } from "@/components/ui";

export type Need = { text: string; href?: string };

/**
 * One line that answers "is anything needed from me?" — the same on every main screen.
 * Empty `needs` → the calm default in the owner's words; `idle` (campaign paused or not running) drops
 * "Simplify is working." so the line never claims work that isn't happening. `working` adds screen context.
 */
export function AgentStatus({ needs, working, idle = false, className }: { needs: Need[]; working?: string; idle?: boolean; className?: string }) {
  if (!needs.length) {
    return (
      <p role="status" className={cx("flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px] text-ink-2", idle ? "border-line bg-white/55" : "border-green/15 bg-green-soft/50", className)}>
        <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", idle ? "bg-ink-4" : "bg-green animate-pulse-dot")} aria-hidden />
        <span>
          <span className="font-medium text-head">{idle ? "Nothing needed from you right now." : "Nothing needed from you right now. Simplify is working."}</span>
          {working && <span className="text-ink-3"> {working}</span>}
        </span>
      </p>
    );
  }
  return (
    <div className={cx("flex flex-col gap-2 rounded-2xl border border-amber/20 bg-amber-soft/60 px-4 py-3", className)}>
      <span className="label !text-amber">Нужно от тебя</span>
      <ul className="flex flex-col gap-1">
        {needs.map((n) => (
          <li key={n.text} className="text-[14px] text-ink-2">
            {n.href ? (
              <Link href={n.href} className="group inline-flex min-h-10 items-center gap-1.5 rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green sm:min-h-8">
                {n.text}<ArrowRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
