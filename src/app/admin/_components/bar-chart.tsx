import { cx } from "@/components/ui";

export type Bar = { key: string; label: string; parts: { value: number; className: string; name: string }[] };

/**
 * Pure CSS bar chart (no chart library): one measure per chart, bars anchored to the baseline, a hover/focus tooltip
 * per bar and a table view for screen readers and exact numbers.
 */
export function BarChart({ title, bars, format, legend, emptyText = "Нет данных за период" }: {
  title: string;
  bars: Bar[];
  format: (n: number) => string;
  legend?: { name: string; className: string }[];
  emptyText?: string;
}) {
  const totals = bars.map((b) => b.parts.reduce((a, p) => a + p.value, 0));
  const max = Math.max(0, ...totals);
  const sum = totals.reduce((a, b) => a + b, 0);
  const dense = bars.length > 45;
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="label">{title}</span>
        <span className="flex flex-wrap items-center gap-3 text-[12px] text-ink-3">
          {legend?.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1.5"><span className={cx("size-2.5 rounded-[3px]", l.className)} aria-hidden />{l.name}</span>
          ))}
          <span className="num text-head">Σ {format(sum)}</span>
        </span>
      </figcaption>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden />
        <span className="num pointer-events-none absolute -top-2.5 right-0 bg-transparent text-[10.5px] text-ink-4" aria-hidden>{max > 0 ? format(max) : ""}</span>
        <div className={cx("flex h-36 items-end border-b border-line", dense ? "gap-px" : "gap-[2px]")} aria-hidden>
          {bars.map((b, i) => (
            <div key={b.key} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
              <div className="flex flex-col-reverse overflow-hidden rounded-t-[3px] transition-opacity group-hover:opacity-80" style={{ height: max > 0 ? `${(totals[i] / max) * 100}%` : 0, minHeight: totals[i] > 0 ? 2 : 0 }}>
                {b.parts.map((p) => p.value > 0 && <div key={p.name} className={p.className} style={{ height: `${(p.value / totals[i]) * 100}%` }} />)}
              </div>
              <div className={cx("pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max max-w-[180px] rounded-lg bg-cta px-2 py-1.5 text-[11.5px] leading-snug text-white shadow-lg group-hover:block", i > bars.length / 2 ? "right-0" : "left-0")}>
                <div className="font-medium">{b.label}</div>
                {b.parts.length > 1 ? b.parts.map((p) => <div key={p.name} className="num">{p.name}: {format(p.value)}</div>) : <div className="num">{format(totals[i])}</div>}
              </div>
            </div>
          ))}
        </div>
        {max === 0 && <p className="absolute inset-0 grid place-items-center text-[13px] text-ink-4">{emptyText}</p>}
      </div>
      <div className="flex justify-between text-[11px] text-ink-4" aria-hidden>
        <span>{bars[0]?.label}</span>
        {bars.length > 2 && <span>{bars[Math.floor(bars.length / 2)]?.label}</span>}
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
      <details className="text-[12.5px]">
        <summary className="cursor-pointer text-teal">Таблица</summary>
        <div className="scroll-thin mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead><tr className="border-b border-line"><th scope="col" className="py-1 font-normal text-ink-3">Период</th>{(bars[0]?.parts ?? []).map((p) => <th key={p.name} scope="col" className="py-1 text-right font-normal text-ink-3">{p.name}</th>)}</tr></thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key} className="border-b border-line/60">
                  <th scope="row" className="py-1 font-normal text-ink-2">{b.label}</th>
                  {b.parts.map((p) => <td key={p.name} className="num py-1 text-right">{format(p.value)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
