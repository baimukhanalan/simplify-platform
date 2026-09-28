import type { Metadata } from "next";
import { Check, CircleAlert, Pause, Play, Rocket, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Card, Chip, Field, Label, PageHeader, Progress, Ring, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { checkout, setCampaignStatus, updateCampaignSettings, runAgentNow } from "@/lib/actions/campaign";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { Disclosure } from "../profile/_components/bits";

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
  expired: { label: "Expired", tone: "neutral" }, draft: { label: "Draft", tone: "neutral" },
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
  const [campaigns, payments] = await Promise.all([
    db.campaign.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { opportunities: { where: { submittedAt: { not: null } } } } } } }),
    db.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { campaign: { select: { plan: true } } } }),
  ]);
  const active = campaigns.find((c) => c.status === "active" || c.status === "paused");
  const past = campaigns.filter((c) => c !== active && c.status !== "draft");
  const last = past[0];
  const consents = j<{ autoSubmit?: boolean }>(user.consents, {});

  return (
    <>
      <PageHeader
        eyebrow="Career Campaign · 60 дней"
        title={active ? <>Кампания <Script>в работе</Script></> : <>Запустите Career <Script>Campaign</Script></>}
        sub="Simplify продаёт исполнение кампании — поиск, подготовку, подачу и сопровождение до оффера. Мы не гарантируем трудоустройство: решение о найме всегда за работодателем."
      />

      {active ? <ActiveCampaign c={active} autoSubmitConsent={consents.autoSubmit !== false} /> : (
        <>
          {last && (last.status === "hired" || last.status === "expired") && (
            <div className="mb-6 flex animate-rise flex-col gap-2 rounded-2xl border border-line bg-white/70 px-4 py-3.5 text-[14px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
              <span>
                Предыдущая кампания завершена: <Chip tone={STATUS_LABEL[last.status].tone} className="mx-1">{STATUS_LABEL[last.status].label}</Chip>
                {last.status === "hired" ? "поздравляем! Новая кампания — когда будете готовы к следующему шагу." : "можно начать новую с обновлённой целью."}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[.06em] text-teal">Start New Campaign ↓</span>
            </div>
          )}
          <Checkout hasGoal={Boolean(user.goal?.primaryRole)} partner={user.referredByCode ?? ""} intl={j<string[]>(user.goal?.countries, []).some((c) => !["KZ", "CIS"].includes(c))} />
        </>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="payments-h">
          <Card className="h-full">
            <Label className="mb-4"><span id="payments-h">История платежей</span></Label>
            {payments.length === 0 ? (
              <p className="text-[14px] text-ink-3">Платежей пока нет.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-[14px] text-head">{p.campaign ? PLANS[p.campaign.plan as keyof typeof PLANS]?.label ?? p.campaign.plan : "Career Campaign"}</div>
                      <div className="text-[12.5px] text-ink-3">
                        {date(p.createdAt)} · {p.provider === "test" ? "тестовый платёж" : p.provider}
                        {p.partnerCode && <> · партнёр <span className="font-mono">{p.partnerCode}</span></>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num text-[16px] text-head">{p.currency === "KZT" ? fmtKzt(p.amount) : `${p.amount} ${p.currency}`}</span>
                      <Chip tone={p.status === "paid" ? "green" : "amber"}>{p.status}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
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
                      <div className="text-[12.5px] text-ink-3">{date(c.startedAt)} — {date(c.hiredAt ?? c.endsAt)} · <span className="num">{c._count.opportunities}</span> заявок · readiness <span className="num">{c.readiness}</span></div>
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

function Checkout({ hasGoal, partner, intl }: { hasGoal: boolean; partner: string; intl: boolean }) {
  return (
    <form action={checkout} className="flex flex-col gap-6">
      <fieldset className="grid gap-4 md:grid-cols-2">
        <legend className="sr-only">Выберите план</legend>
        {(["local", "international"] as const).map((key, i) => {
          const plan = PLANS[key];
          return (
            <label key={key} className="group/p glass relative flex animate-rise cursor-pointer flex-col gap-5 p-6 transition-all hover:bg-white has-[:checked]:bg-white has-[:checked]:outline-2 has-[:checked]:outline-green has-[:focus-visible]:outline-offset-4" style={{ animationDelay: `${i * 80}ms` }}>
              <input type="radio" name="plan" value={key} defaultChecked={intl ? key === "international" : key === "local"} className="sr-only" />
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>{plan.label}</Label>
                  <div className="num text-[40px] leading-none text-head">{fmtKzt(plan.priceKzt)}</div>
                  <div className="text-[13px] text-ink-3">за {plan.days} дней кампании · разовый платёж</div>
                </div>
                <span className="mt-1 grid size-6 place-items-center rounded-full border border-line bg-white text-transparent transition-colors group-has-[:checked]/p:border-green group-has-[:checked]/p:bg-green group-has-[:checked]/p:text-white" aria-hidden>
                  <Check className="size-3.5" strokeWidth={2.4} />
                </span>
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-4 text-[14px] text-ink-2">
                <div><span className="text-ink-3">Рынки: </span>{PLAN_COPY[key].regions}</div>
                <div><span className="text-ink-3">Темп: </span>до <span className="num text-head">{PLAN_COPY[key].perDay}</span> качественных заявок в день</div>
              </div>
            </label>
          );
        })}
      </fieldset>

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
        <div className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end">
          <Field label="Партнёрский код" hint="Если вас пригласил партнёр — бонус учтётся автоматически" className="sm:w-64">
            <input name="partner" defaultValue={partner} autoComplete="off" className="field font-mono uppercase" placeholder="AMASKILLS" />
          </Field>
          <div className="flex flex-1 flex-col gap-2 sm:items-end">
            {hasGoal ? (
              <SubmitButton size="lg" pendingText="Оплачиваем и запускаем…"><Rocket className="size-4" strokeWidth={1.7} aria-hidden />Оплатить и запустить</SubmitButton>
            ) : (
              <ButtonLink href="/app/goal?need=goal" size="lg">Сначала задайте цель</ButtonLink>
            )}
          </div>
        </div>
        <div className="flex items-start gap-2.5 rounded-2xl bg-amber-soft px-4 py-3 text-[13px] text-ink-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
          <p><span className="font-medium text-head">Тестовый режим оплаты.</span> Платёж записывается через provider «test», деньги не списываются. Simplify продаёт исполнение кампании, а не гарантию трудоустройства.</p>
        </div>
      </Card>
    </form>
  );
}

function ActiveCampaign({ c, autoSubmitConsent }: { c: { id: string; plan: string; status: string; readiness: number; dailyLimit: number; autoSubmit: boolean; startedAt: Date | null; endsAt: Date | null; lastRunAt: Date | null }; autoSubmitConsent: boolean }) {
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
            <div className="mt-1 text-[13px] text-ink-3">дней осталось из {total}</div>
          </div>
          <div className="flex items-center gap-3">
            <Ring value={c.readiness} size={64} stroke={5} />
            <div className="text-[13px] text-ink-3">Readiness<br />на старте</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Progress value={(elapsed / total) * 100} />
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">
            <span>{date(c.startedAt)}</span><span>день {elapsed} / {total}</span><span>{date(c.endsAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <form action={setCampaignStatus}>
            <input type="hidden" name="status" value={paused ? "active" : "paused"} />
            <SubmitButton variant={paused ? "green" : "glass"} pendingText="…">
              {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />Возобновить</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />Пауза</>}
            </SubmitButton>
          </form>
          {!paused && (
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
          <Label className="mb-4">Настройки агента</Label>
          <form action={updateCampaignSettings} className="flex flex-col gap-4">
            <Field label="Заявок в день" hint="1–25. Меньше — выше качество каждой заявки.">
              <input name="dailyLimit" type="number" min={1} max={25} required inputMode="numeric" defaultValue={c.dailyLimit} className="field" />
            </Field>
            <label className={cx("flex items-start gap-3 rounded-2xl border border-line bg-white/60 px-3.5 py-3", autoSubmitConsent ? "cursor-pointer" : "opacity-60")}>
              <input type="checkbox" name="autoSubmit" defaultChecked={c.autoSubmit && autoSubmitConsent} disabled={!autoSubmitConsent} className="mt-0.5 size-4 accent-[#1a6e48]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14px] text-head">Автоподача</span>
                <span className="text-[12px] text-ink-3">
                  {autoSubmitConsent ? "Агент подаёт сам. Выкл — каждая заявка ждёт вашего подтверждения." : <>Согласие на автоподачу отозвано в <a href="/app/settings" className="underline underline-offset-2">Приватности</a>.</>}
                </span>
              </span>
            </label>
            <div><SubmitButton variant="glass" pendingText="Сохраняем…">Сохранить</SubmitButton></div>
          </form>
        </Card>
        <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
          <Label className="mb-3">Fair usage</Label>
          <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
            <p>План включает до <span className="num text-head">{plan.dailyLimit}</span> заявок в день — лимит защищает качество: каждая заявка персонализирована, а не разослана массово.</p>
            <p>Агент никогда не подаёт дважды в одну вакансию и пропускает вакансии с hard blockers по Eligibility.</p>
            <p className="text-ink-3">Пауза не продлевает 60 дней кампании.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
