import "server-only";
import { db } from "@/lib/db";
import { chatIsLinked, isSimChat, telegramMode } from "@/lib/telegram/config";
import { chatGone, sendMessage } from "@/lib/telegram/client";
import { formatNotification } from "@/lib/telegram/format";
import { telegramEnabled } from "@/lib/telegram/link";
import type { OutgoingNotification } from "./index";

/**
 * Telegram channel. Never throws. Sends only to a linked chat with notifyPrefs.telegram !== false; each notification is
 * sent at most once (telegramSentAt is claimed atomically before the send and released if the send fails).
 * Simulated chats ("sim:<userId>") are marked sent without calling the Bot API. Low-importance types arrive silently.
 */
export async function deliverTelegram(n: OutgoingNotification): Promise<void> {
  try {
    const mode = telegramMode();
    if (mode === "off") return;
    const user = await db.user.findUnique({ where: { id: n.userId }, select: { telegramChatId: true, notifyPrefs: true } });
    const chatId = user?.telegramChatId;
    if (!chatId || !chatIsLinked(chatId, mode) || !telegramEnabled(user.notifyPrefs)) return;

    const claimedAt = new Date();
    const claim = await db.notification.updateMany({ where: { id: n.id, userId: n.userId, telegramSentAt: null }, data: { telegramSentAt: claimedAt } });
    if (!claim.count) return; // already sent (or being sent) by another dispatch
    if (isSimChat(chatId)) return;

    const msg = formatNotification(n);
    const r = await sendMessage(chatId, msg.html, { buttons: msg.buttons, silent: msg.silent });
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
