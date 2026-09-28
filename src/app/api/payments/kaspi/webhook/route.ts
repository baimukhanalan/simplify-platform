import { handleWebhook, verify, type WebhookEvent } from "@/lib/payments/kaspi";

export const maxDuration = 60;

/** Kaspi Pay (mock) → merchant webhook. Body is HMAC-SHA256 signed: header `X-Kaspi-Signature: sha256=<hex>`. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-kaspi-signature"))) return Response.json({ error: "invalid signature" }, { status: 401 });
  let evt: WebhookEvent;
  try {
    evt = JSON.parse(raw) as WebhookEvent;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!evt.invoiceId || !["payment.succeeded", "payment.failed"].includes(evt.event)) return Response.json({ error: "invalid event" }, { status: 400 });
  const r = await handleWebhook(evt);
  return Response.json(r, { status: r.status });
}
