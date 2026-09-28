/**
 * Hand-made Career Score history line. The SVG stretches to the container (non-scaling strokes);
 * points and labels are HTML overlays so text stays crisp at any width. A visually hidden table
 * carries the same data for screen readers. The live point (today's computation, see careerHistory) is marked «сейчас».
 */
export function HistoryChart({ points }: { points: { at: Date; score: number; marketValue: number; live?: boolean }[] }) {
  const scores = points.map((p) => p.score);
  const min = Math.max(0, Math.floor((Math.min(...scores) - 6) / 5) * 5);
  const max = Math.min(100, Math.ceil((Math.max(...scores) + 6) / 5) * 5);
  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => 100 - ((v - min) / (max - min || 1)) * 100;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.score)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},100 L${x(0)},100 Z`;
  const ticks = [min, Math.round((min + max) / 2), max];
  // Unambiguous axis dates: "28 сент." within a couple of months, otherwise "май 2026".
  const spanDays = (points[points.length - 1].at.getTime() - points[0].at.getTime()) / 86400000;
  const fmt = (d: Date) =>
    spanDays < 62
      ? d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" })
      : d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  const last = points[points.length - 1];
  const label = (p: { at: Date; live?: boolean }) => (p.live ? "сейчас" : fmt(p.at));

  return (
    <figure className="flex flex-col gap-2">
      <div className="grid grid-cols-[28px_1fr] gap-2">
        <div className="relative h-44" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="num absolute right-0 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: `${y(t)}%` }}>{t}</span>
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
              title={`${label(p)}: ${p.score} · $${Math.round(p.marketValue).toLocaleString("ru-RU")}`}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${p.live ? "size-3 bg-cta" : "size-2.5 bg-green"}`}
              style={{ left: `${x(i)}%`, top: `${y(p.score)}%` }}
            />
          ))}
          <span className="num absolute -translate-x-full -translate-y-[calc(100%+10px)] rounded-full bg-cta px-2 py-0.5 text-[12px] text-white" style={{ left: `${x(points.length - 1)}%`, top: `${y(last.score)}%` }}>
            {last.live ? `${last.score} · сейчас` : last.score}
          </span>
        </div>
      </div>
      <div className="ml-[36px] flex justify-between font-mono text-[11px] tracking-[.04em] text-ink-3" aria-hidden>
        <span>{fmt(points[0].at)}</span>
        {points.length > 2 && <span>{fmt(points[Math.floor(points.length / 2)].at)}</span>}
        <span>{label(last)}</span>
      </div>
      <figcaption className="sr-only">История Career Score</figcaption>
      <table className="sr-only">
        <thead><tr><th>Дата</th><th>Career Score</th><th>Market Value, USD</th></tr></thead>
        <tbody>
          {points.map((p, i) => <tr key={i}><td>{p.live ? "сейчас" : p.at.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}</td><td>{p.score}</td><td>{Math.round(p.marketValue).toLocaleString("ru-RU")}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
