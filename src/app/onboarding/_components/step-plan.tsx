import Link from "next/link";
import { Check, ShieldCheck, TicketPercent } from "lucide-react";
import { checkout } from "@/lib/actions/campaign";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { Chip } from "@/components/ui";
import { BackLink } from "./shared";
import { PlanButton } from "./plan-button";

const COPY = {
  local: { note: "Казахстан и СНГ", features: ["Поиск по KZ и СНГ", "До 6 заявок в день", "CV под каждую вакансию · Truth Lock", "Pipeline, Inbox, Interview Room", "Interview Copilot"] },
  international: { note: "EU, UK, US, Canada, MENA, remote по миру", features: ["Всё из Local / CIS", "До 10 заявок в день", "Проверка права на работу и спонсорства", "Interview Copilot", "Offer Desk: переговоры по офферу"] },
} as const;

export function StepPlan({ partner, activeCampaign }: { partner: string; activeCampaign: boolean }) {
  if (activeCampaign) {
    return (
      <div className="glass flex flex-col items-start gap-3 p-6">
        <Chip tone="green" dot>Кампания активна</Chip>
        <p className="text-[15px] text-ink-2">У вас уже идёт Career Campaign. Изменения профиля и цели агент учтёт в следующем цикле.</p>
        <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Открыть кабинет →</Link>
      </div>
    );
  }
  return (
    <form action={checkout} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        {(["local", "international"] as const).map((k) => {
          const plan = PLANS[k];
          const featured = k === "international";
          return (
            <div key={k} className={featured ? "glass-strong flex flex-col gap-5 p-6 ring-1 ring-green/15 sm:p-7" : "glass flex flex-col gap-5 p-6 sm:p-7"}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <div className="h-serif text-[26px]">{plan.label}</div>
                  <p className="text-[13px] text-ink-3">{COPY[k].note}</p>
                </div>
                {featured && <Chip tone="green">Popular</Chip>}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="num text-[38px] leading-none text-head">{fmtKzt(plan.priceKzt)}</span>
                <span className="label">/ {plan.days} дней</span>
              </div>
              <ul className="flex flex-col gap-2.5">
                {COPY[k].features.map((f) => <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>)}
              </ul>
              <PlanButton plan={k} featured={featured}>Start your campaign · {plan.label}</PlanButton>
            </div>
          );
        })}
      </div>

      <div className="glass flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <label className="flex w-full flex-col gap-1.5 sm:max-w-xs">
          <span className="label">Код партнёра</span>
          <span className="relative">
            <TicketPercent className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-teal" strokeWidth={1.7} aria-hidden />
            <input name="partner" defaultValue={partner} maxLength={32} autoComplete="off" className="field !pl-10 font-mono uppercase tracking-[.06em]" />
          </span>
        </label>
        <p className="flex max-w-md items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
          Тестовый режим оплаты — списания не происходит. Simplify исполняет кампанию поиска, но не гарантирует трудоустройство.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-5">
        <BackLink step={7} />
        <Link href="/app" className="rounded-full px-4 py-2 text-[13.5px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Выбрать позже</Link>
      </div>
    </form>
  );
}
