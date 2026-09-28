import Link from "next/link";
import {
  Activity, ArrowRight, ArrowRightLeft, BadgeDollarSign, CalendarClock, Check, FileText, Mail, Mic, Play, RefreshCw, Rocket,
  Search, Send, ShieldCheck, Sparkles, Trophy, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { runAgentNow, simulateEmployers } from "@/lib/actions/campaign";
import { reachedInterview } from "@/lib/engine/insights";
import { currentCampaign } from "@/lib/ops-data";
import { APPROVAL_KIND, EVENT_LABEL, ago, fmtDateTime, pct, pctLabel } from "@/lib/ops";
import { Button, ButtonLink, Card, Chip, Empty, Label, PageHeader, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";

export const metadata = { title: "Обзор кампании — Simplify" };

const DAY = 86400000;

const EVENT_ICON: Record<string, LucideIcon> = {
  discovery: Search, prepared: FileText, submitted: Send, inbox: Mail, interview_room: Mic, tick: RefreshCw,
  campaign_started: Rocket, campaign_status: Rocket, status_change: ArrowRightLeft, approval: ShieldCheck, hired: Trophy,
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  const firstName = user.name.split(" ")[0] || user.name;

  if (!campaign) return <NoCampaign userId={user.id} firstName={firstName} hasGoal={Boolean(user.goal?.primaryRole)} hasCv={Boolean(user.profile?.cvText || user.profile?.summary)} />;

  const [opps, approvals, upcoming, offers, events] = await Promise.all([
    db.opportunity.findMany({
      where: { campaignId: campaign.id },
      select: { status: true, submittedAt: true, interviews: { select: { round: true, createdAt: true } }, _count: { select: { offers: true } } },
    }),
    db.approval.findMany({ where: { userId: user.id, status: "pending" }, select: { kind: true } }),
    db.interview.findMany({
      where: { userId: user.id, status: "upcoming", opportunity: { campaignId: campaign.id } },
      orderBy: { scheduledAt: "asc" },
      take: 4,
      include: { opportunity: { select: { id: true, job: { select: { company: true, title: true } } } } },
    }),
    db.offer.findMany({ where: { userId: user.id, status: { in: ["received", "negotiating"] } }, orderBy: { createdAt: "desc" }, take: 3 }),
    db.event.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  // ——— Funnel (cumulative: each stage counts everything that reached it) ———
  const submitted = opps.filter((o) => o.submittedAt);
  const f = {
    found: opps.length,
    qualified: opps.filter((o) => !["found", "skipped"].includes(o.status)).length,
    submitted: submitted.length,
    response: submitted.filter((o) => !["submitted", "pending"].includes(o.status)).length,
    assessment: opps.filter((o) => o.status === "assessment" || o.interviews.some((i) => i.round === "assessment")).length,
    interview: opps.filter((o) => reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length)).length,
    offer: opps.filter((o) => ["offer", "hired"].includes(o.status) || o._count.offers > 0).length,
  };
  const funnel = [
    { key: "found", label: "Found", value: f.found, hint: "вакансий найдено" },
    { key: "qualified", label: "Qualified", value: f.qualified, hint: "прошли Match + Eligibility" },
    { key: "submitted", label: "Submitted", value: f.submitted, hint: "заявок отправлено" },
    { key: "response", label: "Response", value: f.response, hint: "живой ответ работодателя" },
    { key: "assessment", label: "Assessment", value: f.assessment, hint: "тестовое / online assessment" },
    { key: "interview", label: "Interview", value: f.interview, hint: "реальные интервью" },
    { key: "offer", label: "Offer", value: f.offer, hint: "офферы" },
  ];

  const start = campaign.startedAt ?? campaign.createdAt;
  const now = new Date();
  const totalDays = campaign.endsAt ? Math.max(1, Math.round((campaign.endsAt.getTime() - start.getTime()) / DAY)) : 60;
  const day = Math.min(totalDays, Math.max(1, Math.floor((now.getTime() - start.getTime()) / DAY) + 1));
  const firstInterview = opps.flatMap((o) => o.interviews.filter((i) => i.round !== "assessment").map((i) => i.createdAt)).sort((a, b) => a.getTime() - b.getTime())[0];
  const daysToFirst = firstInterview ? Math.max(0, Math.round((firstInterview.getTime() - start.getTime()) / DAY)) : null;

  const approvalsByKind = Object.entries(approvals.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.kind]: (acc[a.kind] ?? 0) + 1 }), {}));
  const needsYou = approvals.length + upcoming.length + offers.length;
  const isActive = campaign.status === "active";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`Career Campaign · день ${day} из ${totalDays}`}
        title={<>Привет, <Script>{firstName}</Script></>}
        sub="Один дашборд вместо 30 сайтов: агент ищет, фильтрует, готовит и отправляет — вы видите только то, что требует решения."
        actions={
          <>
            {isActive ? (
              <form action={runAgentNow}>
                <SubmitButton size="md" pendingText="Агент работает…">
                  <Play className="size-4" strokeWidth={1.7} aria-hidden /> Запустить цикл агента
                </SubmitButton>
              </form>
            ) : (
              <Button size="md" disabled title="Кампания не активна"><Play className="size-4" strokeWidth={1.7} aria-hidden /> Запустить цикл агента</Button>
            )}
            <form action={simulateEmployers}>
              <SubmitButton variant="glass" size="md" pendingText="Симулируем…">
                <Sparkles className="size-4 text-amber" strokeWidth={1.7} aria-hidden /> Симулировать ответы работодателей <span className="font-mono text-[10px] uppercase tracking-[.06em] text-amber">демо</span>
              </SubmitButton>
            </form>
          </>
        }
      />

      {sp.started === "1" && (
        <div role="status" className="glass-strong flex animate-rise items-start gap-4 p-5 sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-green text-white shadow-(--shadow-cta)"><Rocket className="size-[18px]" strokeWidth={1.7} aria-hidden /></span>
          <div className="flex-1">
            <div className="h-serif text-[21px]">Кампания запущена</div>
            <p className="mt-1 text-[14px] text-ink-2">Агент уже провёл первый цикл: нашёл вакансии, проверил Eligibility и подготовил первые пакеты. Дальше он работает сам — каждый день, в пределах лимита {campaign.dailyLimit} заявок.</p>
          </div>
          <Link href="/app" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-white hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label="Скрыть сообщение"><X className="size-4" /></Link>
        </div>
      )}

      {!isActive && (
        <div className="glass flex flex-wrap items-center gap-3 px-5 py-4 text-[14px] text-ink-2">
          <Chip tone={campaign.status === "hired" ? "green" : "amber"}>{campaign.status}</Chip>
          {campaign.status === "paused" && "Кампания на паузе — агент не ищет и не отправляет новые заявки."}
          {campaign.status === "hired" && "Вы получили работу — кампания завершена. Статистика ниже сохранена."}
          {campaign.status === "expired" && "60 дней кампании истекли. Статистика ниже сохранена."}
          <Link href="/app/campaign" className="ml-auto text-[13px] text-teal underline-offset-2 hover:underline">Управление кампанией</Link>
        </div>
      )}

      {/* North star + KPIs */}
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card strong className="relative flex animate-rise flex-col justify-between gap-6 overflow-hidden">
          <div className="flex items-start justify-between gap-4">
            <Label>North star · реальные интервью</Label>
            <Chip tone={f.interview ? "green" : "neutral"} dot>{f.interview ? "цель достигнута" : "в работе"}</Chip>
          </div>
          <div className="flex items-end gap-5">
            <div className="num text-[clamp(64px,9vw,104px)] leading-[.85] text-head">{f.interview}</div>
            <div className="pb-2 text-[15px] leading-snug text-ink-2">
              интервью за {day} {day === 1 ? "день" : "дн."}
              <br />
              <span className="text-ink-3">+ {f.assessment} assessment</span>
            </div>
          </div>
          <p className="max-w-md text-[14px] text-ink-2">
            {daysToFirst != null ? (
              <>Первое интервью пришло <span className="text-head">через {daysToFirst} {daysToFirst === 1 ? "день" : "дн."}</span> после старта. Мы оптимизируем именно это число — не количество заявок.</>
            ) : (
              <>Первого интервью пока нет. Агент собирает сигналы и смещает заявки в сегменты, где они конвертируются. Обычно первые ответы приходят в первые 2–3 недели.</>
            )}
          </p>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Application → Response" value={pctLabel(f.response, f.submitted)} hint={`${f.response} из ${f.submitted}`} />
          <Kpi label="→ Assessment" value={pctLabel(f.assessment, f.submitted)} hint={`${f.assessment} из ${f.submitted}`} />
          <Kpi label="→ Interview" value={pctLabel(f.interview, f.submitted)} hint={`${f.interview} из ${f.submitted}`} tone="green" />
          <Kpi label="Time to first interview" value={daysToFirst != null ? `${daysToFirst} дн.` : "—"} hint={daysToFirst != null ? "от старта кампании" : "ещё нет интервью"} />
        </div>
      </div>

      {/* Funnel */}
      <Card className="animate-rise">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <Label>Воронка кампании</Label>
            <h2 className="h-serif mt-2 text-[24px]">От {f.found} найденных до {f.offer} {f.offer === 1 ? "оффера" : "офферов"}</h2>
          </div>
          <Link href="/app/pipeline" className="inline-flex items-center gap-1 text-[13px] text-teal hover:text-head">Открыть Pipeline <ArrowRight className="size-3.5" aria-hidden /></Link>
        </div>
        <ol className="flex flex-col gap-2.5">
          {funnel.map((s, i) => {
            const prev = i > 0 ? funnel[i - 1].value : null;
            const width = f.found ? Math.max(1.5, (s.value / f.found) * 100) : 0;
            return (
              <li key={s.key} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 sm:grid-cols-[120px_1fr_150px]">
                <div className="flex flex-col">
                  <span className="text-[13.5px] text-head">{s.label}</span>
                  <span className="hidden text-[11.5px] text-ink-4 sm:block">{s.hint}</span>
                </div>
                <div className="h-7 overflow-hidden rounded-lg bg-head/[.05]" aria-hidden>
                  <div
                    className={cx("h-full rounded-lg transition-[width] duration-700", i >= 5 ? "bg-green" : i >= 3 ? "bg-teal" : "bg-head/25")}
                    style={{ width: `${width}%` }}
                  />
                </div>
                <div className="flex items-baseline justify-end gap-2 text-right">
                  <span className="num text-[20px] leading-none text-head">{s.value}</span>
                  <span className="num w-12 text-[12px] text-ink-3" title={prev != null ? `Конверсия из предыдущего этапа` : undefined}>
                    {prev != null ? (prev ? `${pct(s.value, prev)}%` : "—") : ""}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 text-[12.5px] text-ink-3">Процент справа — конверсия из предыдущего этапа. Response не считает автоматические «мы получили заявку».</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        {/* Needs you */}
        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Label>Нужно ваше решение</Label>
            {needsYou > 0 && <span className="num rounded-full bg-green px-2 py-0.5 text-[12px] text-white">{needsYou}</span>}
          </div>
          {needsYou === 0 ? (
            <div className="flex flex-col items-start gap-2 py-4">
              <Check className="size-5 text-green" aria-hidden />
              <div className="h-serif text-[20px]">Всё под контролем</div>
              <p className="text-[13.5px] text-ink-3">Нет вопросов, интервью и офферов, которые ждут вас. Агент продолжает работать.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {approvals.length > 0 && (
                <NeedBlock icon={ShieldCheck} title={`${approvals.length} ${approvals.length === 1 ? "вопрос ждёт" : "вопросов ждут"} подтверждения`} href="/app/approvals" cta="Разобрать">
                  <div className="flex flex-wrap gap-1.5">
                    {approvalsByKind.map(([k, n]) => <Chip key={k} tone={k === "handoff" ? "teal" : "amber"}>{APPROVAL_KIND[k]?.label ?? k} · {n}</Chip>)}
                  </div>
                </NeedBlock>
              )}
              {upcoming.length > 0 && (
                <NeedBlock icon={CalendarClock} title="Ближайшие интервью" href="/app/interviews" cta="Interview Room">
                  <ul className="flex flex-col divide-y divide-line">
                    {upcoming.map((iv) => (
                      <li key={iv.id} className="flex items-center justify-between gap-3 py-2 text-[13.5px]">
                        <Link href={`/app/opportunities/${iv.opportunity.id}`} className="min-w-0 truncate text-head hover:underline">{iv.opportunity.job.company} <span className="text-ink-3">· {iv.opportunity.job.title}</span></Link>
                        <span className="flex shrink-0 items-center gap-2">
                          <Chip tone={iv.round === "assessment" ? "amber" : "teal"}>{iv.round}</Chip>
                          <span className="num text-[12.5px] text-ink-3">{fmtDateTime(iv.scheduledAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </NeedBlock>
              )}
              {offers.length > 0 && (
                <NeedBlock icon={BadgeDollarSign} title={offers.length === 1 ? "Оффер ждёт решения" : `${offers.length} оффера ждут решения`} href="/app/offers" cta="Offer Desk">
                  <ul className="flex flex-col gap-1 text-[13.5px]">
                    {offers.map((o) => (
                      <li key={o.id} className="flex justify-between gap-3"><span className="truncate text-head">{o.company} <span className="text-ink-3">· {o.role}</span></span><span className="num text-green">${Math.round(o.base / 1000)}k</span></li>
                    ))}
                  </ul>
                </NeedBlock>
              )}
            </div>
          )}
        </Card>

        {/* Activity feed */}
        <Card className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Label>Активность агента</Label>
            {campaign.lastRunAt && <span className="text-[12px] text-ink-3">последний цикл {ago(campaign.lastRunAt)}</span>}
          </div>
          {events.length === 0 ? (
            <p className="py-6 text-[13.5px] text-ink-3">Событий пока нет. Запустите цикл агента — здесь появится каждый его шаг.</p>
          ) : (
            <ol className="relative flex flex-col">
              {events.map((e) => {
                const Icon = EVENT_ICON[e.type] ?? Activity;
                const body = (
                  <>
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-stroke bg-white text-teal"><Icon className="size-3.5" strokeWidth={1.7} aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] leading-snug text-ink">{e.message}</span>
                      <span className="mt-0.5 flex gap-2 font-mono text-[10px] uppercase tracking-[.06em] text-ink-4">
                        <span>{EVENT_LABEL[e.type] ?? e.type}</span>
                        <time dateTime={e.createdAt.toISOString()}>{ago(e.createdAt)}</time>
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={e.id} className="border-b border-line/70 last:border-0">
                    {e.opportunityId ? (
                      <Link href={`/app/opportunities/${e.opportunityId}`} className="-mx-2 flex gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/60">{body}</Link>
                    ) : (
                      <div className="flex gap-3 py-2.5">{body}</div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: "green" }) {
  return (
    <div className="glass flex flex-col justify-between gap-3 p-4 sm:p-5">
      <span className="label !text-[10px]">{label}</span>
      <span className={cx("num text-[30px] leading-none", tone === "green" ? "text-green" : "text-head")}>{value}</span>
      <span className="text-[12px] text-ink-3">{hint}</span>
    </div>
  );
}

function NeedBlock({ icon: Icon, title, href, cta, children }: { icon: LucideIcon; title: string; href: string; cta: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl border border-stroke bg-white/55 p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[14.5px] font-medium text-head"><Icon className="size-4 text-green" strokeWidth={1.7} aria-hidden />{title}</h3>
        <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] text-teal hover:text-head">{cta}<ArrowRight className="size-3.5" aria-hidden /></Link>
      </div>
      {children}
    </section>
  );
}

async function NoCampaign({ userId, firstName, hasGoal, hasCv }: { userId: string; firstName: string; hasGoal: boolean; hasCv: boolean }) {
  const facts = await db.fact.count({ where: { userId } });
  const steps = [
    { n: "01", title: "Career Profile", sub: "Загрузите CV — агент разберёт его в проверяемые факты (Truth Layer).", href: "/app/profile", done: hasCv || facts > 0 },
    { n: "02", title: "Цель", sub: "Роль, страны, формат, минимальная зарплата, компании мечты.", href: "/app/goal", done: hasGoal },
    { n: "03", title: "Readiness", sub: "Проверим, готов ли профиль к рынку, до того как тратить заявки.", href: "/app/readiness", done: false },
  ];
  const next = steps.find((s) => !s.done) ?? { href: "/app/campaign" };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Обзор" title={<>Привет, <Script>{firstName}</Script></>} sub="Здесь будет один дашборд вместо 30 сайтов: вакансии, заявки, ответы работодателей и интервью — в одном месте." />
      <Card strong className="flex animate-rise flex-col gap-8 p-6 sm:p-10">
        <div className="flex max-w-2xl flex-col gap-3">
          <Label>Кампания ещё не запущена</Label>
          <h2 className="h-serif text-[clamp(28px,3.4vw,42px)]">Скажите, какую работу вы хотите — <Script>остальное</Script> сделает агент</h2>
          <p className="text-[15px] text-ink-2">60 дней агент ищет вакансии, проверяет Match и Eligibility, адаптирует CV под каждую, отправляет заявки, разбирает ответы и готовит вас к интервью. Три шага до старта:</p>
        </div>
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <Link href={s.href} className="group flex h-full flex-col gap-3 rounded-2xl border border-stroke bg-white/60 p-5 transition-all hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                <div className="flex items-center justify-between">
                  <span className="num text-[13px] text-ink-4">{s.n}</span>
                  {s.done ? <Chip tone="green" dot>готово</Chip> : <ArrowRight className="size-4 text-teal transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </div>
                <div className="h-serif text-[21px]">{s.title}</div>
                <p className="text-[13.5px] text-ink-3">{s.sub}</p>
              </Link>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center gap-3">
          <ButtonLink href="/app/campaign" size="lg"><Rocket className="size-4" strokeWidth={1.7} aria-hidden /> Start your campaign</ButtonLink>
          {next.href !== "/app/campaign" && <ButtonLink href={next.href} variant="glass" size="lg">Продолжить настройку</ButtonLink>}
        </div>
      </Card>
      <Empty title="Активность появится после запуска" sub="Каждое действие агента — найденная вакансия, отправленная заявка, распознанное письмо — будет видно здесь с Audit Trail." />
    </div>
  );
}
