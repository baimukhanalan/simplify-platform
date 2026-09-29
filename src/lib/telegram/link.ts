import "server-only";
// Chat ↔ user linking. Invariant: one user ↔ one chat. A chat moves to another user only through that user's valid
// one-time code; the move unlinks the previous owner (see converge).
import { db, j, s } from "../db";
import { linkCodeExpiry, linkCodeValid, newLinkCode } from "./config";

export type LinkOutcome =
  | { kind: "linked"; userId: string; name: string }
  | { kind: "already"; userId: string }
  | { kind: "expired" }
  | { kind: "invalid" };

/** Issue a fresh one-time code for the user (replaces any earlier code). */
export async function issueLinkCode(userId: string, now = Date.now()) {
  const code = newLinkCode(now);
  await db.user.update({ where: { id: userId }, data: { telegramLinkCode: code } });
  return { code, expiresAt: linkCodeExpiry(code)! };
}

export async function clearLinkCode(userId: string) {
  await db.user.updateMany({ where: { id: userId, telegramLinkCode: { not: null } }, data: { telegramLinkCode: null } });
}

/**
 * Link `chatId` to the owner of `code`. Consumes the code. Idempotent: replaying the same /start after it succeeded
 * answers «already» instead of failing. A chat linked to someone else moves to the code's owner.
 *
 * No interactive transaction (SQLite in dev serializes them badly under load): the code is claimed by one conditional
 * UPDATE, then `converge` resolves any concurrent claim of the same chat.
 */
export async function linkChatByCode(code: string, chatId: string, now = Date.now()): Promise<LinkOutcome> {
  if (linkCodeExpiry(code) == null) return { kind: "invalid" };
  const owner = await db.user.findFirst({ where: { telegramLinkCode: code }, select: { id: true, name: true } });
  const already = async (): Promise<LinkOutcome> => {
    // Replayed update (Telegram retry) or a double tap: the code is gone but this chat is already linked.
    const cur = await db.user.findFirst({ where: { telegramChatId: chatId }, select: { id: true } });
    return cur ? { kind: "already", userId: cur.id } : { kind: "invalid" };
  };
  if (!owner) return already();
  if (!linkCodeValid(code, now)) {
    await db.user.updateMany({ where: { id: owner.id, telegramLinkCode: code }, data: { telegramLinkCode: null } });
    return { kind: "expired" };
  }
  const r = await db.user.updateMany({ where: { id: owner.id, telegramLinkCode: code }, data: { telegramChatId: chatId, telegramLinkedAt: new Date(now), telegramLinkCode: null } });
  if (!r.count) return already();
  await converge(chatId);
  return { kind: "linked", userId: owner.id, name: owner.name };
}

/**
 * One chat ↔ one user: when a chat is on several users, the most recent link wins (ties → the greater id) and the
 * others are unlinked. A caller only unlinks rows it saw that lose to a row it saw, so the newest link is never unlinked;
 * the newest link's own converge runs after it is written and sees every earlier one, so concurrent links of one chat
 * always end with exactly one owner.
 */
export async function converge(chatId: string) {
  const users = await db.user.findMany({ where: { telegramChatId: chatId }, select: { id: true, telegramLinkedAt: true } });
  if (users.length <= 1) return;
  const t = (u: (typeof users)[number]) => u.telegramLinkedAt?.getTime() ?? 0;
  const winner = users.reduce((a, b) => (t(b) > t(a) || (t(b) === t(a) && b.id > a.id) ? b : a));
  // Only the rows seen here, exactly as seen: a link written after the read (possibly the newest) is never touched.
  const losers = users.filter((u) => u.id !== winner.id).map((u) => ({ id: u.id, telegramLinkedAt: u.telegramLinkedAt }));
  await db.user.updateMany({ where: { telegramChatId: chatId, OR: losers }, data: { telegramChatId: null, telegramLinkedAt: null } });
}

/** Link the user to a chat directly (simulated channel). */
export async function linkChatDirect(userId: string, chatId: string, now = new Date()) {
  await db.user.update({ where: { id: userId }, data: { telegramChatId: chatId, telegramLinkedAt: now, telegramLinkCode: null } });
  await converge(chatId);
}

/** Unlink by chat (/stop). Returns the user that was linked, if any. */
export async function unlinkChat(chatId: string) {
  const u = await db.user.findFirst({ where: { telegramChatId: chatId }, select: { id: true } });
  await db.user.updateMany({ where: { telegramChatId: chatId }, data: { telegramChatId: null, telegramLinkedAt: null } });
  return u?.id ?? null;
}

/** Unlink by user (Settings → «Отключить»). Returns the chat that was linked, if any. */
export async function unlinkUser(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
  if (!u?.telegramChatId) return null;
  const r = await db.user.updateMany({ where: { id: userId, telegramChatId: u.telegramChatId }, data: { telegramChatId: null, telegramLinkedAt: null, telegramLinkCode: null } });
  return r.count ? u.telegramChatId : null;
}

// ——— notifyPrefs: only the `telegram` key is ours; other keys belong to other channels ———

export type NotifyPrefs = { telegram?: boolean; [k: string]: unknown };

export const telegramEnabled = (prefs: string | null | undefined) => j<NotifyPrefs>(prefs, {}).telegram !== false;

/** Set notifyPrefs.telegram with compare-and-swap on the whole JSON, so a concurrent write to another key is never lost. */
export async function setTelegramPref(userId: string, enabled: boolean) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true } });
    if (!u) return false;
    const cur = j<NotifyPrefs>(u.notifyPrefs, {});
    const prefs = cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {};
    const next = s({ ...prefs, telegram: enabled });
    const r = await db.user.updateMany({ where: { id: userId, notifyPrefs: u.notifyPrefs }, data: { notifyPrefs: next } });
    if (r.count) return true;
  }
  return false;
}
