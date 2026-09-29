import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, Label, PageHeader, Script, Stat, cx } from "@/components/ui";
import { overview, referralStats } from "@/lib/admin/queries";
import { PERIODS, parsePeriod } from "@/lib/admin/metrics";
import { fmtKzt } from "@/lib/engine/taxonomy";
import { count, fmtNum } from "@/lib/ru";
import { BarChart } from "./_components/bar-chart";
import { PeriodTabs } from "./_components/period-tabs";
import { fmtKey, fmtPct } from "./_components/fmt";

export const metadata = { title: "Обзор · Admin" };

const SIGNUPS = ["регистрация", "регистрации", "регистраций"] as const;
const PAYMENTS = ["оплата", "оплаты", "оплат"] as const;

export default async function AdminOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).p);
  const [o, refs] = await Promise.all([overview(period), referralStats()]);
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const g = o.granularity === "day" ? "по дням" : o.granularity === "week" ? "по неделям" : "по месяцам";
  const planTotal = o.plans.reduce((a, p) => a + p.payments, 0);

  return (
    <>
      <PageHeader
        eyebrow="Admin · обзор"
        title={<>Бизнес <Script>сегодня</Script></>}
        sub="Регистрации, оплаты и результат кампаний за выбранный период. Все цифры — из базы в момент загрузки."
        actions={<PeriodTabs value={period} base="/admin" />}
      />

      <div className="flex flex-col gap-6">
        <section aria-labelledby="kpi-h" className="flex flex-col gap-4">
          <h2 id="kpi-h" className="sr-only">Ключевые метрики · {periodLabel}</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><Stat label="Новые регистрации" value={fmtNum(o.signups, 0)} hint={`всего пользователей: ${fmtNum(o.totalUsers, 0)}${o.signupsCapped ? " · показан лимит" : ""}`} /></Card>
            <Card><Stat label="Платящие" value={fmtNum(o.paidUsers, 0)} hint={count(o.paymentsCount, PAYMENTS) + " за период"} /></Card>
            <Card strong><Stat label="Выручка" tone="green" value={<span className="text-[26px] sm:text-[30px]">{fmtKzt(o.revenue)}</span>} hint={o.turnover !== o.revenue ? `оборот по счетам: ${fmtKzt(o.turnover)}` : "без возвратов"} /></Card>
            <Card><Stat label="Конверсия в оплату" value={fmtPct(o.conversion)} hint={`${fmtNum(o.cohortPaid, 0)} из ${count(o.signups, SIGNUPS)} периода`} /></Card>
            <Card><Stat label="ARPU" value={<span className="text-[26px] sm:text-[30px]">{fmtKzt(o.arpu)}</span>} hint={o.arpuTurnover !== o.arpu ? `по обороту: ${fmtKzt(o.arpuTurnover)}` : "выручка на платящего"} /></Card>
            <Card><Stat label="Активные кампании" value={fmtNum(o.activeCampaigns, 0)} hint={<Link href="/admin/campaigns" className="text-teal underline-offset-2 hover:underline">застрявшие →</Link>} /></Card>
            <Card><Stat label="HIRED" tone={o.hired ? "green" : undefined} value={fmtNum(o.hired, 0)} hint={period === "all" ? "за всё время" : `за ${periodLabel}`} /></Card>
            <Card><Stat label="Воронка" value={<Link href="/admin/funnel" className="text-[20px] text-teal underline-offset-4 hover:underline">открыть →</Link>} hint="где теряем людей" /></Card>
          </div>
        </section>

        <section aria-labelledby="chart-h">
          <Card>
            <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="chart-h" className="h-serif text-[22px]">Динамика <span className="text-[15px] text-ink-3">· {g}</span></h2>
            </div>
            <div className="grid gap-8 lg:grid-cols-2">
              <BarChart
                title="Регистрации"
                format={(n) => fmtNum(n, 0)}
                bars={o.series.map((s) => ({ key: s.key, label: fmtKey(s.key), parts: [{ name: "Регистрации", value: s.signups, className: "bg-teal" }] }))}
              />
              <BarChart
                title="Оплаты, ₸"
                format={fmtKzt}
                legend={o.series.some((s) => s.other > 0) ? [{ name: "Выручка", className: "bg-green" }, { name: "Прочие оплаты", className: "bg-green/30" }] : undefined}
                bars={o.series.map((s) => ({
                  key: s.key, label: fmtKey(s.key),
                  parts: o.series.some((x) => x.other > 0)
                    ? [{ name: "Выручка", value: s.revenue, className: "bg-green" }, { name: "Прочие оплаты", value: s.other, className: "bg-green/30" }]
                    : [{ name: "Выручка", value: s.revenue, className: "bg-green" }],
                }))}
              />
            </div>
          </Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
          <section aria-labelledby="plans-h">
            <Card className="h-full">
              <h2 id="plans-h" className="h-serif mb-5 text-[22px]">Планы</h2>
              <ul className="flex flex-col gap-5">
                {o.plans.map((p) => {
                  const share = planTotal ? (p.payments / planTotal) * 100 : 0;
                  return (
                    <li key={p.key} className="flex flex-col gap-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[14.5px] font-medium text-head">{p.label}</span>
                        <span className="num text-[14px] text-head">{fmtPct(share)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-head/10"><div className={cx("h-full rounded-full", p.key === "international" ? "bg-cta" : "bg-teal")} style={{ width: `${share}%` }} /></div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-3">
                        <span>{count(p.payments, PAYMENTS)}</span>
                        <span>{fmtKzt(p.amount)}{p.revenue !== p.amount ? ` · выручка ${fmtKzt(p.revenue)}` : ""}</span>
                        <span>активных кампаний: {p.active}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {planTotal === 0 && <p className="mt-4 text-[13px] text-ink-4">Оплат за период нет.</p>}
            </Card>
          </section>

          <section aria-labelledby="ref-h">
            <Card className="h-full">
              <div className="mb-5 flex items-center justify-between gap-2">
                <h2 id="ref-h" className="h-serif text-[22px]">Рефералы</h2>
                <Chip tone={refs.total ? "green" : "neutral"}>{refs.total} приглашено</Chip>
              </div>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Зарегистрировались", fmtNum(refs.signedUp, 0)],
                  ["Оплатили", fmtNum(refs.paid + refs.rewarded, 0)],
                  ["Бонусных дней", fmtNum(refs.rewardDays, 0)],
                  ["Скидки", fmtKzt(refs.discountKzt)],
                ].map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-1"><dt className="label">{k}</dt><dd className="num text-[22px] leading-none text-head">{v}</dd></div>
                ))}
              </dl>
              <Label className="mb-2 mt-6">Топ пригласивших</Label>
              {refs.top.length === 0 ? (
                <p className="text-[13.5px] text-ink-3">Приглашений пока нет.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-line">
                  {refs.top.map((r, i) => (
                    <li key={r.userId} className="flex items-center gap-3 py-2 text-[13.5px]">
                      <span className="num w-5 text-ink-4">{i + 1}</span>
                      <Link href={`/admin/users/${r.userId}`} className="min-w-0 flex-1 truncate text-head hover:underline">{r.name}</Link>
                      <span className="num text-ink-2">{r.invited}</span>
                      <span className="num w-24 text-right text-[12px] text-green">{r.paid} оплатили</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>
        </div>
      </div>
    </>
  );
}
