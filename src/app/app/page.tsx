import Link from "next/link";
import { ArrowRight, BadgeDollarSign, CalendarClock, ClipboardCheck, ListChecks, ShieldCheck, X } from "lucide-react";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { currentCampaign, type NeedsYou } from "@/lib/ops-data";
import { maybeSimulateEmployers } from "@/lib/engine/simulation";
import { ENABLE_AUTOSUBMIT, needsYouCached } from "../_components/global-needs";
import { ago } from "@/lib/ops";
import { ButtonLink, Card, Chip, Label, Script, cx } from "@/components/ui";
import { dayKey, doingNowT, goalLineT, greetingKey, loadToday, todaySentenceT, type Today } from "./_components/today-data";
import { GuaranteeBanner } from "./_components/guarantee-banner";
import { KeyNumbers, NextActionCard, StageBar, StatusDot, Timeline, TodayStrip, type NextAction } from "./_components/today";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("meta.today") };
}

const HOUR = 3600000;

function relDay(t: T, d: Date, now: number) {
  const k = dayKey(d);
  if (k === dayKey(new Date(now))) return t("today.today");
  if (k === dayKey(new Date(now + 24 * HOUR))) return t("today.tomorrow");
  return t.date(d, "dayMonth");
}

/**
 * Today's finds as one sentence from the engine (todaySentence = discoverySentence, zero parts hidden), plus the
 * submissions of the day — they include roles found earlier, so they are said separately.
 */
function todayStory(t: T, d: Today) {
  const sent = d.today.submitted ? ` ${t("today.submittedToday", { n: d.today.submitted })}` : "";
  return `${todaySentenceT(t, d.todayBreakdown)}${sent}`;
}

