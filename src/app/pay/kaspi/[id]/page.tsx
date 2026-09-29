import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { KASPI_PROVIDERS, mockEnabled, view } from "@/lib/payments/kaspi";
import { LegalLinks } from "../../../_components/legal-page";
import { KaspiCheckout } from "./checkout";

export const metadata = { title: "Оплата кампании", robots: { index: false } };

export default async function KaspiPayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser();
  const [p, hadCampaign] = await Promise.all([
    db.payment.findFirst({ where: { externalId: id, userId: user.id, provider: { in: KASPI_PROVIDERS } } }),
    db.campaign.count({ where: { userId: user.id, status: { not: "draft" } } }),
  ]);
  if (!p) notFound();
  // view() reports a pending invoice past its TTL as expired — the same rule the polling API uses.
  const initial = view(p);
  // Back to where the plan was chosen: onboarding step 5 for a first campaign, the Campaign page otherwise.
  const back = hadCampaign ? "/app/campaign" : `/onboarding?step=5&plan=${encodeURIComponent(p.plan)}`;
  const debug = (Array.isArray(sp.debug) ? sp.debug[0] : sp.debug) === "1";
  return (
    <main id="main-content" tabIndex={-1} className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-4 py-8 sm:py-14">
      {/*
        The mock pay buttons exist only when KASPI_MODE=mock; otherwise the page waits for the real Kaspi confirmation.
        The header (with «Отменить») lives in the client component: it disappears once the payment has gone through.
        «Тест: отклонить» is a testing aid — only with ?debug=1 or in local development.
      */}
      <KaspiCheckout initial={initial} goal={user.goal?.primaryRole ?? ""} mockGateway={mockEnabled() && initial.mock} newInvoiceHref={back} showLog={debug} showDecline={debug || process.env.NODE_ENV !== "production"} />
      <p className="mt-8 text-center text-[12px] leading-relaxed text-ink-3">
        Оплачивая, ты принимаешь <LegalLinks />. Simplify не гарантирует трудоустройство.
      </p>
    </main>
  );
}
