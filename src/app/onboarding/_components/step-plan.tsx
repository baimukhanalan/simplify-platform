import Link from "next/link";
import { Check, ShieldCheck, TicketPercent } from "lucide-react";
import { checkout } from "@/lib/actions/campaign";
import { PLANS, fmtKzt } from "@/lib/engine/taxonomy";
import { Chip, cx } from "@/components/ui";
import { LegalLinks } from "../../_components/legal-page";
import { PLAN_ORDER, type PlanKey } from "../../_components/plan-pref";
import { BackLink } from "./shared";
import { count } from "../../_components/ru";
import { PlanButton } from "./plan-button";

const COPY = {
  local: { note: "Казахстан и СНГ", features: ["Поиск и заявки по Казахстану и СНГ", `До ${PLANS.local.dailyLimit} заявок в день`, "CV под каждую вакансию", "Подготовка к интервью"] },
  international: { note: "Европа, США, Великобритания, Канада, удалённо по миру", features: ["Всё из Local / CIS", `До ${PLANS.international.dailyLimit} заявок в день`, "Визовые требования учитываются в каждой заявке", "Подготовка к интервью и помощь с оффером"] },
} as const;

/**
 * Step 5. Tiers are always listed Local first, then International. `preferred` is the plan picked on the landing page
 * (URL or cookie); `fit` is the plan that matches the goal regions. The highlighted card is the preferred one, else the fitting one.
 * Partner attribution comes only from the signup referral (user.referredByCode) — there is no code input here.
 */
export function StepPlan({ partner, activeCampaign, ended = null, preferred = null, fit = null }: { partner: string; activeCampaign: boolean; ended?: string | null; preferred?: PlanKey | null; fit?: PlanKey | null }) {
  if (activeCampaign) {
    return (
      <div className="glass flex flex-col items-start gap-3 p-6">
        <Chip tone="green" dot>Кампания активна</Chip>
        <p className="text-[15px] text-ink-2">Кампания уже идёт. Изменения профиля и цели агент учтёт в следующем цикле.</p>
        <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Открыть Today →</Link>
      </div>
    );
  }
  const featuredKey = preferred ?? fit;
  return (
    <form action={checkout} className="flex flex-col gap-5">
      {ended && (
        <p role="status" className="rounded-2xl border border-line bg-white/70 px-4 py-3 text-[14px] text-ink-2">
          {ended === "hired" ? "Прошлая кампания закрыта с оффером — отличный результат! " : "Прошлая кампания завершилась: её 60 дней прошли. "}
          Новая начнётся с текущей цели и профиля.
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_ORDER.map((k) => {
          const plan = PLANS[k];
          const featured = k === featuredKey;
          return (
            <section key={k} aria-labelledby={`plan-${k}`} className={cx("flex flex-col gap-5 p-6 sm:p-7", featured ? "glass-strong ring-1 ring-green/25" : "glass")}>
              <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <div className="flex flex-col gap-1">
                  <h2 id={`plan-${k}`} className="h-serif text-[26px]">{plan.label}</h2>
                  <p className="text-[13px] text-ink-3">{COPY[k].note}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 empty:hidden sm:flex-col sm:items-end">
                  {preferred === k && <Chip tone="green" dot>Выбрано на главной</Chip>}
                  {fit === k && <Chip tone={preferred === k ? "neutral" : "green"} dot={preferred !== k}>Подходит тебе</Chip>}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="num text-[38px] leading-none text-head">{fmtKzt(plan.priceKzt)}</span>
                <span className="label">/ {count(plan.days, ["день", "дня", "дней"])}</span>
              </div>
              <ul className="flex flex-col gap-2.5">
                {COPY[k].features.map((f) => <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>)}
              </ul>
              <PlanButton plan={k} featured={featured || !featuredKey}>Запустить · {plan.label}</PlanButton>
            </section>
          );
        })}
      </div>

      <div className="glass flex flex-col gap-3 p-5 sm:p-6">
        {partner && (
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <TicketPercent className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            Партнёр <span className="font-mono text-head">{partner}</span> учтён при регистрации.
          </p>
        )}
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
          <span>Оплата через Kaspi Pay, разовый платёж без автопродления. Simplify ведёт кампанию поиска, но не гарантирует трудоустройство. Оплачивая, ты принимаешь <LegalLinks />.</span>
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-5">
        <BackLink step={5} />
        <Link href="/app" className="inline-flex min-h-10 items-center rounded-full px-4 text-[13.5px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Выбрать позже</Link>
      </div>
    </form>
  );
}
