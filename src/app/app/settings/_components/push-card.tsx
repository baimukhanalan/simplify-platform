import { BellRing } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { listDevices, pushPrefOn, vapidConfig } from "@/lib/notify/webpush";
import { Card, Chip } from "@/components/ui";
import { PushCardClient } from "@/components/pwa/push-card-client";

// Web Push (PWA) notifications card in Settings → «Уведомления».
export async function PushCard() {
  const userId = await currentUserId();
  if (!userId) return null;
  const cfg = vapidConfig();
  if (!cfg) {
    // Keys not set yet: an honest «скоро», no controls that would fail.
    return (
      <Card className="flex flex-col gap-3">
        <BellRing className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
        <div className="flex min-h-[22px] flex-wrap items-center justify-between gap-2">
          <h3 className="h-serif text-[19px]">Push-уведомления</h3>
          <Chip>скоро</Chip>
        </div>
        <p className="text-[13.5px] text-ink-3">Уведомления прямо на телефон или компьютер — без Telegram и магазина приложений. Включить их можно будет здесь.</p>
      </Card>
    );
  }
  const [devices, prefOn] = await Promise.all([listDevices(userId), pushPrefOn(userId)]);
  return <PushCardClient publicKey={cfg.publicKey} initialDevices={devices} prefOn={prefOn} />;
}
