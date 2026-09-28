/**
 * Hand-made Career Score history line. The SVG stretches to the container (non-scaling strokes);
 * points and labels are HTML overlays so text stays crisp at any width. A visually hidden table
 * carries the same data for screen readers.
 */
export function HistoryChart({ points }: { points: { at: Date; score: number; marketValue: number }[] }) {
  const scores = points.map((p) => p.score);
  const min = Math.max(0, Math.floor((Math.min(...scores) - 6) / 5) * 5);
  const max = Math.min(100, Math.ceil((Math.max(...scores) + 6) / 5) * 5);
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => 100 - ((v - min) / (max - min || 1)) * 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},100 L${x(0)},100 Z`;
  const ticks = [min, Math.round((min + max) / 2), max];
  const fmt = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", month: "short", year: "2-digit" });
  const last = points[points.length - 1];

  return (
    <figure className="flex flex-col gap-2">
      <div className="grid grid-cols-[28px_1fr] gap-2">
        <div className="relative h-44" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2 text-[11px] text-ink-4" style={{ top: `${y(t)}%` }}>{t}</span>
          ))}
        </div>
        <div className="relative h-44" aria-hidden>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <defs>
              <linearGradient id="career-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-green)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--color-green)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {ticks.map((t) => (
              <line key={t} x1="0" x2="100" y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={area} fill="url(#career-area)" />
            <path d={line} fill="none" stroke="var(--color-green)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {points.map((p, i) => (
            <span
              key={i}
              title={`${fmt(p.at)}: ${p.score} · $${Math.round(p.marketValue / 1000)}k`}
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-green shadow"
              style={{ left: `${x(i)}%`, top: `${y(p.score)}%` }}
            />
          ))}
          <span className="num absolute -translate-x-full -translate-y-[calc(100%+10px)] rounded-full bg-cta px-2 py-0.5 text-[12px] text-white" style={{ left: `${x(points.length - 1)}%`, top: `${y(last.score)}%` }}>
            {last.score}
          </span>
        </div>
      </div>
      <div className="ml-[36px] flex justify-between font-mono text-[10.5px] uppercase tracking-[.06em] text-ink-4" aria-hidden>
        <span>{fmt(points[0].at)}</span>
        {points.length > 2 && <span>{fmt(points[Math.floor(points.length / 2)].at)}</span>}
        <span>{fmt(last.at)}</span>
      </div>
      <figcaption className="sr-only">История Career Score</figcaption>
      <table className="sr-only">
        <thead><tr><th>Дата</th><th>Career Score</th><th>Market value, USD</th></tr></thead>
        <tbody>
          {points.map((p, i) => <tr key={i}><td>{p.at.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}</td><td>{p.score}</td><td>{p.marketValue}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