/** One thing the user should do next — or nothing at all. */
function pickNext(t: T, d: Today, n: NeedsYou): { action: NextAction; also: { label: string; href: string }[] } {
  const cands: NonNullable<NextAction>[] = [];
  const offer = d.offers[0];
  if (offer) cands.push({ eyebrow: t("today.offerEyebrow"), title: t("today.offerTitle", { company: offer.company }), sub: t("today.offerSub", { role: offer.role }), href: "/app/offers", cta: t("today.offerCta"), icon: BadgeDollarSign });

  const interviews = d.upcoming.filter((i) => i.round !== "assessment");
  // Open assessments only (deadline not passed) — the same rule as needsYou.assessments.
  const assessments = d.upcoming.filter((i) => i.round === "assessment" && (!i.scheduledAt || i.scheduledAt.getTime() >= d.now));
  const soonIv = interviews.find((i) => i.scheduledAt && i.scheduledAt.getTime() - d.now <= 48 * HOUR);
  const iv = (i: (typeof interviews)[number], eyebrow: string): NonNullable<NextAction> => ({
    eyebrow,
    title: i.scheduledAt ? t("today.interviewTitleWhen", { when: relDay(t, i.scheduledAt, d.now), company: i.opportunity.job.company }) : t("today.interviewTitle", { company: i.opportunity.job.company }),
    sub: i.scheduledAt ? t("today.interviewSubTime", { title: i.opportunity.job.title, time: t.time(i.scheduledAt) }) : t("today.interviewSub", { title: i.opportunity.job.title }),
    href: `/app/interviews/${i.id}`, cta: t("today.prepare"), icon: CalendarClock,
  });
  if (soonIv) cands.push(iv(soonIv, t("today.interviewEyebrow")));
  // needsYou.assessments is 0 when assessments are not the user's task (simulation: they progress on their own).
  const a = n.assessments ? assessments[0] : undefined;
  if (a) cands.push({
    eyebrow: t("today.assessmentEyebrow"),
    title: t("today.assessmentTitle", { company: a.opportunity.job.company }),
    sub: a.scheduledAt ? t("today.assessmentSubDeadline", { deadline: t("today.deadline", { date: t.date(a.scheduledAt, "weekdayDayMonth"), time: t.time(a.scheduledAt) }) }) : t("today.assessmentSub"),
    href: `/app/interviews/${a.id}`, cta: t("today.prepare"), icon: ClipboardCheck,
  });
  // Queue numbers come from needsYou (src/lib/ops-data.ts) — the same as Opportunities, Applications and Inbox.
  if (n.questions) cands.push({
    eyebrow: t("today.questionsEyebrow"),
    title: t("today.questionsTitle", { n: n.questions }),
    sub: t("today.questionsSub"),
    href: "/app/approvals", cta: t("today.answer"), icon: ShieldCheck,
  });
  if (n.handoffs) cands.push({
    eyebrow: t("today.handoffsEyebrow"),
    title: t("today.handoffsTitle", { n: n.handoffs }),
    sub: t("today.handoffsSub"),
    href: "/app/approvals#kind-handoff", cta: t("today.open"), icon: ShieldCheck,
  });
  if (n.applyDecisions) cands.push({
    eyebrow: t("today.decisionsEyebrow"),
    title: t("today.decisionsTitle", { n: n.applyDecisions }),
    sub: t("today.decisionsSub"),
    href: "/app/opportunities", cta: t("today.decide"), icon: ListChecks,
  });
  const later = interviews.find((i) => i !== soonIv);
  if (later) cands.push(iv(later, t("today.interviewSoonEyebrow")));

  if (n.enableAutoSubmit) cands.unshift({
    eyebrow: t("today.autosubmitEyebrow"),
    title: t("today.autosubmitTitle"),
    sub: t("today.autosubmitSub"),
    href: ENABLE_AUTOSUBMIT.href, cta: t("today.enable"), icon: ShieldCheck,
  });
  const [action, ...rest] = cands;
  return { action: action ?? null, also: rest.slice(0, 3).map((c) => ({ label: c.title, href: c.href })) };
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, user, t] = await Promise.all([searchParams, requireUser(), getT()]);
  const firstName = user.name.split(" ")[0] || user.name;
  const campaign = await currentCampaign(user.id);
  if (!campaign) return <NoCampaign userId={user.id} firstName={firstName} hasGoal={Boolean(user.goal?.primaryRole)} hasCv={Boolean(user.profile?.cvText || user.profile?.summary)} />;

  await maybeSimulateEmployers(user.id); // employer replies that became due (simulation mode; guarded, no-op in live mode)
  const [d, waiting] = await Promise.all([loadToday(user, campaign), needsYouCached(user.id)]);
  const { action, also } = pickNext(t, d, waiting);
  const status = campaign.status;
  const isActive = status === "active";
  const td = d.today;
  const tagline = ({ active: t("today.taglineActive"), paused: t("today.taglinePaused"), hired: t("today.taglineHired"), expired: t("today.taglineExpired") } as Record<string, string>)[status] ?? t("today.taglineActive");
  const goalLine = goalLineT(t, user.goal);
  const doing = doingNowT(t, status, d.doingInput.regions, d.doingInput.findJobs, d.doingInput.personalize);
  const stageValues = { ...d.stageValues, hired: d.stageValues.hired ? t("today.yes") : "" };
  const b = (c: React.ReactNode) => <span className="num text-head">{c}</span>;

  const story = todayStory(t, d);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Today</h1>
      <GuaranteeBanner campaign={campaign} />

      {sp.started === "1" && (
        <section role="status" aria-labelledby="started-h" className="relative animate-rise overflow-hidden rounded-[var(--radius-card)] border border-green/20 bg-white/90 p-4 shadow-(--shadow-glass) sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full border border-green/15" />
          <div aria-hidden className="pointer-events-none absolute -right-4 -top-4 size-32 rounded-full border border-green/20" />
          <div className="relative flex items-start gap-4">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-green animate-pulse-dot" aria-hidden />
            <div className="flex-1">
              <span className="font-mono text-[11px] uppercase tracking-[.1em] text-green">{t("today.paidEyebrow")}</span>
              <h2 id="started-h" className="h-serif mt-1.5 text-[clamp(26px,3vw,34px)]">{t.rich("today.launched", {}, { s: (c) => <Script>{c}</Script> })}</h2>
              {/* Phones: one short line, so «Следующий шаг» stays above the fold on the first visit. */}
              <p className="mt-1.5 text-[14px] text-ink-2 sm:hidden">{t("today.launchedShort")}</p>
              <p className="mt-2 hidden max-w-2xl text-[14.5px] text-ink-2 sm:block">
                {t("today.launchedFirst")}{d.todayBreakdown.found ? t.rich("today.launchedFound", { n: d.todayBreakdown.found }, { b }) : ""}
                {td.submitted ? t.rich("today.launchedSent", { n: td.submitted }, { b }) : ""}.{" "}
                {t("today.launchedRest", { n: campaign.dailyLimit })}
              </p>
            </div>
            <Link href="/app" scroll={false} className="grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label={t("today.hideMessage")}><X className="size-4" aria-hidden /></Link>
          </div>
        </section>
      )}

      {/*
        Mobile order: greeting → «Следующий шаг» → what the agent is doing. On desktop the greeting and the details are two
        halves of one card in the left column (joined edges), and «Следующий шаг» sits on the right spanning both rows.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <section aria-label={t("today.statusAria")} className="glass-strong relative flex animate-rise flex-col gap-6 p-5 sm:p-8 lg:col-start-1 lg:row-start-1 lg:!rounded-b-none lg:!border-b-0 lg:pb-3 lg:!shadow-none">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={status} />
            <span className="label">{t.rich("today.campaignDay", { day: String(d.clock.day), total: String(d.clock.total) }, { b })}</span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="h-serif text-[clamp(32px,4.6vw,54px)]">{t(`today.${greetingKey()}`)}, <Script>{firstName}</Script>.</p>
            <p className="h-serif pb-[0.12em] text-[clamp(22px,2.6vw,30px)] !leading-[1.2] !text-teal">{tagline}</p>
          </div>
        </section>

        <NextActionCard action={action} also={also} paused={status === "paused"} className="animate-rise lg:col-start-2 lg:row-span-2 lg:row-start-1" />

        <section aria-label={t("today.doingAria")} className="glass-strong flex animate-rise flex-col gap-6 p-5 sm:p-8 lg:col-start-1 lg:row-start-2 lg:-mt-5 lg:!rounded-t-none lg:!border-t-0 lg:pt-4">
          {goalLine && (
            <Link href="/app/goal" className="group -my-2.5 inline-flex min-h-10 w-fit max-w-full items-center gap-2 rounded py-1 font-mono text-[11.5px] uppercase tracking-[.08em] text-ink-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
              <span className="text-ink-4">{t("today.goal")}</span><span className="min-w-0 break-words">{goalLine}</span>
            </Link>
          )}
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <p className="flex items-start gap-2.5 text-[15px] text-head">
              <span className={cx("mt-[7px] size-2 shrink-0 rounded-full", isActive ? "bg-green animate-pulse-dot" : "bg-ink-4")} aria-hidden />
              {doing}
            </p>
            {story && <p className="text-[14.5px] leading-relaxed text-ink-2">{story}{!action && isActive ? ` ${t("today.nothingToDo")}` : ""}</p>}
          </div>
        </section>
      </div>

      <Card className="flex animate-rise flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label>{t("today.whereNow")}</Label>
          <Link href="/app/applications" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-teal hover:text-head">{t("nav.applications")} <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        {/* «в процессе» only with a round / open test still ahead (interviewCounts via loadToday), never for a past one. */}
        <StageBar stage={d.stage} values={stageValues} open={d.stageOpen} openCount={{ assessments: d.interviews.assessments, interviews: d.interviews.upcoming, offers: d.offers.length }} />
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          <KeyNumbers t={d.totals} />
          <TodayStrip d={{ found: d.todayBreakdown.found, qualified: d.todayBreakdown.qualified, submitted: td.submitted, responses: td.responses }} />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="h-serif text-[26px]">{t.rich("today.agentToday", {}, { s: (c) => <Script>{c}</Script> })}</h2>
          {campaign.lastRunAt && <span className="text-[12.5px] text-ink-3">{t("today.lastCycle", { ago: t.locale === "ru" ? ago(campaign.lastRunAt) : t.ago(campaign.lastRunAt) })}</span>}
        </div>
        <Timeline days={d.timeline} now={d.now} />
      </Card>

    </div>
  );
}

