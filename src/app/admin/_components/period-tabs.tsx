import Link from "next/link";
import { cx } from "@/components/ui";
import { PERIODS, type PeriodKey } from "@/lib/admin/metrics";

export function PeriodTabs({ value, base }: { value: PeriodKey; base: string }) {
  return (
    <div role="group" aria-label="Период" className="glass inline-flex !rounded-full p-1">
      {PERIODS.map((p) => (
        <Link
          key={p.key}
          href={`${base}?p=${p.key}`}
          scroll={false}
          aria-current={p.key === value ? "true" : undefined}
          className={cx("inline-flex h-8 items-center rounded-full px-3 text-[13px] focus-visible:outline-2 focus-visible:outline-green", p.key === value ? "bg-cta text-white" : "text-ink-2 hover:bg-white")}
        >
          {p.label}
        </Link>
      ))}
    </div>
  );
}
