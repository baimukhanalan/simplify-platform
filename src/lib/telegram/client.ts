// Minimal Telegram Bot API client. Never throws: every call resolves to { ok, ... }.
// Timeouts per attempt; 429 is retried after `retry_after` (capped, so a serverless request never hangs); network
// errors and 5xx get one short retry. 4xx other than 429 is final (bad chat, bot blocked, malformed message).
import { botToken } from "./config";

export type TgResult<T = unknown> = { ok: true; result: T } | { ok: false; status: number; description: string; retryAfter?: number };

type Opts = { token?: string; timeoutMs?: number; maxRetries?: number; maxWaitMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function callBot<T = unknown>(method: string, payload: Record<string, unknown>, opts: Opts = {}): Promise<TgResult<T>> {
  const token = opts.token ?? botToken();
  if (!token) return { ok: false, status: 0, description: "bot token is not configured" };
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 2;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  let waited = 0;
  let last: TgResult<T> = { ok: false, status: 0, description: "not attempted" };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await doFetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } } | null;
      if (res.ok && data?.ok) return { ok: true, result: data.result as T };
      const status = data?.error_code ?? res.status;
      const retryAfter = data?.parameters?.retry_after;
      last = { ok: false, status, description: String(data?.description ?? res.statusText ?? "error").slice(0, 300), retryAfter };
      if (status === 429) {
        const wait = Math.max(1, retryAfter ?? 1) * 1000;
        if (waited + wait > maxWaitMs) return last;
        waited += wait;
        await sleep(wait);
        continue;
      }
      if (status >= 500) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      return last;
    } catch (e) {
      // Timeout / DNS / connection reset. The token is part of the URL — never log the raw error with the URL.
      last = { ok: false, status: 0, description: e instanceof Error && e.name === "TimeoutError" ? "timeout" : "network error" };
      await sleep(500 * (attempt + 1));
    }
  }
  return last;
}

export type InlineButton = { text: string; url: string };

export type SendOpts = { buttons?: InlineButton[]; silent?: boolean };

export function sendMessagePayload(chatId: string, html: string, o: SendOpts = {}) {
  return {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(o.silent ? { disable_notification: true } : {}),
    ...(o.buttons?.length ? { reply_markup: { inline_keyboard: [o.buttons.map((b) => ({ text: b.text, url: b.url }))] } } : {}),
  };
}

export const sendMessage = (chatId: string, html: string, o: SendOpts = {}, opts: Opts = {}) => callBot("sendMessage", sendMessagePayload(chatId, html, o), opts);

/** The bot can no longer write to this chat (user blocked the bot, deleted the account, chat gone). */
export const chatGone = (r: TgResult) => !r.ok && (r.status === 403 || (r.status === 400 && /chat not found|user is deactivated/i.test(r.description)));
