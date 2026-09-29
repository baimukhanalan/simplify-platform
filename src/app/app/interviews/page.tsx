import Link from "next/link";
import { ArrowRight, CalendarClock, ClipboardCheck, MessageSquareText, TriangleAlert } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, Empty, PageHeader, Script, cx } from "@/components/ui";
import { ROUND_CHAIN, ROUND_TONE, IV_STATUS_TONE } from "@/lib/rounds";
import { interviewCounts, visibleInterviewScope, visibleLinkedScope } from "@/lib/ops-data";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";
import { deadlineTextT, ivStatusName, nowMs, relDaysT, roundName } from "./_components/format";

export async function generateMetadata() {
  return { title: (await getT())("interviewsPage.metaTitle") };
}

type Row = Awaited<ReturnType<typeof load>>[number];
const load = (userId: string) =>
  db.interview.findMany({
    where: { userId, ...visibleInterviewScope() },
    include: { opportunity: { include: { job: { select: { company: true, title: true, massHiring: true } } } }, _count: { select: { mocks: true } } },
    orderBy: { scheduledAt: "asc" },
  });

const day = (t: T, d: Date) => t.date(d, "weekdayDayMonth");

export default async function InterviewsPage() {
  const [user, t] = await Promise.all([requireUser(), getT()]);
  const all = await load(user.id);
  const now = nowMs();
  // One rule with interviewCounts (lib/ops-data): a round is upcoming only while its time is ahead; a passed round still
  // marked upcoming waits for «Как прошло?»; an assessment whose deadline passed is no longer open.
  const ic = await interviewCounts(user.id, new Date(now));
  const isPast = (i: Row) => i.scheduledAt != null && i.scheduledAt.getTime() < now;
  const upcoming = all.filter((i) => i.status === "upcoming");
  const needDebrief = upcoming.filter((i) => i.round !== "assessment" && isPast(i));
  const expired = upcoming.filter((i) => i.round === "assessment" && isPast(i));
  const future = upcoming.filter((i) => !isPast(i));
  const past = [...all.filter((i) => i.status !== "upcoming"), ...expired].sort((a, b) => (b.scheduledAt?.getTime() ?? 0) - (a.scheduledAt?.getTime() ?? 0));
  const summary = [
    ic.upcoming > 0 && t("interviewsPage.list.summaryUpcoming", { n: ic.upcoming }),
    ic.assessments > 0 && t("interviewsPage.list.summaryAssessments", { n: ic.assessments }),
    ic.awaitingDebrief > 0 && t("interviewsPage.list.summaryDebrief", { n: ic.awaitingDebrief }),
  ].filter(Boolean).join(" · ");
  const next = future.find((i) => i.round !== "assessment") ?? future[0];
  const rest = future.filter((i) => i !== next);
  const reached = (r: string) => new Set(all.filter((i) => i.round === r).map((i) => i.opportunityId)).size;
  const offers = await db.offer.count({ where: { userId: user.id, ...visibleLinkedScope() } });
  // Two live calls within an hour of each other: one of them has to move.
  const calls = future.filter((i) => i.round !== "assessment" && i.scheduledAt);
  const conflicts = calls.flatMap((a, k) => calls.slice(k + 1).filter((b) => Math.abs(b.scheduledAt!.getTime() - a.scheduledAt!.getTime()) < 3600000).map((b) => [a, b] as const));

  return (
    <>
      <PageHeader
        eyebrow={t("interviewsPage.list.eyebrow")}
        title={t.rich("interviewsPage.list.title", {}, { s: (c) => <Script>{c}</Script> })}
        sub={t("interviewsPage.list.sub")}
      />
      {summary && <p className="-mt-3 mb-6 text-[14px] text-ink-2">{summary.charAt(0).toUpperCase() + summary.slice(1)}.</p>}

      {all.length === 0 ? (
        <Empty
          title={t("interviewsPage.list.emptyTitle")}
          sub={t("interviewsPage.list.emptySub")}
          action={<ButtonLink href="/app/inbox" variant="glass" size="sm" className="!h-10">{t("interviewsPage.list.openInbox")}</ButtonLink>}
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
                <span className="text-[15px] font-medium text-head">{t("interviewsPage.list.debriefPrompt", { company: iv.opportunity.job.company })}</span>
                <span className="text-[13px] text-ink-3">{t("interviewsPage.list.debriefSub")}</span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
            </Link>
          ))}

          {conflicts.length > 0 && (
            <div role="alert" className="flex animate-rise flex-col gap-1.5 rounded-2xl border border-amber/25 bg-amber-soft px-4 py-3.5 text-[14px] text-ink-2">
              {conflicts.map(([a, b]) => (
                <p key={`${a.id}-${b.id}`} className="flex items-start gap-2.5">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
                  <span>
                    <span className="font-medium text-head">{t("interviewsPage.list.conflictLabel")}</span>{" "}
                    {t.rich(
                      t.time(a.scheduledAt!) !== t.time(b.scheduledAt!) ? "interviewsPage.list.conflictTwo" : "interviewsPage.list.conflictSame",
                      { a: a.opportunity.job.company, b: b.opportunity.job.company, day: day(t, a.scheduledAt!), time: t.time(a.scheduledAt!), time2: t.time(b.scheduledAt!) },
                      { n: (c) => <span className="num">{c}</span> },
                    )}{" "}
                    {t("interviewsPage.list.conflictAsk")}
                  </span>
                </p>
              ))}
            </div>
          )}

          {next ? <NextUp t={t} iv={next} now={now} /> : null}

          {rest.length > 0 && (
            <section aria-labelledby="h-upcoming" className="animate-rise">
              <SectionTitle id="h-upcoming" title={t("interviewsPage.list.upcoming")} count={rest.length} />
              <ul className="grid gap-3 md:grid-cols-2">
                {rest.map((iv) => <UpcomingCard key={iv.id} t={t} iv={iv} now={now} />)}
              </ul>
            </section>
          )}

          {!next && !needDebrief.length && (
            <p className="glass px-5 py-6 text-[14px] text-ink-3">{t("interviewsPage.list.nothingScheduled")}</p>
          )}

          <section aria-label={t("interviewsPage.list.funnelAria")} className="animate-rise">
            <SectionTitle id="h-chain" title={t("interviewsPage.list.funnelTitle")} />
            <ol className="glass grid grid-cols-3 gap-px overflow-hidden !p-0 sm:grid-cols-6">
              {(["assessment", ...ROUND_CHAIN, "offer"] as const).map((r) => {
                const n = r === "offer" ? offers : reached(r);
                return (
                  <li key={r} className="flex flex-col gap-1.5 bg-white/40 px-4 py-3.5">
                    <span className="label !text-[11px]">{roundName(t, r)}</span>
                    <span className={cx("num text-[26px] leading-none", n ? (r === "offer" ? "text-green" : "text-head") : "text-ink-4")}>{n}</span>
                  </li>
                );
              })}
            </ol>
          </section>

          {past.length > 0 && (
            <section aria-labelledby="h-past" className="animate-rise">
              <SectionTitle id="h-past" title={t("interviewsPage.list.past")} count={past.length} />
              <ul className="glass divide-y divide-line overflow-hidden !p-0">
                {past.map((iv) => <PastRow key={iv.id} t={t} iv={iv} />)}
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
function NextUp({ t, iv, now }: { t: T; iv: Row; now: number }) {
  const at = iv.scheduledAt;
  const isAssessment = iv.round === "assessment";
  const ms = at ? at.getTime() - now : null;
  const hours = ms != null ? Math.max(0, Math.round(ms / 3600000)) : null;
  const big = hours == null ? null : hours < 48 ? { n: hours, u: t("interviewsPage.format.hoursUnit", { n: hours }) } : { n: Math.round(hours / 24), u: t("interviewsPage.format.daysUnit", { n: Math.round(hours / 24) }) };
  return (
    <section aria-labelledby="h-next" className="animate-rise overflow-hidden rounded-[26px] bg-cta text-white shadow-(--shadow-cta)">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="flex min-w-0 flex-col gap-4">
          <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.1em] text-white/55">
            <span aria-hidden className="size-1.5 rounded-full bg-[#7fe3b6] animate-pulse-dot" />
            {isAssessment ? t("interviewsPage.list.nextAssessment") : t("interviewsPage.list.nextInterview")}
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 id="h-next" className="h-serif text-[clamp(34px,5vw,60px)] !text-white">{iv.opportunity.job.company}</h2>
            <p className="text-[16px] text-white/75">{iv.opportunity.job.title}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] uppercase tracking-[.06em] text-[#7fe3b6]">{roundName(t, iv.round)}</span>
            {at && (
              <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/85">
                <CalendarClock className="size-3.5" strokeWidth={1.7} aria-hidden />
                {isAssessment ? deadlineTextT(t, at) : <>{day(t, at)}, <span className="num">{t.time(at)}</span></>}
              </span>
            )}
            {iv._count.mocks > 0 && <span className="rounded-full bg-white/10 px-3 py-1 text-[13px] text-white/70">{t("interviewsPage.list.mocks", { n: iv._count.mocks })}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-4 lg:items-end">
          {big && (
            // Real spaces between the parts (flex gap is visual only), so copied/read text is «через 2 дн.», not «через2дн.».
            <p className="flex items-baseline gap-2 lg:justify-end">
              <span className="font-mono text-[11px] uppercase tracking-[.08em] text-white/50">{isAssessment ? t("interviewsPage.list.left") : t("interviewsPage.list.in")}</span>{" "}
              <span className="num text-[clamp(44px,6vw,72px)] leading-none">{big.n}</span>{"\u00a0"}
              <span className="text-[18px] text-white/70">{big.u}</span>
            </p>
          )}
          <Link
            href={`/app/interviews/${iv.id}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-[#141414] transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#7fe3b6]"
          >
            {isAssessment ? t("interviewsPage.list.openAssessment") : t("interviewsPage.list.prepare")}<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

function UpcomingCard({ t, iv, now }: { t: T; iv: Row; now: number }) {
  const at = iv.scheduledAt;
  const isAssessment = iv.round === "assessment";
  const soon = at && at.getTime() - now < 2 * 86400000;
  return (
    <li className="glass group relative flex flex-col gap-4 p-5 transition hover:bg-white/85">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link href={`/app/interviews/${iv.id}`} className="-my-2 block truncate py-2 text-[17px] font-medium text-head after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-green">
            {iv.opportunity.job.company}
          </Link>
          <span className="truncate text-[13.5px] text-ink-3">{iv.opportunity.job.title}</span>
        </div>
        <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{roundName(t, iv.round)}</Chip>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-center gap-2 text-[13.5px] text-ink-2">
          {isAssessment ? <ClipboardCheck className="size-4 text-amber" strokeWidth={1.7} aria-hidden /> : <CalendarClock className="size-4 text-teal" strokeWidth={1.7} aria-hidden />}
          {at ? (
            <span>
              {isAssessment ? deadlineTextT(t, at) : <>{day(t, at)}, <span className="num">{t.time(at)}</span></>}{" "}
              <span className={soon ? "font-medium text-green" : "text-ink-3"}>· {relDaysT(t, at, now)}</span>
            </span>
          ) : (
            <span className="text-ink-3">{t("interviewsPage.format.noDate")}</span>
          )}
        </div>
        <span className="relative z-10 inline-flex items-center gap-1 text-[13px] font-medium text-head" aria-hidden>
          {t("interviewsPage.list.prepare")}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} />
        </span>
      </div>
    </li>
  );
}

function PastRow({ t, iv }: { t: T; iv: Row }) {
  const perf = j<{ performance?: number }>(iv.debrief, {}).performance;
  return (
    <li className="relative flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-white/60 sm:flex-row sm:items-center sm:gap-5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={`/app/interviews/${iv.id}?tab=debrief`} className="-my-2.5 block min-w-0 truncate py-2.5 text-[15.5px] font-medium text-head after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-green">
          {iv.opportunity.job.company} <span className="font-normal text-ink-3">· {iv.opportunity.job.title}</span>
        </Link>
        <span className="text-[12.5px] text-ink-3">{iv.scheduledAt ? day(t, iv.scheduledAt) : "—"}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={ROUND_TONE[iv.round] ?? "neutral"}>{roundName(t, iv.round)}</Chip>
        {iv.status === "upcoming" ? (
          // An assessment whose deadline passed without a result.
          <Chip tone="neutral">{ivStatusName(t, "expired")}</Chip>
        ) : (
          <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"}>{ivStatusName(t, iv.status)}</Chip>
        )}
        {typeof perf === "number" && <Chip tone="dark"><span className="num">{perf}</span>/100</Chip>}
      </div>
    </li>
  );
}

