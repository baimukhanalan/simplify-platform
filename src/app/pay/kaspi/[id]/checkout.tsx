"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Gift, Loader2, Smartphone } from "lucide-react";
import type { InvoiceView } from "@/lib/payments/kaspi";
import { Logo } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/** API error codes (src/lib/payments/confirm.ts) → payPage.err.* */
const ERRORS = {
  "campaign already active": "campaignActive",
  "invoice expired": "invoiceExpired",
  "payment limit reached": "limit",
  "demo payment limit reached": "limit",
  "too many attempts": "tooMany",
  "not found": "notFound",
} as const;
const errorKey = (code: unknown) => (typeof code === "string" && code in ERRORS ? ERRORS[code as keyof typeof ERRORS] : null);

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";

/**
 * Kaspi Pay invoice. When the gateway confirms in-page (instant), the page shows a normal confirmation with a
 * single «Оплатить» action; otherwise it waits for the confirmation from the Kaspi app.
 */
export function KaspiCheckout({ initial, goal, instant, newInvoiceHref, discount = null }: { initial: InvoiceView; goal: string; instant: boolean; newInvoiceHref: string; discount?: { fullKzt: number; label: string } | null }) {
  const t = useT();
  const fmt = (n: number) => t.money(n);
  const router = useRouter();
  const [inv, setInv] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = useRef(false);
  const started = inv.status === "paid" && !!inv.campaignId;

  useEffect(() => {
    if (!started || done.current) return;
    done.current = true;
    const t = setTimeout(() => router.push("/app?started=1"), 1600);
    return () => clearTimeout(t);
  }, [started, router]);

  // Real flow: the customer confirms in the Kaspi app; we poll the invoice until the webhook settles it. A declined
  // attempt ("failed") is not final — the customer can retry in the app and a later success still settles this invoice.
  // Both flows: a paid invoice whose campaign isn't attached yet is polled until it is (or it is refunded instead).
  const waiting = (!instant && (inv.status === "pending" || inv.status === "failed")) || (inv.status === "paid" && !inv.campaignId && !inv.activationBlocked);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/payments/kaspi/invoices/${inv.invoiceId}`, { cache: "no-store" });
        if (res.ok) setInv(await res.json());
      } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [waiting, inv.invoiceId]);

  async function pay() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/kaspi/confirm/${inv.invoiceId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome: "success" }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 410) setInv((v) => ({ ...v, status: "expired" }));
        const k = errorKey(data?.error);
        throw new Error(k ? t(`payPage.err.${k}`) : t("payPage.err.generic"));
      }
      setInv(data);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("payPage.err.generic"));
    } finally {
      setBusy(false);
    }
  }

  const paid = inv.status === "paid";
  const failed = inv.status === "failed";
  const expired = inv.status === "expired";
  const expiredText = inv.expiredReason === "campaign_started" ? t("payPage.expiredClosed") : t("payPage.expired");
  // One persistent polite live region voices every non-error status change; declines and errors use role="alert".
  const statusText =
    paid && inv.activationBlocked && !inv.campaignId ? t("payPage.blocked")
    : paid && !inv.campaignId ? t("payPage.starting")
    : paid ? t("payPage.startedStatus")
    : expired ? expiredText
    : busy ? t("payPage.processing")
    : !instant && !failed ? t("payPage.waiting")
    : "";

  return (
    <>
    <div className="flex items-center justify-between">
      <Link href={paid ? "/app" : newInvoiceHref} className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label={paid ? t("payPage.homeAria") : t("payPage.backAria")}><Logo /></Link>
      {/* Nothing to cancel once the money went through. */}
      {!paid && <Link href={newInvoiceHref} className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] text-ink-3 hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("payPage.cancel")}</Link>}
    </div>
    <div className="mt-10 flex flex-col gap-5 animate-rise">
      <p role="status" aria-live="polite" className="sr-only">{statusText}</p>
      <div className="flex flex-col gap-2">
        <span className="label">{t("payPage.eyebrow")}</span>
        <h1 className="h-serif text-[clamp(30px,6vw,42px)]">{paid ? t("payPage.paidTitle") : "Kaspi Pay"}</h1>
      </div>

      <div className="glass-strong flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[15px] font-medium text-head">{t("payPage.planDays", { plan: inv.planLabel, n: 60 })}</div>
            {goal && <div className="mt-0.5 break-words text-[13px] text-ink-3" lang="ru">{goal}</div>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {discount && discount.fullKzt > inv.amount && <s className="num text-[15px] leading-none text-ink-3"><span className="sr-only">{t("payPage.withoutDiscount")}</span>{fmt(discount.fullKzt)}</s>}
            <div className="num text-[28px] leading-none text-head">{fmt(inv.amount)}</div>
          </div>
        </div>
        {discount && discount.fullKzt > inv.amount && (
          <p className="-mt-2 inline-flex items-center gap-2 self-start rounded-full bg-green-soft px-3 py-1.5 text-[13px] text-green">
            <Gift className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />{discount.label}
          </p>
        )}
        <div className="flex items-center justify-between rounded-2xl bg-head/[.04] px-4 py-3 text-[13px]">
          <span className="text-ink-3">{t("payPage.invoice")}</span>
          <span className="break-all font-mono text-[12px] text-head">{inv.invoiceId}</span>
        </div>

        {paid && inv.activationBlocked && !inv.campaignId ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[14px] text-amber">{t("payPage.blocked")}</p>
        ) : paid && !inv.campaignId ? (
          <p className="flex items-center gap-2 rounded-2xl bg-green-soft px-4 py-3 text-[14px] text-green"><Loader2 className="size-4 animate-spin" aria-hidden />{t("payPage.starting")}</p>
        ) : paid ? (
          <div className="flex items-center gap-3 rounded-2xl bg-green-soft px-4 py-4 text-green">
            <span className="grid size-9 place-items-center rounded-full bg-green text-white"><Check className="size-5" aria-hidden /></span>
            <div>
              <div className="text-[15px] font-medium">{t("payPage.startedTitle")}</div>
              <div className="text-[13px] text-green/80">{t("payPage.startedText")}</div>
            </div>
          </div>
        ) : expired ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-amber-soft px-4 py-3.5">
            <p className="text-[14px] text-amber">{expiredText}</p>
            <Link href={newInvoiceHref} className={`inline-flex h-11 items-center justify-center self-start rounded-full bg-cta px-5 text-[14px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] ${focusRing}`}>
              {t("payPage.newInvoice")}
            </Link>
          </div>
        ) : !instant ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">{t("payPage.confirmApp")}</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">{t("payPage.declinedApp")}</p>}
            <p className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden />{t("payPage.waiting")}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">{t("payPage.confirmInstant")}</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">{t("payPage.declined")}</p>}
            {error && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">{error}</p>}
            <div className="flex flex-col items-stretch gap-3">
              <button type="button" onClick={pay} disabled={busy} aria-busy={busy || undefined} className={`inline-flex h-13 items-center justify-center gap-2 rounded-full bg-cta text-[15px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c] disabled:opacity-60 ${focusRing}`}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} {t("payPage.pay", { amount: fmt(inv.amount) })}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
    </>
  );
}
