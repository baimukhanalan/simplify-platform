import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Check, CircleAlert, Pause, Play, TicketPercent, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { demoToolsEnabled } from "@/lib/demo";
import { isOverdue, pendingApprovalsCount } from "@/lib/ops-data";
import { ButtonLink, Card, Chip, Label, PageHeader, Progress, Ring, Script, cx } from "@/components/ui";
import { PaymentHistory } from "./_components/payment-history";
import { SubmitButton } from "@/components/client";
import { checkout, setCampaignStatus, runAgentNow } from "@/lib/actions/campaign";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { Disclosure } from "../profile/_components/bits";
import { AgentStatus } from "../../_components/agent-status";
import { LegalLinks } from "../../_components/legal-page";
import { PLAN_COOKIE, cleanPlan, type PlanKey } from "../../_components/plan-pref";
import { plural } from "../../_components/ru";

export const metadata: Metadata = { title: "Career Campaign" };

const INCLUDED = [
  "Career Profile", "Career Goal Builder", "Поиск вакансий (discovery)", "Matching и Eligibility", "Ранжирование по вероятности интервью",
  "Персонализация CV под вакансию", "Cover letters", "Подача заявок (application execution)", "Ответы на screening-вопросы", "Tracking и Pipeline",
  "Оптимизация стратегии по откликам", "Подготовка к assessment", "Interview Pack", "Mock interviews", "AI Interview Copilot",
  "Разбор после интервью", "Базовая помощь с оффером и переговорами",
];
const PLAN_COPY = {
  local: { regions: "Казахстан и СНГ", perDay: PLANS.local.dailyLimit },
  international: { regions: "Европа, UK, США, Канада, ОАЭ, remote worldwide + СНГ", perDay: PLANS.international.dailyLimit },
};
const STATUS_LABEL: Record<string, { label: string; tone: "green" | "amber" | "teal" | "rose" | "neutral" }> = {
  active: { label: "Active", tone: "green" }, paused: { label: "Paused", tone: "amber" }, hired: { label: "Hired", tone: "green" },
  expired: { label: "Завершена", tone: "neutral" }, draft: { label: "Draft", tone: "neutral" },
};
const DAY = 86400000;
/** Request-time clock for a campaign window (server-rendered per request). */
function campaignClock(startedAt: Date | null, endsAt: Date | null, days: number) {
  const now = Date.now();
  const start = startedAt?.getTime() ?? now;
  const total = endsAt ? Math.max(1, Math.round((endsAt.getTime() - start) / DAY)) : days;
  const elapsed = Math.min(total, Math.max(0, Math.floor((now - start) / DAY)));
  const left = endsAt ? Math.max(0, Math.ceil((endsAt.getTime() - now) / DAY)) : total - elapsed;
  return { total, elapsed, left };
}
const date = (d: Date | null | undefined) => (d ? d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", year: "numeric" }) : "—");

export default async function CampaignPage() {
  const user = await requireUser();
  const [rows, payments, approvals, jar] = await Promise.all([
    db.campaign.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { opportunities: { where: { submittedAt: { not: null } } } } } } }),
    db.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { campaign: { select: { plan: true } } } }),
    pendingApprovalsCount(user.id),
    cookies(),
  ]);
  // A campaign past endsAt is over even before an agent cycle writes status="expired": no Pause/Run, show the buy form.
  const campaigns = rows.map((c) => (isOverdue(c) ? { ...c, status: "expired" } : c));
  const active = campaigns.find((c) => c.status === "active" || c.status === "paused");
  const past = campaigns.filter((c) => c !== active && c.status !== "draft");
  const last = past[0];
  const consents = j<{ autoSubmit?: boolean }>(user.consents, {});
  const demo = demoToolsEnabled(user);
  const needs = active && approvals ? [{ text: `${approvals} ${plural(approvals, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} твоего ответа`, href: "/app/approvals" }] : [];

  return (
    <>
      <PageHeader
        eyebrow="Career Campaign · 60 дней"
        title={active ? <>Кампания <Script>в работе</Script></> : <>Запусти Career <Script>Campaign</Script></>}
        sub={active ? undefined : "60 дней агент ищет вакансии, адаптирует CV, подаёт заявки и готовит тебя к интервью. Трудоустройство мы не гарантируем: решение о найме всегда за работодателем."}
      />

      {!active && (
        <AgentStatus needs={[{ text: user.goal?.primaryRole ? "Выбери тариф ниже — и агент начнёт работать" : "Сначала задай цель — без неё агенту нечего искать", href: user.goal?.primaryRole ? undefined : "/app/goal?need=goal" }]} className="mb-6 animate-rise" />
      )}
      {active && (
        <AgentStatus
          needs={needs}
          idle={active.status === "paused"}
          working={active.status === "paused" ? "Кампания на паузе — агент ничего не отправляет, пока ты её не возобновишь." : undefined}
          className="mb-6 animate-rise"
        />
      )}

      {active ? <ActiveCampaign c={active} autoSubmitConsent={consents.autoSubmit !== false} demo={demo} /> : (
        <>
          {last && (last.status === "hired" || last.status === "expired") && (
            <div className="mb-6 flex animate-rise flex-col gap-2 rounded-2xl border border-line bg-white/70 px-4 py-3.5 text-[14px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Предыдущая кампания завершена: <Chip tone={STATUS_LABEL[last.status].tone} className="mx-1">{STATUS_LABEL[last.status].label}</Chip>
                {last.status === "hired" ? "поздравляем! Новая кампания — когда захочешь сделать следующий шаг." : "можно начать новую с обновлённой целью."}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[.06em] text-teal">Новая кампания ↓</span>
            </div>
          )}
          <Checkout
            hasGoal={Boolean(user.goal?.primaryRole)}
            partner={user.referredByCode ?? ""}
            recommended={cleanPlan(jar.get(PLAN_COOKIE)?.value) ?? (j<string[]>(user.goal?.countries, []).some((c) => !["KZ", "CIS"].includes(c)) ? "international" : "local")}
          />
        </>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <PaymentHistory payments={payments} />
        <section aria-labelledby="past-h">
          <Card className="h-full">
            <Label className="mb-4"><span id="past-h">Прошлые кампании</span></Label>
            {past.length === 0 ? (
              <p className="text-[14px] text-ink-3">Завершённых кампаний пока нет.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {past.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-[14px] text-head">{PLANS[c.plan as keyof typeof PLANS]?.label ?? c.plan}</div>
                      <div className="text-[12.5px] text-ink-3">{date(c.startedAt)} — {date(c.hiredAt ?? c.endsAt)} · <span className="num">{c._count.opportunities}</span> {plural(c._count.opportunities, ["заявка", "заявки", "заявок"])} · Readiness на старте <span className="num">{c.readiness}</span></div>
                    </div>
                    <Chip tone={STATUS_LABEL[c.status]?.tone ?? "neutral"}>{STATUS_LABEL[c.status]?.label ?? c.status}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}

/** Plan picker. Partner attribution comes only from the signup referral — shown read-only, never typed here. */
function Checkout({ hasGoal, partner, recommended }: { hasGoal: boolean; partner: string; recommended: PlanKey }) {
  return (
    <form action={checkout} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        {(["local", "international"] as const).map((key, i) => {
          const plan = PLANS[key];
          const rec = key === recommended;
          return (
            <section key={key} aria-labelledby={`plan-${key}`} className={cx("relative flex animate-rise flex-col gap-5 p-6", rec ? "glass-strong outline-2 outline-green/60" : "glass")} style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label><span id={`plan-${key}`}>{plan.label}</span></Label>
                  <div className="num text-[40px] leading-none text-head">{fmtKzt(plan.priceKzt)}</div>
                  <div className="text-[13px] text-ink-3">за {plan.days} дней кампании · разовый платёж</div>
                </div>
                {rec && <Chip tone="green" dot>Рекомендуем</Chip>}
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-4 text-[14px] text-ink-2">
                <div><span className="text-ink-3">Рынки: </span>{PLAN_COPY[key].regions}</div>
                <div><span className="text-ink-3">Темп: </span>до <span className="num text-head">{PLAN_COPY[key].perDay}</span> качественных заявок в день</div>
              </div>
              <div className="mt-auto pt-1">
                {hasGoal ? (
                  <SubmitButton name="plan" value={key} variant={rec ? "primary" : "glass"} size="lg" pendingText="Создаём счёт Kaspi…" className="w-full" aria-describedby={`plan-${key}`}>
                    Оплатить через Kaspi Pay
                  </SubmitButton>
                ) : (
                  <ButtonLink href="/app/goal?need=goal" variant={rec ? "primary" : "glass"} size="lg" className="w-full">Сначала задай цель</ButtonLink>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Card className="flex flex-col gap-5">
        <div>
          <Label className="mb-3">Всё включено в оба плана</Label>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13.5px] text-ink-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}
              </li>
            ))}
          </ul>
        </div>
        {partner && (
          <p className="flex items-center gap-2 border-t border-line pt-5 text-[13px] text-ink-2">
            <TicketPercent className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            Партнёр <span className="font-mono text-head">{partner}</span> учтён при регистрации.
          </p>
        )}
        <div className="flex items-start gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-ink-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
          <p><span className="font-medium text-head">Оплата через Kaspi Pay.</span> Сейчас подключён тестовый шлюз Kaspi: деньги не списываются, а кампания запускается сразу после подтверждения оплаты. Оплачивая, ты принимаешь <LegalLinks />.</p>
        </div>
      </Card>
    </form>
  );
}

function ActiveCampaign({ c, autoSubmitConsent, demo }: { c: { id: string; plan: string; status: string; readiness: number; dailyLimit: number; autoSubmit: boolean; startedAt: Date | null; endsAt: Date | null; lastRunAt: Date | null }; autoSubmitConsent: boolean; demo: boolean }) {
  const plan = PLANS[c.plan as keyof typeof PLANS] ?? PLANS.local;
  const { total, elapsed, left } = campaignClock(c.startedAt, c.endsAt, plan.days);
  const paused = c.status === "paused";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card strong className="flex animate-rise flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={cx("size-2.5 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
            <span className="label !text-head">{plan.label} · {paused ? "на паузе" : "активна"}</span>
          </div>
          <Chip tone={paused ? "amber" : "green"}>{paused ? "Paused" : "Active"}</Chip>
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          <div>
            <div className="num text-[64px] leading-none text-head">{left}</div>
            <div className="mt-1 text-[13px] text-ink-3">{plural(left, ["день остался", "дня осталось", "дней осталось"])} из {total}</div>
          </div>
          <div className="flex items-center gap-3">
            <Ring value={c.readiness} size={64} stroke={5} />
            <div className="text-[13px] text-ink-3">Readiness<br />на старте</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Progress value={(elapsed / total) * 100} />
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">
            <span>{date(c.startedAt)}</span><span>день {Math.min(total, elapsed + 1)} / {total}</span><span>{date(c.endsAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <form action={setCampaignStatus}>
            <input type="hidden" name="status" value={paused ? "active" : "paused"} />
            <SubmitButton variant={paused ? "green" : "glass"} pendingText="…">
              {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />Возобновить</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />Пауза</>}
            </SubmitButton>
          </form>
          {!paused && demo && (
            <form action={runAgentNow}>
              <SubmitButton pendingText="Агент работает…"><Zap className="size-4" strokeWidth={1.7} aria-hidden />Запустить цикл агента</SubmitButton>
            </form>
          )}
        </div>
        {c.lastRunAt && <p className="-mt-3 text-[12.5px] text-ink-3">Последний цикл: {c.lastRunAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" })}</p>}
        <Disclosure tone="ghost" summary="Что входит в кампанию">
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {INCLUDED.map((f) => <li key={f} className="flex items-start gap-2 text-[13.5px] text-ink-2"><Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>)}
          </ul>
        </Disclosure>
      </Card>

      <div className="flex flex-col gap-6">
        <Card className="animate-rise" style={{ animationDelay: "80ms" }}>
          <Label className="mb-3">Настройки агента</Label>
          <p className="text-[13.5px] text-ink-2">
            Сейчас: до <span className="num text-head">{Math.min(c.dailyLimit, plan.dailyLimit)}</span> {plural(Math.min(c.dailyLimit, plan.dailyLimit), ["заявки", "заявок", "заявок"])} в день, автоподача {c.autoSubmit ? "включена" : autoSubmitConsent ? "выключена" : "выключена (согласие отозвано)"}.
            Что агент делает сам, а что — только с твоего разрешения, настраивается в Agent.
          </p>
          <Link href="/app/agent" className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">Открыть Agent <ArrowRight className="size-3.5" aria-hidden /></Link>
        </Card>
        <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
          <Label className="mb-3">Fair usage</Label>
          <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
            <p>Тариф {plan.label} — до <span className="num text-head">{plan.dailyLimit}</span> {plural(plan.dailyLimit, ["заявки", "заявок", "заявок"])} в день. Лимит защищает качество: каждая заявка персонализирована, а не разослана массово.</p>
            <p>Агент никогда не подаёт дважды в одну вакансию и пропускает вакансии с hard blockers по Eligibility.</p>
            <p className="text-ink-3">Пауза не продлевает 60 дней кампании.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
