import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@/components/ui";

/** Native <details> disclosure styled as a pill trigger — keyboard accessible with zero JS. */
export function Disclosure({ summary, children, className, open, tone = "glass" }: { summary: ReactNode; children: ReactNode; className?: string; open?: boolean; tone?: "glass" | "ghost" | "dark" }) {
  return (
    <details className={cx("group/d open:w-full", className)} open={open}>
      <summary
        className={cx(
          "inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-head transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden",
          tone === "glass" && "glass !rounded-full hover:bg-white",
          tone === "ghost" && "hover:bg-white/60",
          tone === "dark" && "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]",
        )}
      >
        {summary}
        <ChevronDown className="size-3.5 transition-transform group-open/d:rotate-180" strokeWidth={1.7} aria-hidden />
      </summary>
      <div className="mt-3 animate-fade">{children}</div>
    </details>
  );
}

export function SectionTitle({ id, eyebrow, title, sub, right }: { id?: string; eyebrow: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div id={id} className="mb-4 flex scroll-mt-24 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1.5">
        <div className="label">{eyebrow}</div>
        <h2 className="h-serif text-[clamp(22px,2.4vw,30px)]">{title}</h2>
        {sub && <p className="max-w-2xl text-[14px] text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Check({ name, label, defaultChecked, hint }: { name: string; label: ReactNode; defaultChecked?: boolean; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-line bg-white/60 px-3.5 py-3 text-[14px] transition-colors hover:bg-white has-[:checked]:border-green/40 has-[:checked]:bg-green-soft/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 accent-[#1a6e48] focus-visible:outline-none" />
      <span className="flex flex-col gap-0.5">
        <span className="text-head">{label}</span>
        {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}
