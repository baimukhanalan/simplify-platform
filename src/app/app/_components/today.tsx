import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeDollarSign, FileText, Mail, Mic, Search, Send, SkipForward, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ButtonLink, cx } from "@/components/ui";
import { STAGES, dayLabel, hhmm, type TimelineDay, type TimelineItem, type Totals } from "./today-data";

// ——— Main progress bar: Career Goal → … → Hired ———

export function StageBar({ stage, totals, goalRole }: { stage: number; totals: Totals; goalRole: string }) {
  const value: Record<string, string> = {
    goal: goalRole, search: String(totals.found), applications: String(totals.submitted), assessments: String(totals.assessments),
    interviews: String(totals.interviews), offers: String(totals.offers), hired: totals.hired ? "Да" : "",
  };
  const pctDone = (stage / (STAGES.length - 1)) * 100;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        {/* track */}
        <div className="absolute left-[7px] right-[7px] top-[7px] h-[2px] rounded-full bg-head/10" aria-hidden>
          <div className="h-full rounded-full bg-green transition-[width] duration-1000" style={{ width: `${pctDone}%` }} />
        </div>
        <ol className="relative flex justify-between" aria-label="Прогресс кампании">
          {STAGES.map((s, i) => {
            const done = i < stage;
            const current = i === stage;
            return (
              <li key={s.key} aria-current={current ? "step" : undefined} className={cx("flex min-w-0 flex-col items-center gap-2 sm:flex-1", i === 0 && "sm:items-start", i === STAGES.length - 1 && "sm:items-end")}>
                <span
                  className={cx(
                    "grid size-4 place-items-center rounded-full border-2",
                    current ? "border-green bg-green animate-pulse-dot" : done ? "border-green bg-green" : "border-head/20 bg-mint-2",
                  )}
                  aria-hidden
                >
                  {done && <span className="size-1.5 rounded-full bg-white" />}
                </span>
                <span className={cx("sr-only sm:not-sr-only sm:text-center", i === 0 && "sm:!text-left", i === STAGES.length - 1 && "sm:!text-right")}>
                  <span className={cx("block text-[12.5px] leading-tight", current ? "font-medium text-head" : done ? "text-ink-2" : "text-ink-4")}>
                    {s.label}
                    <span className="sr-only">{current ? " — текущий этап" : done ? " — пройден" : " — впереди"}{value[s.key] ? `, ${value[s.key]}` : ""}</span>
                  </span>
                  {value[s.key] && s.key !== "goal" && <span aria-hidden className={cx("num block text-[12px]", current ? "text-green" : "text-ink-4")}>{value[s.key]}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="text-[13px] text-ink-3 sm:hidden" aria-hidden>
        Этап <span className="num text-head">{stage + 1}</span> из {STAGES.length}: <span className="text-head">{STAGES[stage].label}</span>
      </p>
    </div>
  );
}

// ——— Key numbers ———

export function KeyNumbers({ t }: { t: Totals }) {
  const items = [
    { label: "Найдено", v: t.found },
    { label: "Подошли", v: t.qualified },
    { label: "Подано", v: t.submitted },
    { label: "Ответов", v: t.responses },
    { label: "Assessment", v: t.assessments },
    { label: "Interviews", v: t.interviews, accent: true },
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-1.5">
          <dt className="label !text-[10px]">{it.label}</dt>
          <dd className={cx("num text-[30px] leading-none sm:text-[34px]", it.accent && it.v ? "text-green" : "text-head")}>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TodayStrip({ d }: { d: { found: number; qualified: number; submitted: number; responses: number } }) {
  const items = [
    { label: "найдено", v: d.found },
    { label: "подошли", v: d.qualified },
    { label: "подано", v: d.submitted },
    { label: "ответов", v: d.responses },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-head/[.04] px-4 py-3">
      <span className="label !text-[10px] !text-head">Today · 24 ч</span>
      {items.map((it) => (
        <span key={it.label} className="text-[13px] text-ink-3"><span className={cx("num text-[15px]", it.v ? "text-head" : "text-ink-4")}>{it.v ? `+${it.v}` : "0"}</span> {it.label}</span>
      ))}
    </div>
  );
}

// ——— Next action ———

export type NextAction = { eyebrow: string; title: string; sub?: string; href: string; cta: string; icon: LucideIcon } | null;

export function NextActionCard({ action, also, paused }: { action: NextAction; also: { label: string; href: string }[]; paused: boolean }) {
  return (
    <section aria-labelledby="next-h" className={cx("flex h-full flex-col gap-5 rounded-[var(--radius-card)] p-5 sm:p-6", action ? "glass-strong" : "glass")}>
      <h2 id="next-h" className="label">Next action</h2>
      {action ? (
        <>
          <div className="flex items-start gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-green text-white shadow-(--shadow-cta)"><action.icon className="size-5" strokeWidth={1.7} aria-hidden /></span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[.08em] text-green">{action.eyebrow}</span>
              <p className="h-serif text-[24px]">{action.title}</p>
              {action.sub && <p className="text-[14px] text-ink-2">{action.sub}</p>}
            </div>
          </div>
          <ButtonLink href={action.href} size="lg" className="w-full sm:w-auto sm:self-start">{action.cta}<ArrowRight className="size-4" aria-hidden /></ButtonLink>
        </>
      ) : (
        <div className="flex flex-1 flex-col justify-center gap-3 py-2">
          <span className="flex items-center gap-2.5">
            <span className={cx("size-2.5 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
            <span className="font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-3">{paused ? "Agent paused" : "All clear"}</span>
          </span>
          {paused ? (
            <>
              <p className="h-serif text-[26px]">Агент на паузе.</p>
              <p className="text-[14px] text-ink-2">Пока кампания на паузе, от тебя ничего не нужно. Возобнови её, когда будешь готов.</p>
              <ButtonLink href="/app/agent" variant="glass" size="md" className="self-start">Открыть Agent</ButtonLink>
            </>
          ) : (
            <>
              <p className="h-serif text-[26px] leading-tight">Nothing needed from you right now. Simplify is working.</p>
              <p className="text-[14px] text-ink-3">Как только появится интервью, assessment или вопрос, который может решить только ты, — он будет здесь.</p>
            </>
          )}
        </div>
      )}
      {also.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-4">
          {also.map((a) => (
            <li key={a.href + a.label}>
              <Link href={a.href} className="group flex items-center justify-between gap-3 rounded-lg py-1.5 text-[13.5px] text-ink-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
                {a.label}<ArrowUpRight className="size-3.5 shrink-0 text-teal transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ——— "Что агент сделал сегодня" ———

const KIND_ICON: Record<TimelineItem["kind"], LucideIcon> = {
  found: Search, skipped: SkipForward, prepared: FileText, submitted: Send, response: Mail, interview: Mic, offer: BadgeDollarSign, rejection: Mail, system: Sparkles,
};
const KIND_TONE: Partial<Record<TimelineItem["kind"], string>> = {
  submitted: "border-green/25 bg-green-soft text-green", interview: "border-green/25 bg-green text-white", offer: "border-green/25 bg-green text-white",
  skipped: "border-stroke bg-white text-ink-4", rejection: "border-rose/15 bg-rose-soft text-rose",
};

export function Timeline({ days, now }: { days: TimelineDay[]; now: number }) {
  if (!days.length) {
    return <p className="py-6 text-[14px] text-ink-3">За последние дни событий нет. Как только агент проведёт цикл, каждый его шаг появится здесь — со временем и причиной.</p>;
  }
  return (
    <div className="flex flex-col gap-7">
      {days.map((d) => (
        <section key={d.key} aria-labelledby={`day-${d.key}`}>
          <h3 id={`day-${d.key}`} className="label mb-2 !text-[10px] !text-head">{dayLabel(d.key, new Date(now))}</h3>
          <ol className="flex flex-col">
            {d.items.map((it) => {
              const Icon = KIND_ICON[it.kind];
              const muted = it.kind === "system" || it.kind === "skipped";
              return (
                <li key={it.id} className="grid grid-cols-[44px_28px_1fr] items-start gap-2.5 border-b border-line/60 py-2.5 last:border-0 sm:grid-cols-[52px_28px_1fr]">
                  <time dateTime={it.at.toISOString()} className="num pt-1 text-[12.5px] text-ink-4">{hhmm(it.at)}</time>
                  <span className={cx("grid size-7 place-items-center rounded-full border", KIND_TONE[it.kind] ?? "border-stroke bg-white text-teal")}><Icon className="size-3.5" strokeWidth={1.7} aria-hidden /></span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
                    {it.href && !it.cta ? (
                      <Link href={it.href} className={cx("min-w-0 break-words text-[14px] leading-snug hover:underline focus-visible:outline-2 focus-visible:outline-green", muted ? "text-ink-3" : "text-ink")}>{it.text}</Link>
                    ) : (
                      <span className={cx("min-w-0 break-words text-[14px] leading-snug", muted ? "text-ink-3" : "text-ink")}>{it.text}</span>
                    )}
                    {it.match != null && <span className="num rounded-full bg-head/[.06] px-2 py-0.5 text-[11.5px] text-head">Match {it.match}%</span>}
                    {it.detail && <span className="font-mono text-[10px] uppercase tracking-[.06em] text-amber">{it.detail}</span>}
                    {it.cta && it.href && (
                      <Link href={it.href} className="inline-flex items-center gap-1 rounded-full bg-cta px-3 py-1 text-[12px] font-medium text-white hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                        {it.cta}<ArrowRight className="size-3" aria-hidden />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {(d.moreFound > 0 || d.moreSkipped > 0 || d.hidden > 0) && (
            <p className="mt-2 pl-[80px] text-[12.5px] text-ink-4 sm:pl-[90px]">
              {[d.moreFound > 0 && `ещё ${d.moreFound} найдено`, d.moreSkipped > 0 && `ещё ${d.moreSkipped} пропущено`, d.hidden > 0 && `ещё ${d.hidden} событий`].filter(Boolean).join(" · ")}
              {" · "}<Link href="/app/opportunities" className="text-teal hover:text-head">все вакансии</Link>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

export function StatusDot({ status }: { status: string }) {
  const active = status === "active";
  const label = { active: "Active", paused: "Paused", hired: "Hired", expired: "Ended" }[status] ?? status;
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[.08em]", active || status === "hired" ? "border-green/20 bg-green-soft text-green" : status === "paused" ? "border-amber/20 bg-amber-soft text-amber" : "border-stroke bg-white/70 text-ink-3")}>
      <span className={cx("size-2 rounded-full", active ? "bg-green animate-pulse-dot" : status === "hired" ? "bg-green" : status === "paused" ? "bg-amber" : "bg-ink-4")} aria-hidden />
      {label}
    </span>
  );
}

