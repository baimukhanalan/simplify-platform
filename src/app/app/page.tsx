import Link from "next/link";
import { ArrowRight, BadgeDollarSign, CalendarClock, ClipboardCheck, Play, ShieldCheck, Sparkles, X } from "lucide-react";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { runAgentNow, simulateEmployers } from "@/lib/actions/campaign";
import { demoToolsEnabled } from "@/lib/demo";
import { currentCampaign } from "@/lib/ops-data";
import { ago } from "@/lib/ops";
import { ButtonLink, Card, Chip, Label, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { dayKey, greeting, hhmm, loadToday, type Today } from "./_components/today-data";
import { KeyNumbers, NextActionCard, StageBar, StatusDot, Timeline, TodayStrip, type NextAction } from "./_components/today";
import { plural } from "../_components/ru";

export const metadata: Metadata = { title: "Today" };

const HOUR = 3600000;

function relDay(d: Date, now: number) {
  const k = dayKey(d);
  if (k === dayKey(new Date(now))) return "сегодня";
  if (k === dayKey(new Date(now + 24 * HOUR))) return "завтра";
  return d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" });
}

/** One thing the user should do next — or nothing at all. */
function pickNext(d: Today): { action: NextAction; also: { label: string; href: string }[] } {
  const cands: NonNullable<NextAction>[] = [];
  const offer = d.offers[0];
  if (offer) cands.push({ eyebrow: "Offer", title: `Оффер от ${offer.company}`, sub: `${offer.role}. Разберём цифры и переговоры вместе.`, href: "/app/offers", cta: "Review offer", icon: BadgeDollarSign });

  const interviews = d.upcoming.filter((i) => i.round !== "assessment");
  const assessments = d.upcoming.filter((i) => i.round === "assessment");
  const soonIv = interviews.find((i) => i.scheduledAt && i.scheduledAt.getTime() - d.now <= 48 * HOUR);
  const iv = (i: (typeof interviews)[number], eyebrow: string): NonNullable<NextAction> => ({
    eyebrow,
    title: i.scheduledAt ? `Интервью ${relDay(i.scheduledAt, d.now)} — ${i.opportunity.job.company}` : `Интервью — ${i.opportunity.job.company}`,
    sub: `${i.opportunity.job.title}${i.scheduledAt ? ` · ${hhmm(i.scheduledAt)}` : ""}. Interview Pack уже готов.`,
    href: `/app/interviews/${i.id}`, cta: "Prepare", icon: CalendarClock,
  });
  if (soonIv) cands.push(iv(soonIv, "Interview"));
  const a = assessments[0];
  if (a) cands.push({
    eyebrow: "Assessment",
    title: `Assessment от ${a.opportunity.job.company}`,
    sub: a.scheduledAt ? `Дедлайн: ${a.scheduledAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" })}. Ты на следующем этапе.` : "Ты на следующем этапе.",
    href: `/app/interviews/${a.id}`, cta: "Start preparation", icon: ClipboardCheck,
  });
  if (d.approvals) cands.push({
    eyebrow: "Нужен твой ответ",
    title: `${d.approvals} ${plural(d.approvals, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} тебя`,
    sub: "Без этого агент не может отправить часть заявок. Остальное он делает сам.",
    href: "/app/approvals", cta: "Answer", icon: ShieldCheck,
  });
  const later = interviews.find((i) => i !== soonIv);
  if (later) cands.push(iv(later, "Скоро интервью"));

  const [action, ...rest] = cands;
  return { action: action ?? null, also: rest.slice(0, 3).map((c) => ({ label: c.title, href: c.href })) };
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const firstName = user.name.split(" ")[0] || user.name;
  const campaign = await currentCampaign(user.id);
  if (!campaign) return <NoCampaign userId={user.id} firstName={firstName} hasGoal={Boolean(user.goal?.primaryRole)} hasCv={Boolean(user.profile?.cvText || user.profile?.summary)} />;

  const d = await loadToday(user, campaign);
  const { action, also } = pickNext(d);
  const status = campaign.status;
  const isActive = status === "active";
  const t = d.today;
  const tagline = { active: "Your agent is working.", paused: "Your agent is paused.", hired: "You got hired.", expired: "Your campaign is complete." }[status] ?? "Your agent is working.";
  const demo = demoToolsEnabled(user);

  const story = t.found || t.submitted
    ? [
        t.found ? `Сегодня агент нашёл ${t.found} ${plural(t.found, ["вакансию", "вакансии", "вакансий"])}.` : "Новых вакансий сегодня пока нет.",
        t.found ? `${t.qualified} ${plural(t.qualified, ["подошла", "подошли", "подошли"])}.` : "",
        t.strong ? `${t.strong} ${plural(t.strong, ["была достаточно сильной", "были достаточно сильными", "были достаточно сильными"])} (Match ≥ ${d.strongThreshold}%).` : "",
        t.submitted ? `${t.submitted} ${plural(t.submitted, ["заявка уже отправлена", "заявки уже отправлены", "заявок уже отправлены"])}.` : "",
      ].filter(Boolean).join(" ")
    : isActive
      ? "Сегодня агент ещё не нашёл новых вакансий — он проверяет рынок по расписанию."
      : "";

  return (
    <div className="flex flex-col gap-5">
      <h1 className="sr-only">Today</h1>

      {sp.started === "1" && (
        <section role="status" aria-labelledby="started-h" className="relative animate-rise overflow-hidden rounded-[var(--radius-card)] border border-green/20 bg-white/90 p-5 shadow-(--shadow-glass) sm:p-7">
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full border border-green/15" />
          <div aria-hidden className="pointer-events-none absolute -right-4 -top-4 size-32 rounded-full border border-green/20" />
          <div className="relative flex items-start gap-4">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-green animate-pulse-dot" aria-hidden />
            <div className="flex-1">
              <span className="font-mono text-[10.5px] uppercase tracking-[.1em] text-green">Kaspi Pay · оплачено</span>
              <h2 id="started-h" className="h-serif mt-1.5 text-[clamp(26px,3vw,34px)]">Кампания <Script>запущена</Script>.</h2>
              <p className="mt-2 max-w-2xl text-[14.5px] text-ink-2">
                Агент уже провёл первый цикл{t.found ? <>: нашёл <span className="num text-head">{t.found}</span> {plural(t.found, ["вакансию", "вакансии", "вакансий"])}</> : ""}
                {t.submitted ? <> и отправил <span className="num text-head">{t.submitted}</span> {plural(t.submitted, ["заявку", "заявки", "заявок"])}</> : ""}.
                Дальше он работает сам — каждый день, до {campaign.dailyLimit} {plural(campaign.dailyLimit, ["заявки", "заявок", "заявок"])}. Мы позовём тебя, только когда без тебя нельзя.
              </p>
            </div>
            <Link href="/app" scroll={false} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label="Скрыть сообщение"><X className="size-4" aria-hidden /></Link>
          </div>
        </section>
      )}

      {/*
        Mobile order: greeting → Next action → what the agent is doing. On desktop the greeting and the details are two
        halves of one card in the left column (joined edges), and Next action sits on the right spanning both rows.
      */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:grid-rows-[auto_1fr]">
        <section aria-label="Статус кампании" className="glass-strong relative flex animate-rise flex-col gap-6 overflow-hidden p-5 sm:p-8 lg:col-start-1 lg:row-start-1 lg:!rounded-b-none lg:!border-b-0 lg:pb-0 lg:!shadow-none">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusDot status={status} />
            <span className="label">Campaign Day <span className="num text-head">{d.clock.day}</span> / {d.clock.total}</span>
          </div>
          <div className="flex flex-col gap-2">
            <p className="h-serif text-[clamp(32px,4.6vw,54px)]">{greeting()}, <Script>{firstName}</Script>.</p>
            <p className="h-serif text-[clamp(22px,2.6vw,30px)] !text-teal">{tagline}</p>
          </div>
        </section>

        <NextActionCard action={action} also={also} paused={status === "paused"} className="animate-rise lg:col-start-2 lg:row-span-2 lg:row-start-1" />

        <section aria-label="Что делает агент" className="glass-strong flex animate-rise flex-col gap-6 p-5 sm:p-8 lg:col-start-1 lg:row-start-2 lg:-mt-5 lg:!rounded-t-none lg:!border-t-0 lg:pt-6">
          {d.goalLine && (
            <Link href="/app/goal" className="group inline-flex w-fit max-w-full items-center gap-2 font-mono text-[11.5px] uppercase tracking-[.08em] text-ink-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
              <span className="text-ink-4">Goal</span><span className="min-w-0 break-words">{d.goalLine}</span>
            </Link>
          )}
          <div className="flex flex-col gap-3 border-t border-line pt-5">
            <p className="flex items-start gap-2.5 text-[15px] text-head">
              <span className={cx("mt-[7px] size-2 shrink-0 rounded-full", isActive ? "bg-green animate-pulse-dot" : "bg-ink-4")} aria-hidden />
              {d.doing}
            </p>
            {story && <p className="text-[14.5px] leading-relaxed text-ink-2">{story}{!action && isActive ? " Тебе ничего делать не нужно." : ""}</p>}
          </div>
        </section>
      </div>

      <Card className="flex animate-rise flex-col gap-7">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <Label>Где ты сейчас</Label>
          <Link href="/app/applications" className="inline-flex items-center gap-1 text-[13px] text-teal hover:text-head">Applications <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        <StageBar stage={d.stage} values={d.stageValues} />
        <div className="flex flex-col gap-4 border-t border-line pt-6">
          <KeyNumbers t={d.totals} />
          <TodayStrip d={t} />
        </div>
      </Card>

      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="h-serif text-[26px]">Что агент сделал <Script>сегодня</Script></h2>
          {campaign.lastRunAt && <span className="text-[12.5px] text-ink-3">последний цикл {ago(campaign.lastRunAt)}</span>}
        </div>
        <Timeline days={d.timeline} now={d.now} />
      </Card>

      {/* Demo tools (demo account, staff, local dev): available, not advertised. */}
      {demo && (
        <div className="flex flex-wrap items-center gap-2 px-1 pt-2 text-[12.5px] text-ink-4">
          <span className="label mr-1 !text-[9.5px] !text-ink-4">Демо-инструменты</span>
          {isActive && (
            <form action={runAgentNow}>
              <SubmitButton variant="ghost" size="sm" pendingText="Агент работает…" className="!h-10 !px-3 !text-[12.5px] text-ink-3"><Play className="size-3.5" strokeWidth={1.7} aria-hidden />Запустить цикл агента</SubmitButton>
            </form>
          )}
          <form action={simulateEmployers}>
            <SubmitButton variant="ghost" size="sm" pendingText="Симулируем…" className="!h-10 !px-3 !text-[12.5px] text-ink-3"><Sparkles className="size-3.5 text-amber" strokeWidth={1.7} aria-hidden />Симулировать ответы</SubmitButton>
          </form>
        </div>
      )}
    </div>
  );
}

async function NoCampaign({ userId, firstName, hasGoal, hasCv }: { userId: string; firstName: string; hasGoal: boolean; hasCv: boolean }) {
  const [facts, invoice] = await Promise.all([
    db.fact.count({ where: { userId } }),
    db.payment.findFirst({ where: { userId, provider: { in: ["kaspi", "kaspi_mock"] }, status: "pending" }, orderBy: { createdAt: "desc" }, select: { externalId: true, meta: true } }),
  ]);
  const openInvoice = invoice?.externalId && new Date(j<{ expiresAt?: string }>(invoice.meta, {}).expiresAt ?? 0).getTime() > (await nowMs()) ? invoice.externalId : null;
  const steps = [
    { n: "01", title: "Career Profile", sub: "Загрузи CV — агент разберёт опыт, навыки и достижения.", href: "/app/profile", done: hasCv || facts > 0 },
    { n: "02", title: "Career Goal", sub: "Роль, страны, формат работы и минимальная зарплата.", href: "/app/goal", done: hasGoal },
    { n: "03", title: "План и запуск", sub: "60 дней кампании. Оплата через Kaspi Pay — и агент начинает работать.", href: "/app/campaign", done: false },
  ];
  const next = steps.find((s) => !s.done)!;
  return (
    <div className="flex flex-col gap-6">
      <Card strong className="flex animate-rise flex-col gap-8 p-6 sm:p-10">
        <div className="flex max-w-2xl flex-col gap-3">
          <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink-4" aria-hidden /><Label>Agent · not started</Label></span>
          <h1 className="h-serif text-[clamp(32px,4.4vw,52px)]">{greeting()}, <Script>{firstName}</Script>.</h1>
          <p className="h-serif text-[clamp(20px,2.4vw,28px)] !text-teal">Задай цель — остальное сделает твой агент.</p>
          <p className="text-[15px] text-ink-2">60 дней Simplify ищет вакансии, адаптирует CV, отправляет заявки, разбирает ответы и готовит тебя к интервью. Ты видишь прогресс и отвечаешь только там, где без тебя нельзя.</p>
        </div>
        {openInvoice && (
          <div className="flex flex-col gap-3 rounded-2xl border border-amber/20 bg-amber-soft px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-ink-2">Счёт Kaspi Pay <span className="font-mono text-[12.5px] text-head">{openInvoice}</span> ждёт оплаты.</p>
            <ButtonLink href={`/pay/kaspi/${openInvoice}`} size="sm">Продолжить оплату</ButtonLink>
          </div>
        )}
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <Link href={s.href} className="group flex h-full flex-col gap-3 rounded-2xl border border-stroke bg-white/60 p-5 transition-all hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                <span className="flex items-center justify-between">
                  <span className="num text-[13px] text-ink-4">{s.n}</span>
                  {s.done ? <Chip tone="green" dot>готово</Chip> : <ArrowRight className="size-4 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </span>
                <span className="h-serif text-[21px]">{s.title}</span>
                <span className="text-[13.5px] text-ink-3">{s.sub}</span>
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href={next.href} size="lg">{next.href === "/app/campaign" ? "Start your campaign" : `Дальше: ${next.title}`}<ArrowRight className="size-4" aria-hidden /></ButtonLink>
        </div>
      </Card>
    </div>
  );
}

async function nowMs() {
  return Date.now();
}
