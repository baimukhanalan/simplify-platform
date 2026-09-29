"use server";
// Settings → Уведомления → Telegram. Every action is scoped to the signed-in user.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth";
import { db } from "../db";
import { rateLimitUser, retryText } from "../rate-limit";
import { logEvent } from "../engine/agent";
import { chatIsLinked, isSimChat, linkCodeIssuedAt, linkCodeValid, simChatId, telegramMode } from "../telegram/config";
import { chatGone, sendMessage } from "../telegram/client";
import { TEXT } from "../telegram/format";
import { clearLinkCode, issueLinkCode, linkChatDirect, setTelegramPref, unlinkUser } from "../telegram/link";
import { readTelegramState, SIM_CONNECT_MS, type TelegramState } from "../telegram/state";

export type { TelegramState };

export type ActionResult = { state?: TelegramState; error?: string; ok?: boolean };

/** «Подключить Telegram»: a fresh one-time code (15 min) and the t.me deep link that carries it. */
export async function startTelegramLink(): Promise<ActionResult> {
  const user = await requireUser();
  const mode = telegramMode();
  if (mode === "off") return { error: "Подключение Telegram скоро появится." };
  const rl = await rateLimitUser("tg-link", user.id, 12, 60 * 60 * 1000);
  if (!rl.ok) return { error: retryText(rl.retryAfter) };
  await issueLinkCode(user.id);
  return { state: await readTelegramState(user.id) };
}

/**
 * Polled by the card while it waits for the bot. Read-only in live mode (the webhook links the chat). With the simulated
 * channel, a pending code connects on its own after a short wait, exactly as if the bot had answered.
 */
export async function pollTelegramLink(): Promise<ActionResult> {
  const user = await requireUser();
  const now = Date.now();
  if (telegramMode() === "sim" && !chatIsLinked(user.telegramChatId, "sim")) {
    const code = user.telegramLinkCode;
    if (code && linkCodeValid(code, now) && now - linkCodeIssuedAt(code) >= SIM_CONNECT_MS) {
      // Only the request that still sees this exact code links (a second tab polling at the same moment is a no-op).
      const r = await db.user.updateMany({ where: { id: user.id, telegramLinkCode: code }, data: { telegramLinkCode: null } });
      if (r.count) {
        await linkChatDirect(user.id, simChatId(user.id));
        await logEvent(user.id, "telegram", "Telegram подключён для уведомлений");
      }
    }
  }
  const state = await readTelegramState(user.id, now);
  if (state.linked) revalidatePath("/app/settings");
  return { state };
}

/** «Отмена» while waiting: the code stops working at once. */
export async function cancelTelegramLink(): Promise<ActionResult> {
  const user = await requireUser();
  await clearLinkCode(user.id);
  return { state: await readTelegramState(user.id) };
}

const Enabled = z.boolean();

/** «Присылать уведомления» — notifyPrefs.telegram (other channels' keys are left untouched). */
export async function setTelegramEnabled(enabled: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const p = Enabled.safeParse(enabled);
  if (!p.success) return { error: "Некорректное значение." };
  const rl = await rateLimitUser("tg-pref", user.id, 60, 10 * 60 * 1000);
  if (!rl.ok) return { error: retryText(rl.retryAfter) };
  if (!(await setTelegramPref(user.id, p.data))) return { error: "Не удалось сохранить. Попробуй ещё раз." };
  await logEvent(user.id, "telegram", p.data ? "Уведомления в Telegram включены" : "Уведомления в Telegram выключены");
  return { state: await readTelegramState(user.id) };
}

/** «Проверить связь»: one message to the linked chat. */
export async function pingTelegram(): Promise<ActionResult> {
  const user = await requireUser();
  const mode = telegramMode();
  const chatId = user.telegramChatId;
  if (!chatId || !chatIsLinked(chatId, mode)) return { error: "Telegram не подключён.", state: await readTelegramState(user.id) };
  const rl = await rateLimitUser("tg-ping", user.id, 5, 10 * 60 * 1000);
  if (!rl.ok) return { error: retryText(rl.retryAfter) };
  if (isSimChat(chatId)) {
    await new Promise((r) => setTimeout(r, 700));
    return { ok: true };
  }
  const r = await sendMessage(chatId, TEXT.ping);
  if (r.ok) return { ok: true };
  if (chatGone(r)) {
    await unlinkUser(user.id);
    return { error: "Бот не может написать в этот чат — похоже, он заблокирован. Подключи Telegram заново.", state: await readTelegramState(user.id) };
  }
  return { error: "Telegram не ответил. Попробуй через минуту." };
}

/** «Отключить»: unlink the chat and say goodbye there (best effort). */
export async function unlinkTelegram(): Promise<ActionResult> {
  const user = await requireUser();
  const chatId = await unlinkUser(user.id);
  if (chatId) {
    await logEvent(user.id, "telegram", "Telegram отключён");
    if (!isSimChat(chatId) && telegramMode() === "live") await sendMessage(chatId, TEXT.unlinkedFromApp, {}, { maxRetries: 0, timeoutMs: 4000 });
  }
  revalidatePath("/app/settings");
  return { state: await readTelegramState(user.id) };
}
