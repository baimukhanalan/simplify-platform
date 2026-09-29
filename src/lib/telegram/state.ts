import "server-only";
import { db } from "../db";
import { chatIsLinked, deepLink, linkCodeExpiry, linkCodeValid, telegramMode } from "./config";
import { telegramEnabled } from "./link";

/** The card's view of the channel. Dates are ISO strings (serializable to the client). */
export type TelegramState = {
  mode: "live" | "sim" | "off";
  linked: boolean;
  linkedAt: string | null;
  enabled: boolean;
  /** A link code waiting for the bot: its deep link and expiry. */
  pending: { url: string | null; expiresAt: string } | null;
};

/** Simulated channel: how long «ждём бота» lasts before the chat connects. */
export const SIM_CONNECT_MS = 2200;

export async function readTelegramState(userId: string, now = Date.now()): Promise<TelegramState> {
  const mode = telegramMode();
  const u = await db.user.findUnique({ where: { id: userId }, select: { telegramChatId: true, telegramLinkedAt: true, telegramLinkCode: true, notifyPrefs: true } });
  const linked = Boolean(u && chatIsLinked(u.telegramChatId, mode));
  const code = u?.telegramLinkCode;
  const pending = !linked && mode !== "off" && code && linkCodeValid(code, now) ? { url: mode === "live" ? deepLink(code) : null, expiresAt: new Date(linkCodeExpiry(code)!).toISOString() } : null;
  return { mode, linked, linkedAt: linked && u?.telegramLinkedAt ? u.telegramLinkedAt.toISOString() : null, enabled: telegramEnabled(u?.notifyPrefs), pending };
}

