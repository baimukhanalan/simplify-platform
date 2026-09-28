import { randomBytes } from "node:crypto";
import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { MOCK_PAID_CAP_24H, MOCK_PROVIDER, appBaseUrl, isExpired, mockEnabled, mockPaidLast24h, runningCampaign, signMock, view, type WebhookEvent } from "@/lib/payments/kaspi";
import { rateLimitUser } from "@/lib/rate-limit";

export const maxDuration = 60;

const err = (error: string, status: number, extra: object = {}) => Response.json({ error, ...extra }, { status });

/**
 * MOCK gateway (KASPI_MODE=mock only): simulates the customer paying (or declining) in Kaspi, then delivers a
 * webhook signed with the mock key to our own endpoint over HTTP — the same path a real provider event takes.
 * Body: { outcome?: "success" | "fail" }. Owner-only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!mockEnabled()) return err("not found", 404);
  const userId = await currentUserId();
  if (!userId) return err("unauthorized", 401);
  if (!(await rateLimitUser("kaspi-mock-pay", userId, 20, 60 * 60 * 1000)).ok) return err("too many attempts", 429);
  const { id } = await params;
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
  if (success && (await mockPaidLast24h(userId)) >= MOCK_PAID_CAP_24H) return err("demo payment limit reached", 429, { limit: MOCK_PAID_CAP_24H });

  const base = appBaseUrl(req);
  if (!base) return err("APP_URL is not configured", 500);
  const evt: WebhookEvent = {
    event: success ? "payment.succeeded" : "payment.failed",
    invoiceId: id, amount: p.amount, currency: p.currency,
    transactionId: `TX-MOCK-${randomBytes(12).toString("hex").toUpperCase()}`, occurredAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(evt);
  let res: Response;
  try {
    res = await fetch(`${base}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", ...signMock(raw) }, body: raw, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    console.error("[kaspi-mock] webhook delivery failed", e);
    return err("webhook delivery failed", 502);
  }
  if (!res.ok) return err("webhook delivery failed", 502, { webhookStatus: res.status });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  return Response.json(view(fresh));
}
