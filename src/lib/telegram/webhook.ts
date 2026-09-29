import "server-only";
// Telegram webhook: secret check, update parsing, command handling. The route (src/app/api/telegram/webhook) is a thin
// wrapper; replies go back in the webhook response itself (Telegram executes `{ method: "sendMessage", … }`), so a
// handled update costs no extra API call and nothing is sent twice when the response is lost and Telegram retries.
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import { rateLimitUser } from "../rate-limit";
import { logEvent } from "../engine/agent";
import { webhookSecret } from "./config";
import { TEXT } from "./format";
import { linkChatByCode, unlinkChat } from "./link";
import { statusText } from "./status";

/** Timing-safe compare of the X-Telegram-Bot-Api-Secret-Token header (hashed first, so lengths never leak). */
export function secretOk(header: string | null | undefined, expected = webhookSecret()) {
  if (!expected || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const Update = z.object({
  update_id: z.number().int().nonnegative(),
  message: z
    .object({
      chat: z.object({ id: z.number().int(), type: z.string() }),
      from: z.object({ is_bot: z.boolean().optional() }).passthrough().optional(),
      text: z.string().max(4096).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough();

export type Reply = { method: "sendMessage"; chat_id: number; text: string; parse_mode: "HTML"; link_preview_options: { is_disabled: true } };

const reply = (chatId: number, text: string): Reply => ({ method: "sendMessage", chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });

// ——— Replay protection: Telegram retries an update until it gets a 2xx. The effects are idempotent on their own
// (a consumed code answers «already linked», /stop on an unlinked chat is a no-op); this set also keeps a retried
// update from being answered twice by the same instance. ———
const seen = new Set<number>();
const SEEN_MAX = 20_000;

function firstTime(updateId: number) {
  if (seen.has(updateId)) return false;
  if (seen.size >= SEEN_MAX) {
    // Insertion order = arrival order: drop the oldest tenth.
    let n = SEEN_MAX / 10;
    for (const id of seen) {
      seen.delete(id);
      if (--n <= 0) break;
    }
  }
  seen.add(updateId);
  return true;
}

/** For tests. */
export const _resetSeen = () => seen.clear();

/** Parse the /command and its argument: "/start abc", "/start@SimplifyBot abc" → { cmd: "start", arg: "abc" }. */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = /^\/([a-z_]+)(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?/i.exec(text.trim());
  return m ? { cmd: m[1].toLowerCase(), arg: m[2] ?? "" } : null;
}

/** Handle one update. Returns the reply to put in the webhook response, or null. Never throws on user input. */
export async function handleUpdate(raw: unknown): Promise<Reply | null> {
  const p = Update.safeParse(raw);
  if (!p.success) return null;
  const u = p.data;
  if (!firstTime(u.update_id)) return null;
  try {
    return await handleMessage(u.message);
  } catch (e) {
    // Let Telegram retry a failed update (the route answers 500): forget that we saw it.
    seen.delete(u.update_id);
    throw e;
  }
}

async function handleMessage(msg: z.infer<typeof Update>["message"]): Promise<Reply | null> {
  if (!msg || msg.from?.is_bot) return null;
  const chatId = msg.chat.id;
  const chat = String(chatId);
  // Notifications are personal: only a private chat with the bot can be linked.
  if (msg.chat.type !== "private") {
    const c = parseCommand(msg.text ?? "");
    return c?.cmd === "start" ? reply(chatId, TEXT.groupOnly) : null;
  }
  // Per-chat flood guard: a chat hammering the bot gets silence, not an answer per message.
  const rl = await rateLimitUser("tg-chat", chat, 30, 60_000);
  if (!rl.ok) return null;

  const c = parseCommand(msg.text ?? "");
  switch (c?.cmd) {
    case "start": {
      if (!c.arg) {
        const linked = await db.user.findFirst({ where: { telegramChatId: chat }, select: { id: true } });
        return reply(chatId, linked ? TEXT.alreadyLinked : TEXT.startNoCode);
      }
      const out = await linkChatByCode(c.arg, chat);
      if (out.kind === "linked") {
        await logEvent(out.userId, "telegram", "Telegram подключён для уведомлений").catch(() => {});
        return reply(chatId, TEXT.linked(out.name.split(/\s+/)[0] ?? ""));
      }
      return reply(chatId, out.kind === "already" ? TEXT.alreadyLinked : out.kind === "expired" ? TEXT.expired : TEXT.invalid);
    }
    case "stop": {
      const userId = await unlinkChat(chat);
      if (userId) await logEvent(userId, "telegram", "Telegram отключён командой /stop").catch(() => {});
      return reply(chatId, userId ? TEXT.stopped : TEXT.notLinked);
    }
    case "status": {
      const user = await db.user.findFirst({ where: { telegramChatId: chat }, select: { id: true } });
      return reply(chatId, user ? await statusText(user.id) : TEXT.notLinked);
    }
    default: {
      const user = await db.user.findFirst({ where: { telegramChatId: chat }, select: { id: true } });
      return reply(chatId, user ? TEXT.help : TEXT.notLinked);
    }
  }
}