async function NoCampaign({ userId, firstName, hasGoal, hasCv }: { userId: string; firstName: string; hasGoal: boolean; hasCv: boolean }) {
  const [facts, invoice] = await Promise.all([
    db.fact.count({ where: { userId } }),
    db.payment.findFirst({ where: { userId, provider: { in: ["kaspi", "kaspi_mock"] }, status: "pending" }, orderBy: { createdAt: "desc" }, select: { externalId: true, meta: true } }),
  ]);
  const t = await getT();
  const openInvoice = invoice?.externalId && new Date(j<{ expiresAt?: string }>(invoice.meta, {}).expiresAt ?? 0).getTime() > (await nowMs()) ? invoice.externalId : null;
  const steps = [
    { n: "01", title: t("today.step1Title"), sub: t("today.step1Sub"), href: "/app/profile", done: hasCv || facts > 0 },
    { n: "02", title: t("today.step2Title"), sub: t("today.step2Sub"), href: "/app/goal", done: hasGoal },
    { n: "03", title: t("today.step3Title"), sub: t("today.step3Sub"), href: "/app/campaign", done: false },
  ];
  const next = steps.find((s) => !s.done)!;
  return (
    <div className="flex flex-col gap-6">
      <Card strong className="flex animate-rise flex-col gap-8 p-6 sm:p-10">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink-4" aria-hidden /><Label>{t("today.notStarted")}</Label></span>
          <h1 className="h-serif text-[clamp(32px,4.4vw,52px)]">{t(`today.${greetingKey()}`)}, <Script>{firstName}</Script>.</h1>
          <p className="h-serif text-[clamp(20px,2.4vw,28px)] !text-teal">{t("today.noCampaignTagline")}</p>
          <p className="text-[15px] text-ink-2">{t("today.noCampaignText")}</p>
        </div>
        {openInvoice && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber/20 bg-amber-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-ink-2">{t.rich("today.invoice", { id: openInvoice }, { b: (c) => <span className="font-mono text-[12.5px] text-head">{c}</span> })}</p>
            <ButtonLink href={`/pay/kaspi/${openInvoice}`} size="sm">{t("today.continuePayment")}</ButtonLink>
          </div>
        )}
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <Link href={s.href} className="group flex h-full flex-col gap-3 rounded-2xl border border-stroke bg-white/60 p-5 transition-all hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                <span className="flex items-center justify-between">
                  <span className="num text-[13px] text-ink-4">{s.n}</span>
                  {s.done ? <Chip tone="green" dot>{t("common.done")}</Chip> : <ArrowRight className="size-4 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </span>
                <span className="h-serif text-[21px]">{s.title}</span>
                <span className="text-[13.5px] text-ink-3">{s.sub}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href={next.href} size="lg">{next.href === "/app/campaign" ? t("today.startCampaign") : t("today.nextStepTo", { title: next.title })}<ArrowRight className="size-4" aria-hidden /></ButtonLink>
        </div>
      </Card>
    </div>
  );
}

async function nowMs() {
  return Date.now();
}
