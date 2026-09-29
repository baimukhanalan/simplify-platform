import { cx } from "@/components/ui";

/** 24 hourly bars (oldest → now). Decorative for sighted users; the label carries the numbers. */
export function Sparkline({ series, className, tall }: { series: number[]; className?: string; tall?: boolean }) {
  const max = Math.max(1, ...series);
  const total = series.reduce((a, b) => a + b, 0);
  const h = tall ? 48 : 22;
  const w = series.length * 4;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={tall ? "100%" : w} height={h} preserveAspectRatio="none" role="img" aria-label={`За 24 часа: ${total}`} className={cx("block shrink-0", className)}>
      <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="currentColor" strokeOpacity={0.15} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {series.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 2)) : 0;
        return <rect key={i} x={i * 4 + 0.5} y={h - bh} width={3} height={bh} rx={0.75} className={i === series.length - 1 ? "fill-rose" : "fill-teal"} fillOpacity={i === series.length - 1 ? 1 : 0.7} />;
      })}
    </svg>
  );
}
