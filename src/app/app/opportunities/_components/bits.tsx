import { Check, X, ChevronDown } from "lucide-react";
import { Chip, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { setOpportunityStatus } from "@/lib/actions/ops";
import { PIPELINE } from "@/lib/engine/taxonomy";
import { LANE, statusTone } from "@/lib/ops";
import { getT } from "@/lib/i18n/server";
import { statusT, tKey } from "../_lib/labels";

// Server components (they read the request's language with getT()).

export async function LaneChip({ value }: { value: string }) {
  if (value === "standard") return null;
  const m = LANE[value] ?? LANE.standard;
  const t = await getT();
  return <Chip tone={m.tone}>{tKey(t, `work.lane.${value}`, m.label)}</Chip>;
}

export async function StatusChip({ value }: { value: string }) {
  const t = await getT();
  return <Chip tone={statusTone(value)}>{statusT(t, value)}</Chip>;
}

/** "SQL ✓ Python ✓ US authorization ✕" — top reasons, misses first-class so gaps are not hidden. */
export async function MatchReasons({ reasons, limit = 6, className }: { reasons: { label: string; ok: boolean }[]; limit?: number; className?: string }) {
  if (!reasons.length) return null;
  const t = await getT();
  return (
    <ul className={cx("flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]", className)} aria-label={t("opps.reasonsAria")}>
      {reasons.slice(0, limit).map((r, i) => (
        <li key={`${r.label}-${i}`} className={cx("inline-flex items-center gap-1", r.ok ? "text-ink-2" : "text-rose")}>
          <span>{r.label}</span>
          {r.ok ? <Check className="size-3.5 text-green" strokeWidth={2.2} aria-label={t("opps.reasonHas")} /> : <X className="size-3.5" strokeWidth={2.2} aria-label={t("opps.reasonMissing")} />}
        </li>
      ))}
    </ul>
  );
}

/** Small labelled metric: Match 78 / P(Interview) 12%. */
export function Metric({ label, value, tone, className }: { label: string; value: string; tone?: "green" | "amber" | "rose" | "teal"; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <span className="label !text-[11px]">{label}</span>
      <span className={cx("num text-[20px] leading-none text-head", tone === "green" && "text-green", tone === "amber" && "text-amber", tone === "rose" && "text-rose", tone === "teal" && "text-teal")}>{value}</span>
    </div>
  );
}

export const matchTone = (m: number) => (m >= 75 ? "green" : m >= 55 ? "teal" : m >= 40 ? "amber" : "rose") as "green" | "teal" | "amber" | "rose";

const GROUP_LABEL = { prep: "groupPrep", applied: "groupApplied", interview: "groupInterview", result: "groupResult" } as const;
type Group = keyof typeof GROUP_LABEL;
const ALL_GROUPS: Group[] = ["prep", "applied", "interview", "result"];

/**
 * Disclosure menu to move an opportunity to another pipeline status. One form, one button per status —
 * keyboard operable without JS, no accidental moves from arrow keys on a <select>. `groups` limits the choices
 * (an application page hides the prep stages); `label` names the trigger for screen readers.
 */
export async function StatusMover({ id, current, label, ariaLabel, groups = ALL_GROUPS, align = "left" }: { id: string; current: string; label?: string; ariaLabel?: string; groups?: Group[]; align?: "left" | "right" }) {
  const t = await getT();
  const sets = groups.map((g) => ({ g, items: PIPELINE.filter((p) => p.group === g) }));
  return (
    <details className="group/mover relative">
      <summary aria-label={ariaLabel} className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-full border border-line bg-white/70 px-4 text-[13px] text-head transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
        {label ?? t("opps.move")}
        <ChevronDown className="size-3.5 text-teal transition-transform group-open/mover:rotate-180" aria-hidden />
      </summary>
      <form action={setOpportunityStatus} className={cx("mt-2 flex flex-col gap-2.5 rounded-2xl border border-stroke bg-white p-3 shadow-(--shadow-glass)", align === "right" && "sm:ml-auto")}>
        <input type="hidden" name="id" value={id} />
        {sets.map(({ g, items }) => (
          <fieldset key={g} className="flex flex-col gap-1">
            <legend className="label mb-1 !text-[11px]">{t(`opps.${GROUP_LABEL[g]}`)}</legend>
            <div className="flex flex-wrap gap-1.5">
              {items.map((p) => (
                <button
                  key={p.key}
                  name="status"
                  value={p.key}
                  disabled={p.key === current}
                  aria-current={p.key === current ? "true" : undefined}
                  className="inline-flex min-h-10 items-center rounded-full border border-line px-3 text-[12.5px] text-ink-2 transition-colors hover:border-green hover:bg-green-soft hover:text-green focus-visible:outline-2 focus-visible:outline-green disabled:border-transparent disabled:bg-cta disabled:text-white"
                >
                  {statusT(t, p.key)}
                </button>
              ))}
            </div>
          </fieldset>
        ))}
        {current !== "skipped" && groups.includes("prep") && (
          <button name="status" value="skipped" className="inline-flex min-h-10 items-center self-start rounded-full px-3 text-[12.5px] text-ink-3 underline-offset-2 hover:text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
            {t("opps.skipJob")}
          </button>
        )}
      </form>
    </details>
  );
}

export async function SkipButton({ id }: { id: string }) {
  const t = await getT();
  return (
    <form action={setOpportunityStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value="skipped" />
      <SubmitButton variant="ghost" size="sm" pendingText={t("opps.skipping")}>{t("opps.skip")}</SubmitButton>
    </form>
  );
}
