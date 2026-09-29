import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { db } from "@/lib/db";
import { GUARANTEE_TITLE, showGuaranteeBanner } from "@/lib/engine/guarantee";
import { getT } from "@/lib/i18n/server";

type BannerCampaign = { userId: string; status: string; endsAt: Date | null; guaranteeStatus: string; guaranteeExtendedAt: Date | null };

/**
 * Today: a calm note in the first days after the interview guarantee extended the campaign. Renders nothing otherwise —
 * and nothing while the moment layer (app layout) is showing the same news as the newest unread notification
 * (matched by the stored Russian GUARANTEE_TITLE, which is DB data and stays untranslated).
 */
export async function GuaranteeBanner({ campaign }: { campaign: BannerCampaign }) {
  if (!showGuaranteeBanner(campaign)) return null;
  const [newest, t] = await Promise.all([
    db.notification.findFirst({ where: { userId: campaign.userId, readAt: null }, orderBy: { createdAt: "desc" }, select: { title: true } }),
    getT(),
  ]);
  if (newest?.title === GUARANTEE_TITLE) return null;
  return (
    <section role="status" aria-labelledby="guarantee-banner-h" className="flex animate-rise flex-col gap-2 rounded-2xl border border-green/20 bg-white/70 px-4 py-3.5 text-[14px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-2.5">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
        <p className="min-w-0 break-words">
          <span id="guarantee-banner-h" className="font-medium text-head">{t("campaignPage.banner.title")}</span>{" "}
          {campaign.endsAt ? t("campaignPage.banner.until", { date: t.date(campaign.endsAt, "dayMonth") }) : t("campaignPage.banner.continues")}
        </p>
      </div>
      <Link href="/app/campaign" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded text-[13.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        {t("campaignPage.banner.link")} <ArrowRight className="size-3.5" aria-hidden />
      </Link>
    </section>
  );
}
