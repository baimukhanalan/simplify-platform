import Link from "next/link";
import { Check, ShieldCheck, TicketPercent } from "lucide-react";
import { checkout } from "@/lib/actions/campaign";
import { PLANS } from "@/lib/engine/taxonomy";
import { Chip, cx } from "@/components/ui";
import { DocLink } from "../../_components/legal-page";
import { PLAN_ORDER, type PlanKey } from "../../_components/plan-pref";
import { BackLink } from "./shared";
import { getT } from "@/lib/i18n/server";
import { planCopy } from "@/lib/i18n/labels";
import { PlanButton } from "./plan-button";
import { referralPrice, type ReferralOffer } from "@/lib/referral";

/**
 * Step 5. Tiers are always listed Local first, then International. `preferred` is the plan picked on the landing page
 * (URL or cookie); `fit` is the plan that matches the goal regions. The highlighted card is the preferred one, else the fitting one.
 * Partner attribution comes only from the signup referral (user.referredByCode) — there is no code input here.
 */
export async function StepPlan({ partner, activeCampaign, ended = null, preferred = null, fit = null, offer = null }: { partner: string; offer?: ReferralOffer | null; activeCampaign: boolean; ended?: string | null; preferred?: PlanKey | null; fit?: PlanKey | null }) {
  const t = await getT();
  const fmtKzt = (n: number) => t.money(n, "KZT");
  if (activeCampaign) {
    return (
      <div className="glass flex flex-col items-start gap-3 p-6">
        <Chip tone="green" dot>{t("onboarding.active")}</Chip>
        <p className="text-[15px] text-ink-2">{t("onboarding.activeText")}</p>
        <Link href="/app" className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">{t("onboarding.openToday")}</Link>
      </div>
    );
  }
  const featuredKey = preferred ?? fit;
  return (
    <form action={checkout} className="flex flex-col gap-5">
      {ended && (
        <p role="status" className="rounded-2xl border border-line bg-white/70 px-4 py-3 text-[14px] text-ink-2">
          {ended === "hired" ? t("onboarding.endedHired") : t("onboarding.endedExpired")}
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {PLAN_ORDER.map((k) => {
          const plan = PLANS[k];
          const featured = k === featuredKey;
          const copy = planCopy(t, k, plan.dailyLimit);
          return (
            <section key={k} aria-labelledby={`plan-${k}`} className={cx("flex flex-col gap-5 p-6 sm:p-7", featured ? "glass-strong ring-1 ring-green/25" : "glass")}>
              <div className="flex flex-col-reverse items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                <div className="flex flex-col gap-1">
                  <h2 id={`plan-${k}`} className="h-serif text-[26px]">{plan.label}</h2>
                  <p className="text-[13px] text-ink-3">{copy.note}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 empty:hidden sm:flex-col sm:items-end">
                  {preferred === k && <Chip tone="green" dot>{t("onboarding.pickedOnHome")}</Chip>}
                  {fit === k && <Chip tone={preferred === k ? "neutral" : "green"} dot={preferred !== k}>{t("onboarding.fitsYou")}</Chip>}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="num text-[38px] leading-none text-head">{fmtKzt(offer ? referralPrice(plan.priceKzt).amount : plan.priceKzt)}</span>
                  {offer && <s className="num text-[15px] text-ink-3"><span className="sr-only">{t("onboarding.noDiscount")} </span>{fmtKzt(plan.priceKzt)}</s>}
                  <span className="label">/ {t("plans.days", { n: plan.days })}</span>
                </div>
                {offer && <span className="text-[12.5px] text-green">{t("onboarding.inviteDiscount", { pct: String(offer.pct), name: offer.referrerName })}</span>}
              </div>
              <ul className="flex flex-col gap-2.5">
                {copy.features.map((f) => <li key={f} className="flex items-start gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{f}</li>)}
              </ul>
              <PlanButton plan={k} featured={featured || !featuredKey}>{t("onboarding.launchPlan", { plan: plan.label })}</PlanButton>
            </section>
          );
        })}
      </div>

      <div className="glass flex flex-col gap-3 p-5 sm:p-6">
        {partner && (
          <p className="flex items-center gap-2 text-[13px] text-ink-2">
            <TicketPercent className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <span>{t.rich("onboarding.partner", { code: partner }, { b: (c) => <span className="font-mono text-head">{c}</span> })}</span>
          </p>
        )}
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />
          <span>{t("onboarding.payNote")} {t.rich("onboarding.payAccept", {}, { offer: (c) => <DocLink doc="offer">{c}</DocLink>, refund: (c) => <DocLink doc="refund">{c}</DocLink> })}</span>
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-line pt-5">
        <BackLink step={5} />
        <Link href="/app" className="inline-flex min-h-10 items-center rounded-full px-4 text-[13.5px] text-ink-3 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("onboarding.chooseLater")}</Link>
      </div>
    </form>
  );
}
