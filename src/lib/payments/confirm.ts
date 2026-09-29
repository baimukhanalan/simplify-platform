import "server-only";
import { randomBytes } from "node:crypto";
import { currentUserId } from "../auth";
import { db, j, s } from "../db";
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
  const p0 = await db.payment.findFirst({ where: { externalId: id, userId, provider: MOCK_PROVIDER } });
  if (!p0) return err("not found", 404);
  // Idempotent: confirming an invoice that is already paid answers with the same result (no rate limit, no new charge).
  if (p0.status === "paid") return Response.json(view(p0));
  // One confirm per invoice at a time — across tabs, double clicks and instances. The others wait for it and answer
  // with its result instead of charging again or piling up competing transactions.
  const lease = await acquireConfirmLease(p0.id);
  if (lease.kind === "settled") return Response.json(view(lease.payment));
  if (lease.kind === "busy") return err("payment in progress", 409, { retry: true });
  try {
    return await confirmClaimed(req, id, userId, lease.payment, opts);
  } finally {
    await releaseConfirmLease(p0.id, lease.token).catch(() => {});
  }
}

const LEASE_TTL_MS = 45_000;
const LEASE_WAIT_MS = 40_000;
type Lease = { token: string; at: number };
type Payment = Awaited<ReturnType<typeof db.payment.findUniqueOrThrow>>;
const leaseOf = (meta: string): Lease | null => {
  const l = j<{ confirmLease?: Lease }>(meta, {}).confirmLease;
  return l && typeof l.token === "string" && typeof l.at === "number" && Date.now() - l.at < LEASE_TTL_MS ? l : null;
};

/**
 * Claims the invoice for one confirm: an optimistic write of a lease into Payment.meta (compare-and-set on the meta
 * string, so exactly one concurrent caller wins, on SQLite and Postgres alike). Losers poll until the winner is done:
 * a paid invoice → "settled" (they return the same view); a released lease on a still-open invoice → they may claim it.
 */
async function acquireConfirmLease(paymentId: string): Promise<{ kind: "claimed"; token: string; payment: Payment } | { kind: "settled"; payment: Payment } | { kind: "busy" }> {
  const token = randomBytes(9).toString("hex");
  const deadline = Date.now() + LEASE_WAIT_MS;
  for (let wait = 60; ; wait = Math.min(wait * 1.5, 500)) {
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === "paid") return { kind: "settled", payment: p };
    if (!leaseOf(p.meta)) {
      const meta = s({ ...j<Record<string, unknown>>(p.meta, {}), confirmLease: { token, at: Date.now() } });
      const won = await db.payment.updateMany({ where: { id: p.id, meta: p.meta }, data: { meta } });
      if (won.count === 1) return { kind: "claimed", token, payment: { ...p, meta } };
    }
    if (Date.now() > deadline) return { kind: "busy" };
    await new Promise((r) => setTimeout(r, wait + Math.random() * 40));
  }
}

async function releaseConfirmLease(paymentId: string, token: string) {
  for (let i = 0; i < 5; i++) {
    const p = await db.payment.findUnique({ where: { id: paymentId } });
    const meta = j<Record<string, unknown> & { confirmLease?: Lease }>(p?.meta, {});
    if (!p || meta.confirmLease?.token !== token) return;
    delete meta.confirmLease;
    if ((await db.payment.updateMany({ where: { id: p.id, meta: p.meta }, data: { meta: s(meta) } })).count === 1) return;
  }
}

/** The confirm itself, run by the lease holder only. */
async function confirmClaimed(req: Request, id: string, userId: string, p: Payment, opts: { legacyErrors?: boolean }) {
  if (!(await rateLimitUser("kaspi-mock-pay", userId, 20, 60 * 60 * 1000)).ok) return err("too many attempts", 429);
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
