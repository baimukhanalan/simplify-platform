import Link from "next/link";
import { Play } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, PageHeader, Script, Stat, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { adminRunTick } from "@/lib/actions/admin";
import { LOW_READINESS, STUCK_REASONS, stuckCampaigns, type StuckReason } from "@/lib/admin/queries";
import { fmtNum } from "@/lib/ru";
import { PLAN_LABEL, ago, fmtDate, clock } from "../_components/fmt";

// adminRunTick runs a full agent cycle from this page.
export const maxDuration = 300;

export const metadata = { title: "Застрявшие кампании · Admin" };

const HINT: Record<StuckReason, string> = {
  no_cycle: "агент не запускался больше суток",
  no_apps: "идёт 3+ дня, ни одной заявки",
  low_readiness: `Readiness ниже ${LOW_READINESS}`,
  no_replies: "14+ дней с заявками, но без ответов",
  guarantee: "до конца ≤ 7 дней, интервью нет",
};

export default async function StuckCampaignsPage() {
  await requireAdmin();
  const d = await stuckCampaigns();
  const now = clock();
  const reasons = Object.keys(STUCK_REASONS) as StuckReason[];

  return (
    <>
      <PageHeader eyebrow="Admin · кампании" title={<>Застрявшие <Script>кампании</Script></>} sub="Активные кампании, которым нужна помощь: агент не работает, нет заявок или ответов, скоро конец без интервью." />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Card><Stat label="Активных" value={fmtNum(d.active, 0)} hint={d.paused ? `на паузе: ${d.paused}` : "без пауз"} /></Card>
          {reasons.map((r) => (
            <Card key={r}><Stat label={STUCK_REASONS[r].label} tone={d.counts[r] && STUCK_REASONS[r].tone === "rose" ? "rose" : undefined} value={fmtNum(d.counts[r], 0)} hint={HINT[r]} /></Card>
          ))}
        </div>

        <Card className="!p-0">
          <div className="flex items-center justify-between gap-2 px-5 pt-5 sm:px-6">
            <h2 className="h-serif text-[22px]">Требуют внимания</h2>
            <Chip tone={d.stuck.length ? "amber" : "green"} dot>{d.stuck.length}</Chip>
          </div>
          {d.capped && <p className="px-6 pt-2 text-[12.5px] text-ink-4">Проверены первые 5 000 активных кампаний.</p>}
          {d.stuck.length === 0 ? (
            <p className="px-6 py-8 text-[14px] text-ink-3">Все активные кампании идут нормально.</p>
          ) : (
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line">
                    {["Пользователь", "Причины", "День", "Заявки", "Ответы", "Интервью", "Readiness", "Последний цикл", ""].map((c, i) => <th key={i} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.stuck.map((c) => (
                    <tr key={c.id} className="align-top hover:bg-white/50">
                      <th scope="row" className="max-w-[220px] px-4 py-3 pl-6 font-normal">
                        <Link href={`/admin/users/${c.userId}`} className="block truncate font-medium text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">{c.name || "Без имени"}</Link>
                        <span className="text-[12px] text-ink-4">{PLAN_LABEL[c.plan] ?? c.plan}{c.endsAt ? ` · до ${fmtDate(c.endsAt)}` : ""}</span>
                      </th>
                      <td className="max-w-[320px] px-4 py-3">
                        <span className="flex flex-wrap gap-1">
                          {c.reasons.map((r) => <Chip key={r} tone={STUCK_REASONS[r].tone} wrap>{STUCK_REASONS[r].label}</Chip>)}
                          {c.guaranteeStatus === "extended" && <Chip tone="green">гарантия: продлена</Chip>}
                          {c.overdue && <Chip>срок вышел</Chip>}
                          {c.pending > 0 && <Chip tone="amber">вопросов: {c.pending}</Chip>}
                        </span>
                      </td>
                      <td className="num whitespace-nowrap px-4 py-3">{c.day ? <>{c.day.day}<span className="text-ink-4">/{c.day.total}</span></> : "—"}</td>
                      <td className={cx("num px-4 py-3", c.applications === 0 && "text-rose")}>{c.applications}</td>
                      <td className="num px-4 py-3">{c.replies}</td>
                      <td className="num px-4 py-3">{c.interviews}</td>
                      <td className={cx("num px-4 py-3", c.readiness < LOW_READINESS && "text-amber")}>{c.readiness}</td>
                      <td className={cx("whitespace-nowrap px-4 py-3 text-[12.5px]", c.reasons.includes("no_cycle") ? "text-rose" : "text-ink-3")}>{ago(c.lastRunAt, now)}</td>
                      <td className="px-4 py-3 pr-6 text-right">
                        <form action={adminRunTick}>
                          <input type="hidden" name="campaignId" value={c.id} />
                          <SubmitButton size="sm" variant="glass" pendingText="Цикл…" disabled={c.status !== "active" || c.overdue} aria-label={`Запустить цикл агента для ${c.name}`}>
                            <Play className="size-3.5" strokeWidth={1.7} />Run tick
                          </SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="text-[12.5px] text-ink-4">Кандидаты на гарантию — кампании, где до конца осталось не больше 7 дней, а квалифицированных интервью нет. Полный список активных кампаний — в разделе <Link href="/admin/ops" className="text-teal hover:underline">Операции</Link>.</p>
      </div>
    </>
  );
}
