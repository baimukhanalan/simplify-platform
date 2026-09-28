"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Smartphone, X } from "lucide-react";
import type { InvoiceView } from "@/lib/payments/kaspi";

const fmt = (n: number) => `${n.toLocaleString("ru-RU")} ₸`;

export function KaspiCheckout({ initial, goal }: { initial: InvoiceView; goal: string }) {
  const router = useRouter();
  const [inv, setInv] = useState(initial);
  const [busy, setBusy] = useState<"success" | "fail" | null>(null);
  const [error, setError] = useState("");
  const [log, setLog] = useState<string[]>([`POST /api/payments/kaspi/invoices → 201 · ${initial.invoiceId}`]);
  const done = useRef(false);

  useEffect(() => {
    if (inv.status !== "paid" || done.current) return;
    done.current = true;
    const t = setTimeout(() => router.push("/app?started=1"), 1600);
    return () => clearTimeout(t);
  }, [inv.status, router]);

  async function pay(outcome: "success" | "fail") {
    setBusy(outcome);
    setError("");
    setLog((l) => [...l, `POST /api/payments/kaspi/mock/${inv.invoiceId}/pay {outcome:"${outcome}"}`]);
    try {
      const res = await fetch(`/api/payments/kaspi/mock/${inv.invoiceId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
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

        {paid ? (
          <div className="flex items-center gap-3 rounded-2xl bg-green-soft px-4 py-4 text-green" role="status">
            <span className="grid size-9 place-items-center rounded-full bg-green text-white"><Check className="size-5" /></span>
            <div>
              <div className="text-[15px] font-medium">Кампания запущена</div>
              <div className="text-[13px] text-green/80">Агент уже ищет вакансии. Переходим в кабинет…</div>
            </div>
          </div>
        ) : expired ? (
          <p className="rounded-2xl bg-amber-soft px-4 py-3 text-[14px] text-amber">Счёт истёк. Вернитесь и создайте новый.</p>
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

      <details className="rounded-2xl border border-line bg-white/40 px-4 py-3 text-[12px] text-ink-3">
        <summary className="cursor-pointer select-none font-mono uppercase tracking-[.06em]">Тестовый режим · журнал API</summary>
        <ul className="mt-2 flex flex-col gap-1 font-mono text-[11.5px]">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
    </div>
  );
}
