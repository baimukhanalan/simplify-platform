import { ArrowRight } from "lucide-react";
import { j } from "@/lib/db";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { ButtonLink, Card, Chip, Label } from "@/components/ui";

type Payment = {
  id: string; amount: number; currency: string; provider: string; status: string; plan: string; externalId: string | null; meta: string;
  paidAt: Date | null; createdAt: Date; partnerCode: string | null; campaign: { plan: string } | null;
};

const PROVIDER: Record<string, string> = { kaspi_mock: "Kaspi Pay · тестовый шлюз", test: "Тестовый платёж" };
const STATUS: Record<string, { label: string; tone: "green" | "amber" | "rose" | "neutral" }> = {
  paid: { label: "Paid", tone: "green" },
  pending: { label: "Pending", tone: "amber" },
  failed: { label: "Failed", tone: "rose" },
  expired: { label: "Expired", tone: "neutral" },
};

const date = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** A pending invoice past its TTL is shown as expired even before the provider says so. */
function effectiveStatus(p: Payment, now = Date.now()) {
  if (p.status !== "pending") return p.status;
  const exp = j<{ expiresAt?: string }>(p.meta, {}).expiresAt;
  return exp && new Date(exp).getTime() < now ? "expired" : "pending";
}

export function PaymentHistory({ payments }: { payments: Payment[] }) {
  return (
    <section aria-labelledby="payments-h">
      <Card className="h-full">
        <Label className="mb-4"><span id="payments-h">История платежей</span></Label>
        {payments.length === 0 ? (
          <p className="text-[14px] text-ink-3">Платежей пока нет. После оплаты через Kaspi Pay счёт появится здесь.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {payments.map((p) => {
              const status = effectiveStatus(p);
              const st = STATUS[status] ?? { label: status, tone: "neutral" as const };
              const planKey = (p.campaign?.plan ?? p.plan) as keyof typeof PLANS;
              return (
                <li key={p.id} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="text-[14px] text-head">{PLANS[planKey]?.label ?? "Career Campaign"}</div>
                      <div className="text-[12.5px] text-ink-3">{PROVIDER[p.provider] ?? p.provider} · {date(p.paidAt ?? p.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num text-[16px] text-head">{p.currency === "KZT" ? fmtKzt(p.amount) : `${p.amount} ${p.currency}`}</span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                  </div>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
                    <div className="flex gap-1.5"><dt>Invoice</dt><dd className="break-all font-mono text-ink-2">{p.externalId ?? "—"}</dd></div>
                    {p.partnerCode && <div className="flex gap-1.5"><dt>Партнёр</dt><dd className="font-mono text-ink-2">{p.partnerCode}</dd></div>}
                  </dl>
                  {status === "pending" && p.externalId && p.provider === "kaspi_mock" && (
                    <ButtonLink href={`/pay/kaspi/${p.externalId}`} size="sm" className="self-start">Продолжить оплату<ArrowRight className="size-3.5" aria-hidden /></ButtonLink>
                  )}
                  {status === "failed" && <p className="text-[12.5px] text-rose">Kaspi отклонил оплату. Деньги не списаны.</p>}
                  {status === "expired" && <p className="text-[12.5px] text-ink-4">Счёт истёк через 30 минут без оплаты.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
