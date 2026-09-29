import { BellRing } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { listDevices, pushPrefOn, vapidConfig } from "@/lib/notify/webpush";
import { Card, Chip } from "@/components/ui";
import { PushCardClient } from "@/components/pwa/push-card-client";
import { getT } from "@/lib/i18n/server";

// Web Push (PWA) notifications card in Settings → «Уведомления».
export async function PushCard() {
  const userId = await currentUserId();
  if (!userId) return null;
  const cfg = vapidConfig();
  if (!cfg) {
    const t = await getT();
    // Keys not set yet: an honest «скоро», no controls that would fail.
    return (
      <Card className="flex flex-col gap-3">
        <BellRing className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
        <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
          <h3 className="h-serif text-[19px]">{t("pushCard.title")}</h3>
          <Chip>{t("pushCard.soon")}</Chip>
        </div>
        <p className="text-[13.5px] text-ink-3">{t("pushCard.soonText")}</p>
      </Card>
    );
  }
  const [devices, prefOn] = await Promise.all([listDevices(userId), pushPrefOn(userId)]);
  return <PushCardClient publicKey={cfg.publicKey} initialDevices={devices} prefOn={prefOn} />;
}
