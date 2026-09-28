import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cx } from "@/components/ui";

export type Need = { text: string; href?: string };

/**
 * One line that answers "is anything needed from me?".
 * Empty `needs` → the calm default: nothing needed, the agent is working.
 */
export function AgentStatus({ needs, working, className }: { needs: Need[]; working?: string; className?: string }) {
  if (!needs.length) {
    return (
      <p role="status" className={cx("flex items-start gap-3 rounded-2xl border border-green/15 bg-green-soft/50 px-4 py-3 text-[14px] text-ink-2", className)}>
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-green animate-pulse-dot" aria-hidden />
        <span><span className="font-medium text-head">Сейчас от тебя ничего не нужно.</span> {working ?? "Simplify работает."}</span>
      </p>
    );
  }
  return (
    <div className={cx("flex flex-col gap-2 rounded-2xl border border-amber/20 bg-amber-soft/60 px-4 py-3", className)}>
      <span className="label !text-amber">Нужно от тебя</span>
      <ul className="flex flex-col gap-1.5">
        {needs.map((n) => (
          <li key={n.text} className="text-[14px] text-ink-2">
            {n.href ? (
              <Link href={n.href} className="group inline-flex items-center gap-1.5 rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">
                {n.text}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            ) : n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
