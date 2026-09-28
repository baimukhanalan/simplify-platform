import { after } from "next/server";
import { runTick } from "@/lib/engine/agent";
import { handleWebhook, parseEvent, verifyWebhook } from "@/lib/payments/kaspi";

export const maxDuration = 60;

const MAX_BODY = 16 * 1024;

/**
 * Kaspi Pay → merchant webhook.
 * Headers: `X-Kaspi-Timestamp: <unix seconds>` and `X-Kaspi-Signature: sha256=<hex HMAC of "<timestamp>.<raw body>">`.
 * Real events are signed with KASPI_WEBHOOK_SECRET; mock-gateway events (KASPI_MOCK_SECRET) are accepted only when KASPI_MODE=mock.
 * Events older/newer than 5 minutes are rejected; replays are deduplicated on transactionId.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "payload too large" }, { status: 413 });
  const source = verifyWebhook(raw, req.headers.get("x-kaspi-signature"), req.headers.get("x-kaspi-timestamp"));
  if (!source) return Response.json({ error: "invalid signature" }, { status: 401 });
  const evt = parseEvent(raw);
  if (!evt) return Response.json({ error: "invalid event" }, { status: 400 });
  const r = await handleWebhook(evt, source);
  // The first agent cycle can take a while (job discovery, AI) — run it after the provider got its 200.
  const started = r.ok ? r.startedCampaignId : undefined;
  if (started) {
    after(async () => {
      try {
        await runTick(started);
      } catch (e) {
        console.error("[kaspi] first tick failed", e);
      }
    });
  }
  return Response.json(r, { status: r.status });
}
