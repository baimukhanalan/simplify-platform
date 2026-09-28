import { Check, X, ChevronDown } from "lucide-react";
import { Chip, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setOpportunityStatus } from "@/lib/actions/ops";
import { PIPELINE } from "@/lib/engine/taxonomy";
import { ELIGIBILITY, LANE, statusLabel, statusTone } from "@/lib/ops";

export function EligibilityChip({ value }: { value: string }) {
  const m = ELIGIBILITY[value] ?? ELIGIBILITY.eligible;
  return <Chip tone={m.tone} dot>{m.label}</Chip>;
}

export function LaneChip({ value }: { value: string }) {
  if (value === "standard") return null;
  const m = LANE[value] ?? LANE.standard;
  return <Chip tone={m.tone}>{m.label}</Chip>;
}

export function StatusChip({ value }: { value: string }) {
  return <Chip tone={statusTone(value)}>{statusLabel(value)}</Chip>;
}

/** "SQL ✓ Python ✓ US authorization ✕" — top reasons, misses first-class so gaps are not hidden. */
export function MatchReasons({ reasons, limit = 6, className }: { reasons: { label: string; ok: boolean }[]; limit?: number; className?: string }) {
  if (!reasons.length) return null;
  return (
    <ul className={cx("flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]", className)} aria-label="Причины Match">
      {reasons.slice(0, limit).map((r, i) => (
        <li key={`${r.label}-${i}`} className={cx("inline-flex items-center gap-1", r.ok ? "text-ink-2" : "text-rose")}>
          <span>{r.label}</span>
          {r.ok ? <Check className="size-3.5 text-green" strokeWidth={2.2} aria-label="есть" /> : <X className="size-3.5" strokeWidth={2.2} aria-label="нет" />}
        </li>
      ))}
    </ul>
  );
}

/** Small labelled metric: Match 78 / P(Interview) 12%. */
export function Metric({ label, value, tone, className }: { label: string; value: string; tone?: "green" | "amber" | "rose" | "teal"; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <span className="label !text-[9.5px]">{label}</span>
      <span className={cx("num text-[20px] leading-none text-head", tone === "green" && "text-green", tone === "amber" && "text-amber", tone === "rose" && "text-rose", tone === "teal" && "text-teal")}>{value}</span>
    </div>
  );
}

export const matchTone = (m: number) => (m >= 75 ? "green" : m >= 55 ? "teal" : m >= 40 ? "amber" : "rose") as "green" | "teal" | "amber" | "rose";

const GROUP_LABEL = { prep: "Подготовка", applied: "Подано", interview: "Интервью", result: "Результат" } as const;

/**
 * Disclosure menu to move an opportunity to another pipeline status. One form, one button per status —
 * keyboard operable without JS, no accidental moves from arrow keys on a <select>.
 */
export function StatusMover({ id, current, label = "Переместить", align = "left" }: { id: string; current: string; label?: string; align?: "left" | "right" }) {
  const groups = (["prep", "applied", "interview", "result"] as const).map((g) => ({ g, items: PIPELINE.filter((p) => p.group === g) }));
  return (
    <details className="group/mover relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-teal transition-colors hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown className="size-3 transition-transform group-open/mover:rotate-180" aria-hidden />
      </summary>
      <form action={setOpportunityStatus} className={cx("mt-2 flex flex-col gap-2 rounded-2xl border border-stroke bg-white p-2.5 shadow-(--shadow-glass)", align === "right" && "sm:ml-auto")}>
        <input type="hidden" name="id" value={id} />
        {groups.map(({ g, items }) => (
          <fieldset key={g} className="flex flex-col gap-1">
            <legend className="label mb-1 !text-[9px]">{GROUP_LABEL[g]}</legend>
            <div className="flex flex-wrap gap-1">
              {items.map((p) => (
                <button
                  key={p.key}
                  name="status"
                  value={p.key}
                  disabled={p.key === current}
                  aria-current={p.key === current ? "true" : undefined}
                  className="rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-green hover:bg-green-soft hover:text-green focus-visible:outline-2 focus-visible:outline-green disabled:border-transparent disabled:bg-cta disabled:text-white"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        {current !== "skipped" && (
          <button name="status" value="skipped" className="self-start rounded-full px-2.5 py-1 text-[12px] text-ink-3 underline-offset-2 hover:text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
            Пропустить вакансию
          </button>
        )}
      </form>
    </details>
  );
}

export function SkipButton({ id }: { id: string }) {
  return (
    <form action={setOpportunityStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="skipped" />
      <SubmitButton variant="ghost" size="sm" pendingText="Пропускаем…">Пропустить</SubmitButton>
    </form>
  );
}
