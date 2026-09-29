"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Smartphone } from "lucide-react";
import type { InvoiceView } from "@/lib/payments/kaspi";
import { Logo } from "@/components/ui";
import { fmtKzt } from "@/lib/engine/taxonomy";

const fmt = (n: number) => fmtKzt(n);

const ERRORS: Record<string, string> = {
  "campaign already active": "У тебя уже идёт кампания — повторная оплата не нужна.",
  "invoice expired": "Счёт истёк. Создай новый — это займёт секунду.",
  "payment limit reached": "Сейчас оплату провести не получилось. Попробуй позже.",
  "demo payment limit reached": "Сейчас оплату провести не получилось. Попробуй позже.",
  "too many attempts": "Слишком много попыток. Попробуй позже.",
  "not found": "Счёт не найден. Создай новый.",
};

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";

/**
 * Kaspi Pay invoice. When the gateway confirms in-page (mockGateway), the page shows a normal confirmation with a
 * single «Оплатить» action; otherwise it waits for the confirmation from the Kaspi app.
 */
export function KaspiCheckout({ initial, goal, mockGateway, newInvoiceHref }: { initial: InvoiceView; goal: string; mockGateway: boolean; newInvoiceHref: string }) {
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
  const waiting = (!mockGateway && (inv.status === "pending" || inv.status === "failed")) || (inv.status === "paid" && !inv.campaignId && !inv.activationBlocked);
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
        throw new Error(ERRORS[data.error] ?? data.error ?? `HTTP ${res.status}`);
      }
      setInv(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setBusy(false);
    }
  }

  const paid = inv.status === "paid";
  const failed = inv.status === "failed";
  const expired = inv.status === "expired";
  const expiredText = inv.expiredReason === "campaign_started" ? "Счёт закрыт: кампания уже запущена по другому счёту. Деньги по этому счёту не списаны." : "Счёт истёк: он действует 30 минут. Деньги не списаны.";
  // One persistent polite live region voices every non-error status change; declines and errors use role="alert".
  const statusText =
    paid && inv.activationBlocked && !inv.campaignId ? "Оплата получена, но у тебя уже идёт кампания — этот платёж будет возвращён."
    : paid && !inv.campaignId ? "Оплата получена, кампания запускается…"
    : paid ? "Кампания запущена. Переходим в кабинет…"
    : expired ? expiredText
    : busy ? "Оплата обрабатывается…"
    : !mockGateway && !failed ? "Ждём подтверждения от Kaspi…"
    : "";

  return (
    <>
    <div className="flex items-center justify-between">
      <Link href={paid ? "/app" : newInvoiceHref} className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green" aria-label={paid ? "Simplify — в кабинет" : "Simplify — назад к выбору плана"}><Logo /></Link>
      {/* Nothing to cancel once the money went through. */}
      {!paid && <Link href={newInvoiceHref} className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] text-ink-3 hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Отменить</Link>}
    </div>
    <div className="mt-10 flex flex-col gap-5 animate-rise">
      <p role="status" aria-live="polite" className="sr-only">{statusText}</p>
      <div className="flex flex-col gap-2">
        <span className="label">Оплата кампании</span>
        <h1 className="h-serif text-[clamp(30px,6vw,42px)]">{paid ? "Оплата прошла" : "Kaspi Pay"}</h1>
      </div>

      <div className="glass-strong flex flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[15px] font-medium text-head">{inv.planLabel} · 60 дней</div>
            {goal && <div className="mt-0.5 text-[13px] text-ink-3">{goal}</div>}
          </div>
          <div className="num text-[28px] leading-none text-head">{fmt(inv.amount)}</div>
        </div>
        <div className="flex items-center justify-between rounded-2xl bg-head/[.04] px-4 py-3 text-[13px]">
          <span className="text-ink-3">Счёт</span>
          <span className="font-mono text-[12px] text-head">{inv.invoiceId}</span>
        </div>

        {paid && inv.activationBlocked && !inv.campaignId ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[14px] text-amber">Оплата получена, но у тебя уже идёт кампания — этот платёж будет возвращён.</p>
        ) : paid && !inv.campaignId ? (
          <p className="flex items-center gap-2 rounded-2xl bg-green-soft px-4 py-3 text-[14px] text-green"><Loader2 className="size-4 animate-spin" aria-hidden />Оплата получена, кампания запускается…</p>
        ) : paid ? (
          <div className="flex items-center gap-3 rounded-2xl bg-green-soft px-4 py-4 text-green">
            <span className="grid size-9 place-items-center rounded-full bg-green text-white"><Check className="size-5" aria-hidden /></span>
            <div>
              <div className="text-[15px] font-medium">Кампания запущена</div>
              <div className="text-[13px] text-green/80">Агент уже ищет вакансии. Переходим в кабинет…</div>
            </div>
          </div>
        ) : expired ? (
          <div className="flex flex-col gap-3 rounded-2xl bg-amber-soft px-4 py-3.5">
            <p className="text-[14px] text-amber">{expiredText}</p>
            <Link href={newInvoiceHref} className={`inline-flex h-11 items-center justify-center self-start rounded-full bg-cta px-5 text-[14px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] ${focusRing}`}>
              Создать новый счёт
            </Link>
          </div>
        ) : !mockGateway ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">Подтверди оплату в приложении Kaspi. Статус обновится здесь автоматически.</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">Оплата отклонена. Можно попробовать ещё раз в приложении Kaspi.</p>}
            <p className="flex items-center gap-2 text-[13px] text-ink-3"><Loader2 className="size-3.5 animate-spin" aria-hidden />Ждём подтверждения от Kaspi…</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">Подтверди оплату в Kaspi. После оплаты кампания запустится автоматически.</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">Оплата отклонена. Можно попробовать ещё раз.</p>}
            {error && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">{error}</p>}
            <div className="flex flex-col items-stretch gap-3">
              <button type="button" onClick={pay} disabled={busy} aria-busy={busy || undefined} className={`inline-flex h-13 items-center justify-center gap-2 rounded-full bg-cta text-[15px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c] disabled:opacity-60 ${focusRing}`}>
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} Оплатить {fmt(inv.amount)}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
    </>
  );
}
