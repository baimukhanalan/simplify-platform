// Telegram bot configuration and link codes (pure — no DB).
//
// Env: TELEGRAM_BOT_TOKEN (Bot API token from @BotFather), TELEGRAM_BOT_USERNAME (without «@», for t.me deep links),
// TELEGRAM_WEBHOOK_SECRET (the secret_token given to setWebhook; Telegram echoes it in X-Telegram-Bot-Api-Secret-Token).
//
// Channel mode:
//   "live" — token + username set: real bot, real deep link, real messages.
//   "sim"  — no token, simulation mode: the card links instantly to a local chat id "sim:<userId>"; deliveries are
//            marked sent without calling the API. Nothing in the UI names this.
//   "off"  — no token, live mode: the card shows «Скоро»; nothing is sent, nothing errors.
import { randomBytes } from "node:crypto";
import { isSimulation } from "../mode";

export type TelegramMode = "live" | "sim" | "off";

export const botToken = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
export const botUsername = () => (process.env.TELEGRAM_BOT_USERNAME?.trim() || "").replace(/^@/, "");
export const webhookSecret = () => process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || "";

export const telegramConfigured = () => Boolean(botToken() && botUsername());

export function telegramMode(): TelegramMode {
  if (telegramConfigured()) return "live";
  return isSimulation() ? "sim" : "off";
}

/** Chat ids of the simulated channel. Never sent to the Bot API. */
export const SIM_PREFIX = "sim:";
export const isSimChat = (chatId: string | null | undefined) => Boolean(chatId?.startsWith(SIM_PREFIX));
export const simChatId = (userId: string) => `${SIM_PREFIX}${userId}`;

/**
 * Whether a stored chat counts as connected right now. A simulated chat only means something while the channel is
 * simulated; once a real bot is configured the user links a real chat (a "sim:" chat reads as not connected).
 */
export function chatIsLinked(chatId: string | null | undefined, mode: TelegramMode = telegramMode()) {
  if (!chatId) return false;
  if (isSimChat(chatId)) return mode === "sim";
  return mode === "live";
}

// ——— One-time link codes ———
// `<expiry, unix seconds, base36>_<128 random bits, hex>` — fits Telegram's /start payload (A-Z a-z 0-9 _ -, ≤ 64 chars).
// The expiry rides inside the code, so no extra column is needed; the whole code is stored in User.telegramLinkCode and
// looked up by exact match, so the expiry part cannot be forged.

export const LINK_TTL_MS = 15 * 60 * 1000;
const CODE_RE = /^([0-9a-z]{5,9})_([0-9a-f]{32})$/;

export function newLinkCode(now = Date.now()) {
  const exp = Math.floor((now + LINK_TTL_MS) / 1000);
  return `${exp.toString(36)}_${randomBytes(16).toString("hex")}`;
}

/** Expiry of a well-formed code (ms), or null for anything else. */
export function linkCodeExpiry(code: string | null | undefined): number | null {
  const m = CODE_RE.exec(code ?? "");
  if (!m) return null;
  const sec = Number.parseInt(m[1], 36);
  return Number.isFinite(sec) ? sec * 1000 : null;
}

export const linkCodeValid = (code: string | null | undefined, now = Date.now()) => {
  const exp = linkCodeExpiry(code);
  return exp != null && exp > now;
};

/** When the code was issued (ms). */
export const linkCodeIssuedAt = (code: string) => (linkCodeExpiry(code) ?? 0) - LINK_TTL_MS;

export const deepLink = (code: string) => (botUsername() ? `https://t.me/${botUsername()}?start=${code}` : null);

// ——— Absolute app URLs (message buttons) ———

/** Public base URL: APP_URL → NEXT_PUBLIC_SITE_URL → VERCEL_PROJECT_PRODUCTION_URL. Never derived from a request. */
export function appBaseUrl(): string | null {
  const raw = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL.trim().replace(/^https?:\/\//, "")}` : "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Absolute https URL of an in-app path for a Telegram button, or null. Only same-app relative paths ("/app/…") are
 * accepted; Telegram rejects non-https / localhost button URLs, so those get no button instead of a failed send.
 */
export function absoluteAppUrl(href: string | null | undefined, base = appBaseUrl()): string | null {
  if (!base) return null;
  const path = (href ?? "").trim() || "/app";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return null;
  try {
    const u = new URL(path, base);
    if (u.origin !== new URL(base).origin || u.protocol !== "https:" || /^(localhost|127\.|\[::1\])/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
