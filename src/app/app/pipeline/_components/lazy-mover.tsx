"use client";
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cx } from "@/components/ui";
import { setOpportunityStatus } from "@/lib/actions/ops";
import { PIPELINE } from "@/lib/engine/taxonomy";

const GROUP_LABEL = { prep: "Подготовка", applied: "Подано", interview: "Интервью", result: "Результат" } as const;
type Group = keyof typeof GROUP_LABEL;
const ALL: Group[] = ["prep", "applied", "interview", "result"];

/**
 * Status menu rendered only when opened — keeps a 100+ card board light.
 * `groups` limits the choices (the Applications tracker hides the prep stages); `label` names the trigger for screen readers.
 */
export function LazyStatusMover({ id, current, groups = ALL, label }: { id: string; current: string; groups?: Group[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const GROUPS = groups.map((g) => ({ g, items: PIPELINE.filter((p) => p.group === g) }));
  return (
    <details className="group/mover relative" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-full px-2 py-1 font-mono text-[10px] uppercase tracking-[.06em] text-teal transition-colors hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden" aria-label={label}>
        {groups === ALL ? "Переместить" : "Сменить статус"}
        <ChevronDown className="size-3 transition-transform group-open/mover:rotate-180" aria-hidden />
      </summary>
      {open && (
        <form action={setOpportunityStatus} className="mt-2 flex flex-col gap-2 rounded-2xl border border-stroke bg-white p-2.5 shadow-(--shadow-glass)">
          <input type="hidden" name="id" value={id} />
          {GROUPS.map(({ g, items }) => (
            <fieldset key={g} className="flex flex-col gap-1">
              <legend className="label mb-1 !text-[9px]">{GROUP_LABEL[g]}</legend>
              <div className="flex flex-wrap gap-1">
                {items.map((p) => (
                  <button key={p.key} name="status" value={p.key} disabled={p.key === current} aria-current={p.key === current ? "true" : undefined}
                    className={cx("rounded-full border border-line px-2.5 py-1 text-[12px] text-ink-2 transition-colors hover:border-green hover:bg-green-soft hover:text-green focus-visible:outline-2 focus-visible:outline-green disabled:border-transparent disabled:bg-cta disabled:text-white")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {current !== "skipped" && groups.includes("prep") && (
            <button name="status" value="skipped" className="self-start rounded-full px-2.5 py-1 text-[12px] text-ink-3 underline-offset-2 hover:text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">Пропустить вакансию</button>
          )}
        </form>
      )}
    </details>
  );
}
