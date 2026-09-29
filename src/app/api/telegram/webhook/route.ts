import { telegramConfigured } from "@/lib/telegram/config";
import { handleUpdate, secretOk } from "@/lib/telegram/webhook";

const MAX_BODY = 64 * 1024;

/**
 * Telegram Bot API → webhook (registered by scripts/telegram-set-webhook.mjs with secret_token + allowed_updates).
 * Auth: X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_WEBHOOK_SECRET (timing-safe). Without a configured bot the
 * endpoint does not exist (404). The reply to a command is returned in the response body as a Bot API method call.
 */
export async function POST(req: Request) {
  if (!telegramConfigured()) return new Response(null, { status: 404 });
  if (!secretOk(req.headers.get("x-telegram-bot-api-secret-token"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "payload too large" }, { status: 413 });
  let update: unknown;
  try {
    update = JSON.parse(raw);
  } catch {
    // Malformed JSON will never become valid on retry: acknowledge so Telegram drops it.
    return Response.json({ ok: true });
  }
  try {
    const r = await handleUpdate(update);
    return Response.json(r ?? { ok: true });
  } catch (e) {
    console.error("[telegram] update failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "temporary failure" }, { status: 500 });
  }
}
