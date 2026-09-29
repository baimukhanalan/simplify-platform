import { ArrowRight } from "lucide-react";
import { j } from "@/lib/db";
import { PLANS } from "@/lib/engine/taxonomy";
import { isKaspiProvider, providerLabel, refundState } from "@/lib/payments/kaspi";
import { ButtonLink, Card, Chip, Label } from "@/components/ui";
import { getT } from "@/lib/i18n/server";

type Payment = {
  id: string; amount: number; currency: string; provider: string; status: string; plan: string; externalId: string | null; meta: string;
  paidAt: Date | null; createdAt: Date; partnerCode: string | null; campaign: { plan: string } | null;
};

const STATUS_TONE: Record<string, "green" | "amber" | "rose" | "neutral"> = { paid: "green", pending: "amber", failed: "rose", expired: "neutral" };
const isStatus = (s: string): s is "paid" | "pending" | "failed" | "expired" => s in STATUS_TONE;

/** A pending invoice past its TTL is shown as expired even before the provider says so. */
function effectiveStatus(p: Payment, now = Date.now()) {
  if (p.status !== "pending") return p.status;
  const exp = j<{ expiresAt?: string }>(p.meta, {}).expiresAt;
  return exp && new Date(exp).getTime() < now ? "expired" : "pending";
}

export async function PaymentHistory({ payments }: { payments: Payment[] }) {
  const t = await getT();
  const date = (d: Date) => `${t.date(d, "dayMonthYear")}, ${t.time(d)}`;
  return (
    <section aria-labelledby="payments-h">
      <Card className="h-full">
        <Label className="mb-4"><span id="payments-h">{t("campaignPage.payments.title")}</span></Label>
        {payments.length === 0 ? (
          <p className="text-[14px] text-ink-3">{t("campaignPage.payments.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {payments.map((p) => {
              const status = effectiveStatus(p);
              const refund = refundState(p.meta);
              // A paid invoice with a refund promise: the whole payment (it never started a campaign) or an extra charge.
              const st = status === "paid" && refund.blocked ? { label: t("campaignPage.payments.refund"), tone: "amber" as const } : isStatus(status) ? { label: t(`campaignPage.payments.${status}`), tone: STATUS_TONE[status] } : { label: status, tone: "neutral" as const };
              const duplicates = refund.refunds.filter((r) => r.reason === "duplicate_charge").length;
              const planKey = (p.campaign?.plan ?? p.plan) as keyof typeof PLANS;
              return (
                <li key={p.id} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="text-[14px] text-head">{PLANS[planKey]?.label ?? "Career Campaign"}</div>
                      <div className="text-[12.5px] text-ink-3">{providerLabel(p.provider)} · {date(p.paidAt ?? p.createdAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="num text-[16px] text-head">{p.currency === "KZT" ? t.money(p.amount) : t.money(p.amount, p.currency)}</span>
                      <Chip tone={st.tone}>{st.label}</Chip>
                    </div>
                  </div>
                  {(p.externalId || p.partnerCode) && (
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
                      {p.externalId && <div className="flex min-w-0 gap-1.5"><dt>{t("campaignPage.payments.invoice")}</dt><dd className="break-all font-mono text-ink-2">{p.externalId}</dd></div>}
                      {p.partnerCode && <div className="flex gap-1.5"><dt>{t("campaignPage.payments.partner")}</dt><dd className="font-mono text-ink-2">{p.partnerCode}</dd></div>}
                    </dl>
                  )}
                  {status === "pending" && p.externalId && isKaspiProvider(p.provider) && (
                    <ButtonLink href={`/pay/kaspi/${p.externalId}`} size="sm" className="self-start">{t("campaignPage.payments.continuePay")}<ArrowRight className="size-3.5" aria-hidden /></ButtonLink>
                  )}
                  {status === "failed" && <p className="text-[12.5px] text-rose">{t("campaignPage.payments.failedNote")}</p>}
                  {status === "paid" && refund.blocked && <p className="text-[12.5px] text-amber">{t("campaignPage.payments.blockedNote")}</p>}
                  {status === "paid" && duplicates > 0 && <p className="text-[12.5px] text-amber">{t("campaignPage.payments.duplicateNote", { n: duplicates })}</p>}
                  {status === "expired" && (refund.expiredReason === "campaign_started"
                    ? <p className="text-[12.5px] text-ink-3">{t("campaignPage.payments.closedNote")}</p>
                    : <p className="text-[12.5px] text-ink-3">{t("campaignPage.payments.expiredNote")}</p>)}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}
