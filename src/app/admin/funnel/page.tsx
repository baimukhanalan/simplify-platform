import { TrendingDown } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, PageHeader, Script, cx } from "@/components/ui";
import { funnelData } from "@/lib/admin/queries";
import { FUNNEL_STEPS, parsePeriod, worstDrop } from "@/lib/admin/metrics";
import { fmtNum } from "@/lib/ru";
import { PeriodTabs } from "../_components/period-tabs";
import { fmtKey, fmtPct } from "../_components/fmt";

export const metadata = { title: "Воронка · Admin" };

const days = (d: number | null) => (d == null ? "—" : d < 1 ? `${fmtNum(d * 24, 0)} ч` : `${fmtNum(d)} д`);

export default async function FunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const period = parsePeriod((await searchParams).p, "all");
  const { rows, cohorts, capped } = await funnelData(period);
  const worst = worstDrop(rows);
  const total = rows[0].count;

  return (
    <>
      <PageHeader
        eyebrow="Admin · воронка"
        title={<>От регистрации до <Script>HIRED</Script></>}
        sub="Пользователи, зарегистрированные за период, и самый дальний шаг, до которого каждый дошёл. Медиана — время от предыдущего шага."
        actions={<PeriodTabs value={period} base="/admin/funnel" />}
      />

      <div className="flex flex-col gap-6">
        {worst && worst.lossPct > 0 && (
          <Card strong className="flex items-start gap-3">
            <TrendingDown className="mt-0.5 size-5 shrink-0 text-rose" strokeWidth={1.7} aria-hidden />
            <p className="text-[14.5px] text-ink-2">
              Больше всего теряем на шаге <b className="font-medium text-head">«{worst.from.label}» → «{worst.to.label}»</b>: не доходят {fmtPct(worst.lossPct)} ({fmtNum(worst.from.count - worst.to.count, 0)} из {fmtNum(worst.from.count, 0)}).
            </p>
          </Card>
        )}

        <section aria-labelledby="steps-h">
          <Card className="!p-0">
            <h2 id="steps-h" className="h-serif px-5 pt-5 text-[22px] sm:px-6">Шаги {capped && <span className="text-[13px] text-ink-4">· по последним 100 000 регистрациям</span>}</h2>
            {total === 0 ? (
              <p className="px-6 py-6 text-[14px] text-ink-3">За период регистраций нет.</p>
            ) : (
              <div className="scroll-thin mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line">
                      {["Шаг", "Дошли", "", "% от шага", "% от всех", "Отвалились", "Медиана"].map((c, i) => <th key={i} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map((r, i) => {
                      const isWorst = worst && worst.to.key === r.key && worst.lossPct > 0;
                      return (
                        <tr key={r.key} className={cx(isWorst && "bg-rose-soft/60")}>
                          <th scope="row" className="px-4 py-3 pl-6 font-normal text-head"><span className="num mr-2 text-ink-4">{i + 1}</span>{r.label}</th>
                          <td className="num px-4 py-3 text-head">{fmtNum(r.count, 0)}</td>
                          <td className="w-[28%] px-4 py-3">
                            <div className="h-2 overflow-hidden rounded-full bg-head/10" aria-hidden><div className={cx("h-full rounded-full", r.key === "hired" ? "bg-green" : "bg-teal")} style={{ width: `${r.pctTotal}%` }} /></div>
                          </td>
                          <td className={cx("num px-4 py-3", i > 0 && r.pctStep < 30 ? "text-rose" : "text-ink-2")}>{i === 0 ? "—" : fmtPct(r.pctStep)}</td>
                          <td className="num px-4 py-3 text-ink-2">{fmtPct(r.pctTotal)}</td>
                          <td className="num px-4 py-3 text-ink-3">{i === 0 ? "—" : fmtNum(r.dropped, 0)}</td>
                          <td className="num px-4 py-3 pr-6 text-ink-2" title={r.timed ? `по ${r.timed} пользователям` : undefined}>{i === 0 ? "—" : days(r.medianDays)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="coh-h">
          <Card className="!p-0">
            <div className="px-5 pt-5 sm:px-6">
              <h2 id="coh-h" className="h-serif text-[22px]">Когорты по неделе регистрации</h2>
              <p className="mt-1 text-[13px] text-ink-3">Доля когорты, дошедшая до шага (на сегодня). Последние 12 недель периода.</p>
            </div>
            {cohorts.length === 0 ? (
              <p className="px-6 py-6 text-[14px] text-ink-3">Нет данных.</p>
            ) : (
              <div className="scroll-thin mt-4 overflow-x-auto">
                <table className="w-full min-w-[860px] text-left text-[13px]">
                  <thead>
                    <tr className="border-b border-line">
                      <th scope="col" className="label px-4 py-2.5 pl-6 !text-[11px] font-normal">Неделя</th>
                      {FUNNEL_STEPS.map((s) => <th key={s.key} scope="col" className="label px-3 py-2.5 !text-[11px] font-normal">{s.short}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cohorts.map((c) => (
                      <tr key={c.week}>
                        <th scope="row" className="whitespace-nowrap px-4 py-2.5 pl-6 font-normal text-head">с {fmtKey(c.week)}</th>
                        {c.reached.map((n, i) => {
                          const p = c.signups ? (n / c.signups) * 100 : 0;
                          return (
                            <td key={i} className="num px-3 py-2.5" style={i > 0 && p > 0 ? { backgroundColor: `rgb(26 110 72 / ${0.05 + (p / 100) * 0.3})` } : undefined}>
                              {i === 0 ? fmtNum(n, 0) : <>{fmtPct(p)} <span className="text-[11px] text-ink-4">{n}</span></>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}
