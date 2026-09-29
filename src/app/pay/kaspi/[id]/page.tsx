import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { KASPI_PROVIDERS, mockEnabled, view } from "@/lib/payments/kaspi";
import { referralDiscountOf } from "@/lib/referral";
import { LegalFooterLinks, OfferAcceptance } from "../../../_components/legal-page";
import { KaspiCheckout } from "./checkout";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("payPage.meta"), robots: { index: false } };
}

export default async function KaspiPayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [user, t] = await Promise.all([requireUser(), getT()]);
  const [p, hadCampaign] = await Promise.all([
    db.payment.findFirst({ where: { externalId: id, userId: user.id, provider: { in: KASPI_PROVIDERS } } }),
    db.campaign.count({ where: { userId: user.id, status: { not: "draft" } } }),
  ]);
  if (!p) notFound();
  // view() reports a pending invoice past its TTL as expired — the same rule the polling API uses.
  const initial = view(p);
  // Back to where the plan was chosen: onboarding step 5 for a first campaign, the Campaign page otherwise.
  const back = hadCampaign ? "/app/campaign" : `/onboarding?step=5&plan=${encodeURIComponent(p.plan)}`;
  // The stored discount label is Russian; rebuild it in the current language («друга» is referralDiscountOf's fallback name).
  const ref = referralDiscountOf(p.meta);
  const discount = ref ? { fullKzt: ref.fullKzt, label: t("payPage.discount", { pct: ref.pct, name: ref.from === "друга" ? t("payPage.friend") : ref.from }) } : null;
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:py-14">
      {/*
        The in-page «Оплатить» exists only when KASPI_MODE=mock; otherwise the page waits for the Kaspi confirmation.
        The header (with «Отменить») lives in the client component: it disappears once the payment has gone through.
      */}
      <I18nScope ns={["payPage"]}>
        <KaspiCheckout initial={initial} goal={user.goal?.primaryRole ?? ""} instant={mockEnabled() && initial.instant} newInvoiceHref={back} discount={discount} />
      </I18nScope>
      <p className="mt-8 text-center text-[12px] leading-relaxed text-ink-3">
        <OfferAcceptance /> {t("payPage.noEmploymentGuarantee")}
      </p>
      <LegalFooterLinks className="mt-3" />
    </main>
  );
}
