"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Smartphone, X } from "lucide-react";
import type { InvoiceView } from "@/lib/payments/kaspi";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

const ERRORS: Record<string, string> = {
  "campaign already active": "У вас уже идёт кампания — повторная оплата не нужна.",
  "invoice expired": "Счёт истёк. Вернитесь и создайте новый.",
  "demo payment limit reached": "Лимит тестовых оплат на сегодня исчерпан. Попробуйте завтра.",
  "too many attempts": "Слишком много попыток. Попробуйте позже.",
  "not found": "Тестовая оплата недоступна.",
};

export function KaspiCheckout({ initial, goal, mockGateway }: { initial: InvoiceView; goal: string; mockGateway: boolean }) {
  const router = useRouter();
  const [inv, setInv] = useState(initial);
  const [busy, setBusy] = useState<"success" | "fail" | null>(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([`POST /api/payments/kaspi/invoices → 201 · ${initial.invoiceId}`]);
  const done = useRef(false);
  const started = inv.status === "paid" && !!inv.campaignId;

  useEffect(() => {
    if (!started || done.current) return;
    done.current = true;
    const t = setTimeout(() => router.push("/app?started=1"), 1600);
    return () => clearTimeout(t);
  }, [started, router]);

  // Real flow: the customer confirms in the Kaspi app; we poll the invoice until the webhook settles it.
  // Both flows: a paid invoice whose campaign isn't attached yet is polled until it is (or turns refund_due).
  const waiting = (!mockGateway && inv.status === "pending") || (inv.status === "paid" && !inv.campaignId && !inv.refundDue);
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

  async function pay(outcome: "success" | "fail") {
    setBusy(outcome);
    setError("");
    setLog((l) => [...l, `POST /api/payments/kaspi/mock/${inv.invoiceId}/pay {outcome:"${outcome}"}`]);
    try {
      const res = await fetch(`/api/payments/kaspi/mock/${inv.invoiceId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }) });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 410) setInv((v) => ({ ...v, status: "expired" }));
        throw new Error(ERRORS[data.error] ?? data.error ?? `HTTP ${res.status}`);
      }
      setLog((l) => [...l, `→ webhook payment.${outcome === "success" ? "succeeded" : "failed"} (HMAC ✓) → ${data.status}`]);
      setInv(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка оплаты");
    } finally {
      setBusy(null);
    }
  }

  const paid = inv.status === "paid";
  const failed = inv.status === "failed";
  const expired = inv.status === "expired";

  return (
    <div className="mt-10 flex flex-col gap-5 animate-rise">
      <div className="flex flex-col gap-2">
        <span className="label">Оплата Career Campaign</span>
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

        {paid && inv.refundDue && !inv.campaignId ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[14px] text-amber" role="status">Оплата получена, но у вас уже идёт кампания — этот платёж будет возвращён.</p>
        ) : paid && !inv.campaignId ? (
          <p className="flex items-center gap-2 rounded-2xl bg-green-soft px-4 py-3 text-[14px] text-green" role="status"><Loader2 className="size-4 animate-spin" />Оплата получена, запускаем кампанию…</p>
        ) : paid ? (
          <div className="flex items-center gap-3 rounded-2xl bg-green-soft px-4 py-4 text-green" role="status">
            <span className="grid size-9 place-items-center rounded-full bg-green text-white"><Check className="size-5" /></span>
            <div>
              <div className="text-[15px] font-medium">Кампания запущена</div>
              <div className="text-[13px] text-green/80">Агент уже ищет вакансии. Переходим в кабинет…</div>
            </div>
          </div>
        ) : expired ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[14px] text-amber">Счёт истёк. Вернитесь и создайте новый.</p>
        ) : !mockGateway ? (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">Подтвердите оплату в приложении Kaspi. Статус обновится здесь автоматически.</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose">Оплата отклонена. Можно попробовать ещё раз в приложении Kaspi.</p>}
            <p className="flex items-center gap-2 text-[13px] text-ink-3" role="status"><Loader2 className="size-3.5 animate-spin" />Ждём подтверждения от Kaspi…</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-white/70 px-4 py-4">
              <Smartphone className="size-6 shrink-0 text-teal" strokeWidth={1.6} />
              <p className="text-[13.5px] leading-relaxed text-ink-2">В боевом режиме здесь откроется подтверждение в приложении Kaspi. Сейчас это тестовая оплата — деньги не списываются.</p>
            </div>
            {failed && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose">Оплата отклонена. Можно попробовать ещё раз.</p>}
            {error && <p className="rounded-2xl bg-rose-soft px-4 py-3 text-[14px] text-rose" role="alert">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => pay("success")} disabled={!!busy} className="inline-flex h-13 flex-1 items-center justify-center gap-2 rounded-full bg-cta text-[15px] font-medium text-white shadow-(--shadow-cta) transition hover:bg-[#2f2c2c] disabled:opacity-60">
                {busy === "success" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Оплатить {fmt(inv.amount)}
              </button>
              <button onClick={() => pay("fail")} disabled={!!busy} className="glass inline-flex h-13 items-center justify-center gap-2 !rounded-full px-5 text-[14px] text-head hover:bg-white disabled:opacity-60">
                {busy === "fail" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Отклонить
              </button>
            </div>
          </>
        )}
      </div>

      {mockGateway && <details className="rounded-2xl border border-line bg-white/40 px-4 py-3 text-[12px] text-ink-3">
        <summary className="cursor-pointer select-none font-mono uppercase tracking-[.06em]">Тестовый режим · журнал API</summary>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[11.5px]">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>}
    </div>
  );
}
