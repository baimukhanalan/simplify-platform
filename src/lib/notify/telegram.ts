import "server-only";
import { db } from "@/lib/db";
import { chatIsLinked, isSimChat, telegramMode } from "@/lib/telegram/config";
import { chatGone, sendMessage } from "@/lib/telegram/client";
import { botLocale, formatNotification } from "@/lib/telegram/format";
import { telegramEnabled } from "@/lib/telegram/link";
import type { OutgoingNotification } from "./index";

/**
 * How long a delivery may take. "request": one attempt, 3 s — it runs after a response (after()) or detached, and a
 * hung Bot API must not hold a serverless function. "cron": the catch-up sender, a short retry allowed.
 */
export type DeliveryBudget = "request" | "cron";
export const TELEGRAM_BUDGET = {
  request: { timeoutMs: 3000, maxRetries: 0, maxWaitMs: 0 },
  cron: { timeoutMs: 5000, maxRetries: 1, maxWaitMs: 5000 },
} as const satisfies Record<DeliveryBudget, { timeoutMs: number; maxRetries: number; maxWaitMs: number }>;

/**
 * Telegram channel. Never throws. Sends only to a linked chat with notifyPrefs.telegram !== false; each notification is
 * sent at most once (telegramSentAt is claimed atomically before the send and released if the send fails).
 * Simulated chats ("sim:<userId>") are marked sent without calling the Bot API. Low-importance types arrive silently.
 */
export async function deliverTelegram(n: OutgoingNotification, budget: DeliveryBudget = "request"): Promise<void> {
  try {
    const mode = telegramMode();
    if (mode === "off") return;
    const user = await db.user.findUnique({ where: { id: n.userId }, select: { telegramChatId: true, notifyPrefs: true, locale: true } });
    const chatId = user?.telegramChatId;
    if (!chatId || !chatIsLinked(chatId, mode) || !telegramEnabled(user.notifyPrefs)) return;

    const claimedAt = new Date();
    const claim = await db.notification.updateMany({ where: { id: n.id, userId: n.userId, telegramSentAt: null }, data: { telegramSentAt: claimedAt } });
    if (!claim.count) return; // already sent (or being sent) by another dispatch
    if (isSimChat(chatId)) return;

    // In the user's interface language (ru when unset).
    const msg = formatNotification(n, undefined, botLocale(user.locale));
    const r = await sendMessage(chatId, msg.html, { buttons: msg.buttons, silent: msg.silent }, TELEGRAM_BUDGET[budget]);
    if (r.ok) return;
    // Not delivered: release the claim so a later retry may send it.
    await db.notification.updateMany({ where: { id: n.id, telegramSentAt: claimedAt }, data: { telegramSentAt: null } });
    if (chatGone(r)) {
      // The user blocked the bot or the chat is gone: unlink, so the card shows «не подключён» instead of silently failing.
      await db.user.updateMany({ where: { id: n.userId, telegramChatId: chatId }, data: { telegramChatId: null, telegramLinkedAt: null } });
    } else {
      console.warn(`[telegram] delivery failed (${r.status}): ${r.description}`);
    }
  } catch (e) {
    console.warn("[telegram] delivery error", e instanceof Error ? e.message : e);
  }
}
