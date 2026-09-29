import { ShieldCheck } from "lucide-react";
import { Card, Chip, Label } from "@/components/ui";
import type { GuaranteeView } from "@/lib/engine/guarantee";
import { getT } from "@/lib/i18n/server";

/** «Гарантия интервью» on the running campaign: the promise (campaignPage.guarantee.promise) and where this campaign stands with it. */
export async function GuaranteeCard({ view, style }: { view: GuaranteeView; style?: React.CSSProperties }) {
  const t = await getT();
  const promise = t("campaignPage.guarantee.promise");
  return (
    <Card className="animate-rise" style={style}>
      <section aria-labelledby="guarantee-h" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
          <Label><span id="guarantee-h">{t("campaignPage.guarantee.title")}</span></Label>
        </div>
        {view.state === "extended" ? (
          <>
            <Chip tone="green" dot wrap className="self-start">
              {view.until ? t("campaignPage.guarantee.extendedUntil", { date: t.date(view.until, "dayMonth") }) : t("campaignPage.guarantee.extendedOpen")}
            </Chip>
            <p className="text-[13.5px] text-ink-2">{t("campaignPage.guarantee.extendedText")}</p>
          </>
        ) : view.state === "not-needed" ? (
          <>
            <Chip tone="teal" dot wrap className="self-start">{t("campaignPage.guarantee.notNeeded")}</Chip>
            <p className="text-[13.5px] text-ink-3">{promise}</p>
          </>
        ) : (
          <>
            <p className="text-[13.5px] text-ink-2">{promise}</p>
            <p className="text-[13.5px] text-head">
              {view.until ? t("campaignPage.guarantee.ifNoneUntil", { date: t.date(view.until, "dayMonth") }) : t("campaignPage.guarantee.ifNoneOpen")}
            </p>
          </>
        )}
      </section>
    </Card>
  );
}
