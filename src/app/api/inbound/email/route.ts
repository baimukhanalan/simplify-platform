import { handleInbound } from "@/lib/inbound/webhook";
import { rateLimit } from "@/lib/rate-limit";

export const maxDuration = 60;

/**
 * Inbound employer mail for personal forwarding addresses (<alias>@INBOUND_EMAIL_DOMAIN).
 * Accepts Postmark Inbound JSON and the generic JSON posted by scripts/inbound-email-worker.js.
 * Auth: INBOUND_EMAIL_SECRET via `X-Inbound-Secret` or as the basic-auth password (https://inbound:<secret>@host/…).
 * No secret configured → 503.
 */
export async function POST(req: Request) {
  // Per source IP: generous for a provider's delivery burst, a wall for secret guessing.
  const limited = await rateLimit("inbound-email", 600, 60_000);
  if (!limited.ok) return Response.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    return await handleInbound(req);
  } catch (e) {
    console.error("[inbound] delivery failed", e);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
