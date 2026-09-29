import Link from "next/link";
import { ArrowRight, ArrowUpRight, BadgeDollarSign, FileText, Mail, Mic, Search, Send, SkipForward, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ButtonLink, cx } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { STAGES, STAGE_LABEL, dayLabelT, hhmm, type StageKey, type TimelineDay, type TimelineItem, type Totals } from "./today-data";

// ——— Main progress bar: Цель → … → Работа ———

/**
 * `open`: stages that still have something in progress (an upcoming test or interview, an offer awaiting a decision).
 * A stage behind the current one is shown as done only when nothing in it is open; otherwise it reads «в процессе».
 */
export async function StageBar({ stage, values, open = {}, openCount = {} }: { stage: number; values: Record<StageKey, string>; open?: Partial<Record<StageKey, boolean>>; openCount?: Partial<Record<StageKey, number>> }) {
  const value = values;
  const t = await getT();
  const pctDone = (stage / (STAGES.length - 1)) * 100;
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        {/* track */}
        <div className="absolute left-[7px] right-[7px] top-[7px] h-[2px] rounded-full bg-head/10" aria-hidden>
          <div className="h-full rounded-full bg-green transition-[width] duration-1000" style={{ width: `${pctDone}%` }} />
        </div>
        <ol className="relative flex justify-between" aria-label={t("today.progressAria")}>
          {STAGES.map((s, i) => {
            const inProgress = i < stage && Boolean(open[s.key]);
            const done = i < stage && !inProgress;
            const current = i === stage;
            return (
              <li key={s.key} aria-current={current ? "step" : undefined} className={cx("flex min-w-0 flex-col items-center gap-2 sm:flex-1", i === 0 && "sm:items-start", i === STAGES.length - 1 && "sm:items-end")}>
                <span
                  className={cx(
                    "grid size-4 place-items-center rounded-full border-2",
                    current ? "border-green bg-green animate-pulse-dot" : done ? "border-green bg-green" : inProgress ? "border-green bg-mint-2" : "border-head/20 bg-mint-2",
                  )}
                  aria-hidden
                >
                  {done && <span className="size-1.5 rounded-full bg-white" />}
                  {inProgress && <span className="size-1.5 rounded-full bg-green animate-pulse-dot" />}
                </span>
                <span className={cx("sr-only sm:not-sr-only sm:text-center", i === 0 && "sm:!text-left", i === STAGES.length - 1 && "sm:!text-right")}>
                  <span className={cx("block text-[12.5px] leading-tight", current ? "font-medium text-head" : done || inProgress ? "text-ink-2" : "text-ink-3")}>
                    {t(`today.${STAGE_LABEL[s.key]}`)}
                    <span className="sr-only">{current ? t("today.stageCurrent") : inProgress ? `${t("today.stageInProgress")}${openCount[s.key] ? `: ${openCount[s.key]}` : ""}` : done ? t("today.stageDone") : t("today.stageAhead")}{value[s.key] ? `, ${value[s.key]}` : ""}</span>
                  </span>
                  {value[s.key] && s.key !== "goal" && <span aria-hidden className={cx("num block text-[12px]", current || inProgress ? "text-green" : "text-ink-3")}>{value[s.key]}</span>}
                  {/* The number above is the total reached; this line is what is still ahead, so «3» never reads as «3 в процессе». */}
                  {inProgress && <span aria-hidden className="block text-[11px] text-green">{t("today.inProgress")}{openCount[s.key] ? `: ${openCount[s.key]}` : ""}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="text-[13px] text-ink-3 sm:hidden" aria-hidden>
        {t.rich("today.stageOf", { n: String(stage + 1), total: String(STAGES.length), label: t(`today.${STAGE_LABEL[STAGES[stage].key]}`) }, { b: (c) => <span className="num text-head">{c}</span>, h: (c) => <span className="text-head">{c}</span> })}
      </p>
    </div>
  );
}

// ——— Key numbers ———

export async function KeyNumbers({ t: n }: { t: Totals }) {
  const t = await getT();
  const items = [
    { label: t("today.numFound"), v: n.found },
    { label: t("today.numQualified"), v: n.qualified },
    { label: t("today.numSubmitted"), v: n.submitted },
    { label: t("today.numResponses"), v: n.responses },
    { label: t("today.numAssessments"), v: n.assessments },
    { label: t("today.numInterviews"), v: n.interviews, accent: true },
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="flex flex-col gap-1.5">
          <dt className="label !text-[11px]">{it.label}</dt>
          <dd className={cx("num text-[30px] leading-none sm:text-[34px]", it.accent && it.v ? "text-green" : "text-head")}>{it.v}</dd>
        </div>
      ))}
    </dl>
  );
}

export async function TodayStrip({ d }: { d: { found: number; qualified: number; submitted: number; responses: number } }) {
  const t = await getT();
  // «+1 подошла», «+2 подошли», «+5 ответов»: the word agrees with the number.
  const items = [
    { key: "found", word: "stripFound", v: d.found },
    { key: "qualified", word: "stripQualified", v: d.qualified },
    { key: "submitted", word: "stripSubmitted", v: d.submitted },
    { key: "responses", word: "stripResponses", v: d.responses },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl bg-head/[.04] px-4 py-3">
      <span className="label !text-[11px] !text-head">{t("today.stripToday")}</span>
      {items.map((it) => (
        <span key={it.key} className="text-[13px] text-ink-3"><span className={cx("num text-[15px]", it.v ? "text-head" : "text-ink-4")}>{it.v ? `+${it.v}` : "0"}</span> {t(`today.${it.word}`, { n: it.v })}</span>
      ))}
    </div>
  );
}

// ——— Следующий шаг ———

export type NextAction = { eyebrow: string; title: string; sub?: string; href: string; cta: string; icon: LucideIcon } | null;

/** `id` keeps headings unique: Today renders the card in two layout slots (mobile / desktop), one hidden at a time. */
export async function NextActionCard({ action, also, paused, id = "next-h", className }: { action: NextAction; also: { label: string; href: string }[]; paused: boolean; id?: string; className?: string }) {
  const t = await getT();
  return (
    <section aria-labelledby={id} className={cx("flex h-full flex-col gap-5 rounded-[var(--radius-card)] p-5 sm:p-6", action ? "glass-strong" : "glass", className)}>
      <h2 id={id} className="label">{t("today.nextStep")}</h2>
      {action ? (
        <>
          <div className="flex items-start gap-3.5">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-green text-white shadow-(--shadow-cta)"><action.icon className="size-5" strokeWidth={1.7} aria-hidden /></span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-green">{action.eyebrow}</span>
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
            <span className="font-mono text-[11px] uppercase tracking-[.08em] text-ink-3">{paused ? t("today.pausedChip") : t("today.calm")}</span>
          </span>
          {paused ? (
            <>
              <p className="h-serif text-[26px]">{t("today.pausedTitle")}</p>
              <p className="text-[14px] text-ink-2">{t("today.pausedText")}</p>
              <ButtonLink href="/app/agent" variant="glass" size="md" className="self-start">{t("today.openAgent")}</ButtonLink>
            </>
          ) : (
            <>
              <p className="h-serif text-[26px] leading-tight">{t("today.nothingNeeded")}</p>
              <p className="text-[14px] text-ink-3">{t("today.nothingNeededSub")}</p>
            </>
          )}
        </div>
      )}
      {also.length > 0 && (
        <ul className="flex flex-col gap-1 border-t border-line pt-4">
          {also.map((a) => (
            <li key={a.href + a.label}>
              <Link href={a.href} className="group flex min-h-10 items-center justify-between gap-3 rounded-lg py-1.5 text-[13.5px] text-ink-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
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

export async function Timeline({ days, now }: { days: TimelineDay[]; now: number }) {
  const t = await getT();
  /** Journal lines are engine text and stay Russian for now: marked lang="ru" in other languages. */
  const engine = t.locale === "ru" ? undefined : "ru";
  if (!days.length) {
    return <p className="py-6 text-[14px] text-ink-3">{t("today.noEvents")}</p>;
  }
  return (
    <div className="flex flex-col gap-7">
      {days.map((d) => (
        <section key={d.key} aria-labelledby={`day-${d.key}`}>
          <h3 id={`day-${d.key}`} className="label mb-2 !text-[11px] !text-head">{dayLabelT(t, d.key, new Date(now))}</h3>
          <ol className="flex flex-col">
            {d.items.map((it) => {
              const Icon = KIND_ICON[it.kind];
              const muted = it.kind === "system" || it.kind === "skipped";
              // A past cycle line keeps what the cycle did, not the «… ждут» count it saw then — that count is stale
              // by now; the live one is in «Следующий шаг».
              const text = it.kind === "system" && /^Цикл агента:/.test(it.text) ? it.text.split(" · ")[0] : it.text;
              return (
                <li key={it.id} className="grid grid-cols-[44px_28px_1fr] items-start gap-2.5 border-b border-line/60 py-2.5 last:border-0 sm:grid-cols-[52px_28px_1fr]">
                  <time dateTime={it.at.toISOString()} className="num pt-1 text-[12.5px] text-ink-3">{hhmm(it.at)}</time>
                  <span className={cx("grid size-7 place-items-center rounded-full border", KIND_TONE[it.kind] ?? "border-stroke bg-white text-teal")}><Icon className="size-3.5" strokeWidth={1.7} aria-hidden /></span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 pt-0.5">
                    {it.href && !it.cta ? (
                      <Link href={it.href} lang={engine} className={cx("-my-2 inline-flex min-h-10 min-w-0 items-center break-words text-[14px] leading-snug hover:underline focus-visible:outline-2 focus-visible:outline-green", muted ? "text-ink-3" : "text-ink")}>{text}</Link>
                    ) : (
                      <span lang={engine} className={cx("min-w-0 break-words text-[14px] leading-snug", muted ? "text-ink-3" : "text-ink")}>{text}</span>
                    )}
                    {it.match != null && <span className="num rounded-full bg-head/[.06] px-2 py-0.5 text-[11.5px] text-head">Match {it.match}%</span>}
                    {it.detail && <span className="font-mono text-[11px] uppercase tracking-[.06em] text-amber">{it.detailKey ? t(`today.${it.detailKey}`) : it.detail}</span>}
                    {it.cta && it.href && (
                      <Link href={it.href} className="group inline-flex min-h-10 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                        <span className="inline-flex items-center gap-1 rounded-full bg-cta px-3 py-1 text-[12px] font-medium text-white group-hover:bg-[#2f2c2c]">{it.ctaKey ? t(`today.${it.ctaKey}`) : it.cta}<ArrowRight className="size-3" aria-hidden /></span>
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {(d.moreFound > 0 || d.moreSkipped > 0 || d.hidden > 0) && (
            <p className="mt-2 pl-[80px] text-[12.5px] text-ink-3 sm:pl-[90px]">
              {[d.moreFound > 0 && t("today.moreFound", { n: d.moreFound }), d.moreSkipped > 0 && t("today.moreSkipped", { n: d.moreSkipped }), d.hidden > 0 && t("today.moreEvents", { n: d.hidden })].filter(Boolean).join(" · ")}
              {" · "}<Link href="/app/opportunities" className="inline-flex min-h-10 items-center text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("today.allJobs")}</Link>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

export async function StatusDot({ status }: { status: string }) {
  const t = await getT();
  const active = status === "active";
  const label = ({ active: t("today.statusActive"), paused: t("today.statusPaused"), hired: t("today.statusHired"), expired: t("today.statusExpired") } as Record<string, string>)[status] ?? status;
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[.08em]", active || status === "hired" ? "border-green/20 bg-green-soft text-green" : status === "paused" ? "border-amber/20 bg-amber-soft text-[#6e4a0b]" : "border-stroke bg-white/70 text-ink-3")}>
      <span className={cx("size-2 rounded-full", active ? "bg-green animate-pulse-dot" : status === "hired" ? "bg-green" : status === "paused" ? "bg-amber" : "bg-ink-4")} aria-hidden />
      {label}
    </span>
  );
}

