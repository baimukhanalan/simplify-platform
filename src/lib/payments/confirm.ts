import "server-only";
import { randomBytes } from "node:crypto";
import { currentUserId } from "../auth";
import { db } from "../db";
import { captureError } from "../monitoring";
import { rateLimitUser } from "../rate-limit";
import { MOCK_PAID_CAP_24H, MOCK_PROVIDER, appBaseUrl, isExpired, mockEnabled, mockPaidLast24h, runningCampaign, signMock, view, type WebhookEvent } from "./kaspi";

const err = (error: string, status: number, extra: object = {}) => Response.json({ error, ...extra }, { status });

/**
 * Built-in gateway (KASPI_MODE=mock only): the customer pays (or declines) the invoice, then a webhook signed with the
 * gateway key is delivered to our own endpoint over HTTP — the same path a real provider event takes, so the payment is
 * booked exactly like any other paid Kaspi invoice. Owner-only. Served by POST /api/payments/kaspi/confirm/[id] and by the
 * older alias /api/payments/kaspi/mock/[id]/pay (kept working; `legacyErrors` keeps that route's old error strings).
 * Body: { outcome?: "success" | "fail" }.
 */
export async function confirmInvoicePayment(req: Request, id: string, opts: { legacyErrors?: boolean } = {}) {
  if (!mockEnabled()) return err("not found", 404);
  const userId = await currentUserId();
  if (!userId) return err("unauthorized", 401);
  if (!(await rateLimitUser("kaspi-mock-pay", userId, 20, 60 * 60 * 1000)).ok) return err("too many attempts", 429);
  const p = await db.payment.findFirst({ where: { externalId: id, userId, provider: MOCK_PROVIDER } });
  if (!p) return err("not found", 404);
  if (p.status === "paid") return Response.json(view(p));
  if (p.status === "expired" || isExpired(p)) {
    await db.payment.updateMany({ where: { id: p.id, status: { in: ["pending", "failed"] } }, data: { status: "expired" } });
    return err("invoice expired", 410);
  }
  // No double charge: a running campaign means this invoice must not be paid.
  if (await runningCampaign(userId)) return err("campaign already active", 409);
  const { outcome } = (await req.json().catch(() => ({}))) as { outcome?: string };
  const success = outcome !== "fail";
  if (success && (await mockPaidLast24h(userId)) >= MOCK_PAID_CAP_24H) return err(opts.legacyErrors ? "demo payment limit reached" : "payment limit reached", 429, { limit: MOCK_PAID_CAP_24H });

  const base = appBaseUrl(req);
  if (!base) return err("APP_URL is not configured", 500);
  const evt: WebhookEvent = {
    event: success ? "payment.succeeded" : "payment.failed",
    invoiceId: id, amount: p.amount, currency: p.currency,
    // The same shape as a provider transaction id; the invoice's provider (internal) is what tells gateways apart.
    transactionId: `TX-${randomBytes(12).toString("hex").toUpperCase()}`, occurredAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(evt);
  let res: Response;
  try {
    res = await fetch(`${base}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", ...signMock(raw) }, body: raw, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    console.error("[kaspi] webhook delivery failed", e);
    await captureError(e, { userId, meta: { step: "kaspi-webhook-delivery", paymentId: p.id } });
    return err("webhook delivery failed", 502);
  }
  if (!res.ok) return err("webhook delivery failed", 502, { webhookStatus: res.status });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  return Response.json(view(fresh));
}
