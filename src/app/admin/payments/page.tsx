import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Card, Chip, PageHeader, Script, Stat } from "@/components/ui";
import { PAYMENTS_PAGE, PAYMENT_STATUSES, paymentsPage, type PaymentFilter } from "@/lib/admin/queries";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { fmtNum, plural } from "@/lib/ru";
import { Pager } from "../_components/pager";
import { PAYMENT_STATUS, PLAN_LABEL, PROVIDER_LABEL, REFUND_REASON, fmtDateTime } from "../_components/fmt";

export const metadata = { title: "Платежи · Admin" };

const INVOICES = ["счёт", "счёта", "счетов"] as const;

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const status = one(sp.status);
  const plan = one(sp.plan);
  const provider = one(sp.provider);
  const f: PaymentFilter = {
    status: (PAYMENT_STATUSES as readonly string[]).includes(status) ? status : undefined,
    plan: Object.hasOwn(PLANS, plan) ? plan : undefined,
    // Any provider key is harmless as an equality filter; bounded and charset-checked anyway.
    provider: /^[a-z_]{1,32}$/.test(provider) ? provider : undefined,
    refund: one(sp.refund) === "1",
  };
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(sp.page) || "1", 10) || 1));
  const d = await paymentsPage(f, page);
  const pages = Math.max(1, Math.ceil(d.total / PAYMENTS_PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (f.status) u.set("status", f.status);
    if (f.provider) u.set("provider", f.provider);
    if (f.plan) u.set("plan", f.plan);
    if (f.refund) u.set("refund", "1");
    u.set("page", String(p));
    return `/admin/payments?${u}`;
  };
  const paid = d.byStatus.find((s) => s.status === "paid")!;

  return (
    <>
      <PageHeader eyebrow="Admin · платежи" title={<>Платежи и <Script>выручка</Script></>} sub="Все счета с фильтрами. Выручка — только реально полученные деньги, без возвратов." />

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card strong><Stat label="Выручка" tone="green" value={<span className="text-[26px]">{fmtKzt(d.revenue)}</span>} hint={paid.amount !== d.revenue ? `оплачено по счетам: ${fmtKzt(paid.amount)}` : "по фильтру"} /></Card>
          <Card><Stat label="Оплачено" value={fmtNum(paid.count, 0)} hint={plural(paid.count, INVOICES)} /></Card>
          <Card><Stat label="Возвраты" tone={d.refundedCount ? "rose" : undefined} value={fmtNum(d.refundedCount, 0)} hint={d.refunded ? fmtKzt(d.refunded) : "полных возвратов нет"} /></Card>
          <Card><Stat label="Не оплачено" value={fmtNum(d.byStatus.filter((s) => s.status !== "paid").reduce((a, s) => a + s.count, 0), 0)} hint={d.byStatus.filter((s) => s.status !== "paid" && s.count).map((s) => `${PAYMENT_STATUS[s.status]} ${s.count}`).join(" · ") || "—"} /></Card>
        </div>

        <Card className="!p-0">
          <form method="get" action="/admin/payments" className="flex flex-wrap items-end gap-3 px-5 pt-5 sm:px-6">
            <label className="flex flex-col gap-1"><span className="label">Статус</span>
              <select name="status" defaultValue={f.status ?? ""} className="field !h-10 !w-40 !py-0 !text-[14px]">
                <option value="">Все</option>
                {PAYMENT_STATUSES.map((s) => <option key={s} value={s}>{PAYMENT_STATUS[s]}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">Провайдер</span>
              <select name="provider" defaultValue={f.provider ?? ""} className="field !h-10 !w-52 !py-0 !text-[14px]">
                <option value="">Все</option>
                {d.providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="label">План</span>
              <select name="plan" defaultValue={f.plan ?? ""} className="field !h-10 !w-40 !py-0 !text-[14px]">
                <option value="">Все</option>
                {Object.keys(PLANS).map((p) => <option key={p} value={p}>{PLAN_LABEL[p] ?? p}</option>)}
              </select>
            </label>
            <label className="flex h-10 items-center gap-2 text-[13.5px] text-ink-2">
              <input type="checkbox" name="refund" value="1" defaultChecked={f.refund} className="size-4 accent-[#1a6e48]" />С возвратом
            </label>
            <button className="inline-flex h-10 items-center rounded-full bg-cta px-4 text-[13px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">Применить</button>
            {(f.status || f.provider || f.plan || f.refund) && <Link href="/admin/payments" className="inline-flex h-10 items-center rounded-full px-3 text-[13px] text-teal hover:bg-white/70">Сбросить</Link>}
            <span className="num ml-auto self-center text-[13px] text-ink-3">{fmtNum(d.total, 0)} {plural(d.total, INVOICES)}</span>
          </form>

          {d.rows.length === 0 ? (
            <p className="px-6 py-8 text-[14px] text-ink-3">Платежей по этому фильтру нет.</p>
          ) : (
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line">
                    {["Дата", "Пользователь", "План", "Сумма", "Статус", "Провайдер", "Отметки"].map((c) => <th key={c} scope="col" className="label px-4 py-2.5 !text-[11px] font-normal first:pl-6 last:pr-6">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.rows.map((p) => (
                    <tr key={p.id} className="hover:bg-white/50">
                      <td className="whitespace-nowrap px-4 py-2.5 pl-6 text-ink-2">{fmtDateTime(p.paidAt ?? p.createdAt)}</td>
                      <td className="max-w-[220px] truncate px-4 py-2.5">{p.userId ? <Link href={`/admin/users/${p.userId}`} className="text-head hover:underline">{p.user?.name || "Без имени"}</Link> : <span className="text-ink-4">аккаунт удалён</span>}</td>
                      <td className="px-4 py-2.5">{p.plan ? <Chip tone={p.plan === "international" ? "dark" : "teal"}>{PLAN_LABEL[p.plan] ?? p.plan}</Chip> : "—"}</td>
                      <td className="num whitespace-nowrap px-4 py-2.5 text-head">{fmtKzt(p.amount)}</td>
                      <td className="px-4 py-2.5"><Chip tone={p.status === "paid" ? "green" : p.status === "pending" ? "amber" : "neutral"}>{PAYMENT_STATUS[p.status] ?? p.status}</Chip></td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-[12.5px] text-ink-3">{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                      <td className="px-4 py-2.5 pr-6">
                        <span className="flex flex-wrap gap-1">
                          {p.refund.refunds.map((r, i) => <Chip key={i} tone="rose">{r.reason === "duplicate_charge" ? "частичный возврат" : "возврат"}: {REFUND_REASON[r.reason] ?? r.reason}</Chip>)}
                          {p.revenue && <Chip tone="green">в выручке</Chip>}
                          {p.partnerCode && <Chip>партнёр {p.partnerCode}</Chip>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pages={pages} href={qs} />
        </Card>
      </div>
    </>
  );
}
