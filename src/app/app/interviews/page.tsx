import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardCheck, MessageSquareText } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, Empty, PageHeader, Script, cx } from "@/components/ui";
import { ROUND_CHAIN, ROUND_LABEL, ROUND_TONE, IV_STATUS_LABEL, IV_STATUS_TONE } from "@/lib/rounds";
import { nowMs, relDays } from "./_components/format";

export const metadata = { title: "Интервью" };

type Row = Awaited<ReturnType<typeof load>>[number];
const load = (userId: string) =>
  db.interview.findMany({
    where: { userId },
    include: { opportunity: { include: { job: { select: { company: true, title: true, massHiring: true } } } }, _count: { select: { mocks: true } } },
    orderBy: { scheduledAt: "asc" },
  });

const TZ = "Asia/Almaty";
const day = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: TZ, weekday: "short", day: "numeric", month: "long" });
const time = (d: Date) => d.toLocaleTimeString("ru-RU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export default async function InterviewsPage() {
  const user = await requireUser();
  const all = await load(user.id);
  const now = nowMs();
  const upcoming = all.filter((i) => i.status === "upcoming");
  const past = all.filter((i) => i.status !== "upcoming").sort((a, b) => (b.scheduledAt?.getTime() ?? 0) - (a.scheduledAt?.getTime() ?? 0));
  // Interviews whose time has passed but that still wait for "How did it go?".
  const needDebrief = upcoming.filter((i) => i.round !== "assessment" && i.scheduledAt && i.scheduledAt.getTime() < now - 30 * 60000);
  const future = upcoming.filter((i) => !needDebrief.includes(i));
  const next = future.find((i) => i.round !== "assessment") ?? future[0];
  const rest = future.filter((i) => i !== next);
  const reached = (r: string) => new Set(all.filter((i) => i.round === r).map((i) => i.opportunityId)).size;
  const offers = await db.offer.count({ where: { userId: user.id } });

  return (
    <>
      <PageHeader
        eyebrow="Интервью"
        title={<>Ваши <Script>interviews</Script></>}
        sub="Каждое приглашение — отдельная комната подготовки: brief о компании, вероятные вопросы, Mock Interview и разбор после звонка."
      />

      {all.length === 0 ? (
        <Empty
          title="Интервью пока нет"
          sub="Как только работодатель пригласит на звонок или тест, агент сам создаст Interview Room — письмо распознаётся в Inbox."
          action={<ButtonLink href="/app/inbox" variant="glass" size="sm">Открыть Inbox</ButtonLink>}
        />
      ) : (
        <div className="flex flex-col gap-10">
          {needDebrief.map((iv) => (
            <Link
              key={iv.id}
              href={`/app/interviews/${iv.id}?tab=debrief`}
              className="flex animate-rise items-center gap-4 rounded-[22px] border border-green/20 bg-green-soft/70 px-5 py-4 transition hover:bg-green-soft focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
            >
              <MessageSquareText className="size-5 shrink-0 text-green" strokeWidth={1.7} aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-medium text-head">Как прошло интервью с {iv.opportunity.job.company}?</span>
                <span className="text-[13px] text-ink-3">Расскажите за минуту — получите разбор, план подготовки и follow-up письмо.</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
            </Link>
          ))}

          {next ? <NextUp iv={next} now={now} /> : null}

          {rest.length > 0 && (
            <section aria-labelledby="h-upcoming" className="animate-rise">
              <SectionTitle id="h-upcoming" title="Предстоящие" count={rest.length} />
              <ul className="grid gap-3 md:grid-cols-2">
                {rest.map((iv) => <UpcomingCard key={iv.id} iv={iv} now={now} />)}
              </ul>
            </section>
          )}

          {!next && !needDebrief.length && (
            <p className="glass px-5 py-6 text-[14px] text-ink-3">Сейчас нет запланированных интервью — агент продолжает подавать заявки.</p>
          )}

          <section aria-label="Воронка раундов" className="animate-rise">
            <SectionTitle id="h-chain" title="Путь до оффера" />
            <ol className="glass grid grid-cols-3 gap-px overflow-hidden !p-0 sm:grid-cols-6">
              {(["assessment", ...ROUND_CHAIN, "offer"] as const).map((r) => {
                const n = r === "offer" ? offers : reached(r);
                return (
                  <li key={r} className="flex flex-col gap-1.5 bg-white/40 px-4 py-3.5">
                    <span className="label !text-[9.5px]">{r === "offer" ? "Offer" : ROUND_LABEL[r]}</span>
                    <span className={cx("num text-[26px] leading-none", n ? (r === "offer" ? "text-green" : "text-head") : "text-ink-4")}>{n}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          {past.length > 0 && (
            <section aria-labelledby="h-past" className="animate-rise">
              <SectionTitle id="h-past" title="Прошедшие" count={past.length} />
              <ul className="glass divide-y divide-line overflow-hidden !p-0">
                {past.map((iv) => <PastRow key={iv.id} iv={iv} />)}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function SectionTitle({ id, title, count }: { id: string; title: string; count?: number }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 id={id} className="h-serif text-[24px]">{title}</h2>
      {count != null && <span className="num text-[14px] text-ink-3">{count}</span>}
    </div>
  );
}

/** The next interview as a designed moment: date, countdown, one clear action. */
function NextUp({ iv, now }: { iv: Row; now: number }) {
  const at = iv.scheduledAt;
  const isAssessment = iv.round === "assessment";
  const ms = at ? at.getTime() - now : null;
  const hours = ms != null ? Math.max(0, Math.round(ms / 3600000)) : null;
  const big = hours == null ? null : hours < 48 ? { n: hours, u: hours === 1 ? "час" : "ч" } : { n: Math.round(hours / 24), u: "дн." };
  return (
    <section aria-labelledby="h-next" className="animate-rise overflow-hidden rounded-[26px] bg-cta text-white shadow-(--shadow-cta)">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex min-w-0 flex-col gap-4">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.1em] text-white/55">
            <span aria-hidden className="size-1.5 rounded-full bg-[#7fe3b6] animate-pulse-dot" />
            {isAssessment ? "Ближайший тест" : "Следующее интервью"}
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 id="h-next" className="h-serif text-[clamp(34px,5vw,60px)] !text-white">{iv.opportunity.job.company}</h2>
            <p className="text-[16px] text-white/75">{iv.opportunity.job.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[.06em] text-[#7fe3b6]">{isAssessment ? "Assessment" : ROUND_LABEL[iv.round] ?? iv.round}</span>
            {at && (
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/85">
                <CalendarClock className="size-3.5" strokeWidth={1.7} aria-hidden />
                {isAssessment ? "до " : ""}{day(at)}, <span className="num">{time(at)}</span>
              </span>
            )}
            {iv._count.mocks > 0 && <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/70">Mock: {iv._count.mocks}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:items-end">
          {big && (
            <p className="flex items-baseline gap-2 lg:justify-end" aria-label={`${isAssessment ? "Осталось" : "Через"} ${big.n} ${big.u}`}>
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-white/50">{isAssessment ? "осталось" : "через"}</span>
              <span className="num text-[clamp(44px,6vw,72px)] leading-none">{big.n}</span>
              <span className="text-[18px] text-white/70">{big.u}</span>
            </p>
          )}
          <Link
            href={`/app/interviews/${iv.id}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#141414] transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]"
          >
            {isAssessment ? "Открыть Assessment Room" : "Prepare"}<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function UpcomingCard({ iv, now }: { iv: Row; now: number }) {
  const at = iv.scheduledAt;
  const isAssessment = iv.round === "assessment";
  const soon = at && at.getTime() - now < 2 * 86400000;
  return (
    <li className="glass group relative flex flex-col gap-4 p-5 transition hover:bg-white/85">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={`/app/interviews/${iv.id}`} className="truncate text-[17px] font-medium text-head after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-green">
            {iv.opportunity.job.company}
          </Link>
          <span className="truncate text-[13.5px] text-ink-3">{iv.opportunity.job.title}</span>
        </div>
        <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{isAssessment ? "Assessment" : ROUND_LABEL[iv.round] ?? iv.round}</Chip>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2 text-[13.5px] text-ink-2">
          {isAssessment ? <ClipboardCheck className="size-4 text-amber" strokeWidth={1.7} aria-hidden /> : <CalendarClock className="size-4 text-teal" strokeWidth={1.7} aria-hidden />}
          {at ? (
            <span>
              {isAssessment ? "до " : ""}{day(at)}, <span className="num">{time(at)}</span>
              <span className={cx("ml-1.5", soon ? "font-medium text-green" : "text-ink-3")}>· {relDays(at, now)}</span>
            </span>
          ) : (
            <span className="text-ink-3">Дата не назначена</span>
          )}
        </div>
        <span className="relative z-10 inline-flex items-center gap-1 text-[13px] font-medium text-head" aria-hidden>
          Prepare<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
        </span>
      </div>
    </li>
  );
}

function PastRow({ iv }: { iv: Row }) {
  const perf = j<{ performance?: number }>(iv.debrief, {}).performance;
  return (
    <li className="relative flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-white/60 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/app/interviews/${iv.id}?tab=debrief`} className="min-w-0 truncate text-[15.5px] font-medium text-head after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-green">
          {iv.opportunity.job.company} <span className="font-normal text-ink-3">· {iv.opportunity.job.title}</span>
        </Link>
        <span className="text-[12.5px] text-ink-3">{iv.scheduledAt ? day(iv.scheduledAt) : "—"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{ROUND_LABEL[iv.round] ?? iv.round}</Chip>
        <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
        {typeof perf === "number" && <Chip tone="dark"><span className="num">{perf}</span>/100</Chip>}
      </div>
    </li>
  );
}

