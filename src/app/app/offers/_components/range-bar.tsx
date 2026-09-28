import { cx } from "@/components/ui";

/** Market range bar (CSS only): band low→high, median tick, offer / target / final markers. */
export function RangeBar({ low, mid, high, offer, target, final, currency }: { low: number; mid: number; high: number; offer: number; target?: number; final?: number; currency: string }) {
  const format = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  const short = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(n);
  const values = [low, high, offer, target ?? offer, final ?? offer];
  const min = Math.min(...values) * 0.9;
  const max = Math.max(...values) * 1.06;
  const pct = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
  const clampPos = (v: number) => Math.max(4, Math.min(96, ((v - min) / (max - min || 1)) * 100));
  const label = `Рынок ${format(low)}–${format(high)}, медиана ${format(mid)}. Оффер ${format(offer)}${target ? `, цель ${format(target)}` : ""}${final ? `, итог ${format(final)}` : ""}.`;

  return (
    <div role="img" aria-label={label} className="select-none">
      {/* Top markers */}
      <div className="relative h-11">
        <Marker pos={clampPos(offer)} label="Оффер" value={format(offer)} tone="dark" />
      </div>
      <div className="relative h-3 rounded-full bg-head/8">
        <div className="absolute inset-y-0 rounded-full bg-gradient-to-r from-green/25 via-green/45 to-green/25" style={{ left: pct(low), width: `calc(${pct(high)} - ${pct(low)})` }} />
        <div className="absolute -inset-y-1 w-px bg-green" style={{ left: pct(mid) }} />
        <Dot pos={pct(offer)} className="bg-cta" />
        {target != null && <Dot pos={pct(target)} className="border-2 border-green bg-white" />}
        {final != null && final !== offer && <Dot pos={pct(final)} className="bg-green" />}
      </div>
      {/* Bottom scale */}
      <div className="relative mt-2 h-11 text-[11.5px] text-ink-3">
        <span className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${clampPos(low)}%` }}>{short(low)}<span className="block text-center text-[10px] text-ink-4">p15</span></span>
        <span className="num absolute -translate-x-1/2 whitespace-nowrap text-green" style={{ left: `${clampPos(mid)}%` }}>{short(mid)}<span className="block text-center text-[10px]">медиана</span></span>
        <span className="num absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${clampPos(high)}%` }}>{short(high)}<span className="block text-center text-[10px] text-ink-4">p85</span></span>
      </div>
      {final != null && final !== offer && (
        <p className="mt-1 flex items-center gap-2 text-[12.5px] text-ink-3">
          <span aria-hidden className="size-2.5 rounded-full bg-green" />
          Итог переговоров: <span className="num text-head">{format(final)}</span>
        </p>
      )}
      {target != null && (
        <p className="mt-1 flex items-center gap-2 text-[12.5px] text-ink-3">
          <span aria-hidden className="size-2.5 rounded-full border-2 border-green bg-white" />
          Цель переговоров: <span className="num text-head">{format(target)}</span>
        </p>
      )}
    </div>
  );
}

const Dot = ({ pos, className }: { pos: string; className: string }) => (
  <span aria-hidden className={cx("absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[0_1px_4px_rgb(0_0_0/.25)]", className)} style={{ left: pos }} />
);

function Marker({ pos, label, value, tone }: { pos: number; label: string; value: string; tone: "dark" | "green" }) {
  return (
    <div aria-hidden className="absolute bottom-1 flex -translate-x-1/2 flex-col items-center" style={{ left: `${pos}%` }}>
      <span className={cx("rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[.06em] whitespace-nowrap", tone === "dark" ? "bg-cta text-white" : "bg-green text-white")}>
        {label} <span className="num normal-case">{value}</span>
      </span>
    </div>
  );
}
