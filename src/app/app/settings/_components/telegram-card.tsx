import { Send } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { Card } from "@/components/ui";
import { readTelegramState } from "@/lib/telegram/state";
import { TelegramPanel } from "./telegram-panel";

/** Settings → Уведомления → Telegram: connect the bot, pause it, check the link, disconnect. */
export async function TelegramCard() {
  const userId = await currentUserId();
  if (!userId) return null;
  const state = await readTelegramState(userId);
  return (
    <Card className="flex flex-col gap-3">
      <Send className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
      <TelegramPanel initial={state} />
    </Card>
  );
}
