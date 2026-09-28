import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, j, s } from "../db";
import { PLANS } from "../engine/taxonomy";
import { logEvent, notify } from "../engine/agent";
import { assessReadinessFor } from "./readiness-snapshot";

/**
 * Kaspi Pay. Mirrors a typical merchant flow:
 *   1. merchant creates an invoice            → POST /api/payments/kaspi/invoices
 *   2. customer pays                          → real: Kaspi app · mock: /pay/kaspi/[id] → POST /api/payments/kaspi/mock/[id]/pay
 *   3. gateway calls the merchant webhook     → POST /api/payments/kaspi/webhook  (HMAC-SHA256 over "<timestamp>.<body>")
 *   4. webhook marks the payment paid and activates the Career Campaign (idempotent, one transaction)
 *
 * Modes (KASPI_MODE):
 *   - "mock": the built-in mock gateway is enabled. It signs events with KASPI_MOCK_SECRET — a key that is
 *     never used for real events — and the webhook accepts mock-signed events only in this mode.
 *     Default in development; in production it must be set explicitly.
 *   - anything else ("live"): mock gateway returns 404; only events signed with KASPI_WEBHOOK_SECRET count.
 */

export type KaspiMode = "mock" | "live";
export type EventSource = "live" | "mock";

export function kaspiMode(): KaspiMode {
  const m = process.env.KASPI_MODE?.trim().toLowerCase();
  if (m) return m === "mock" ? "mock" : "live";
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}
export const mockEnabled = () => kaspiMode() === "mock";

/** Invoices created by the mock gateway can only be settled by mock-signed events, real ones only by real events. */
export const MOCK_PROVIDER = "kaspi_mock";
export const LIVE_PROVIDER = "kaspi";
export const KASPI_PROVIDERS = [MOCK_PROVIDER, LIVE_PROVIDER];
/** True for any Kaspi invoice, mock or real — UI that offers "pay" / "open invoice" must treat both alike. */
export const isKaspiProvider = (p: string | null | undefined) => p === MOCK_PROVIDER || p === LIVE_PROVIDER;

const INVOICE_TTL_MS = 30 * 60 * 1000;
const MAX_SKEW_S = 5 * 60;
/** Abuse cap for the public demo: mock-paid (free) campaigns per user per 24h. */
export const MOCK_PAID_CAP_24H = 3;

/** Real provider key. null when not configured → real events are rejected (never falls back to a known value in production). */
function liveSecret(): string | null {
  const v = process.env.KASPI_WEBHOOK_SECRET;
  if (v && v.length >= 32) return v;
  return process.env.NODE_ENV === "production" ? null : "dev-only-kaspi-live-webhook-secret-32bytes!!";
}

/** Mock gateway key — deliberately separate from the real one, so a leaked/abused mock never signs a real event. */
function mockSecret(): string {
  const v = process.env.KASPI_MOCK_SECRET;
  if (v && v === process.env.KASPI_WEBHOOK_SECRET) throw new Error("KASPI_MOCK_SECRET must differ from KASPI_WEBHOOK_SECRET");
  if (v && v.length >= 32) return v;
  // Production without KASPI_MOCK_SECRET: derive a dedicated key from SESSION_SECRET (still server-only, still distinct).
  const session = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production") {
    if (!session || session.length < 32) throw new Error("KASPI_MOCK_SECRET (or SESSION_SECRET) must be set (≥32 chars) to run the Kaspi mock in production");
    return createHmac("sha256", session).update("simplify:kaspi-mock-webhook:v1").digest("hex");
  }
  return "dev-only-kaspi-mock-webhook-secret-32bytes!";
}

const hmac = (key: string, ts: string, raw: string) => `sha256=${createHmac("sha256", key).update(`${ts}.${raw}`).digest("hex")}`;

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Headers the mock gateway attaches to a webhook delivery. */
export function signMock(raw: string, now = Date.now()) {
  const ts = String(Math.floor(now / 1000));
  return { "x-kaspi-timestamp": ts, "x-kaspi-signature": hmac(mockSecret(), ts, raw) };
}

/** Test helper / reference implementation of the real provider's signature. */
export function signLive(raw: string, now = Date.now()) {
  const key = liveSecret();
  if (!key) throw new Error("KASPI_WEBHOOK_SECRET not configured");
  const ts = String(Math.floor(now / 1000));
  return { "x-kaspi-timestamp": ts, "x-kaspi-signature": hmac(key, ts, raw) };
}

/**
 * Verifies signature + timestamp (±5 min, replay window). Returns who signed it, or null.
 * The timestamp is part of the signed data, so it can't be refreshed by an attacker replaying an old body.
 */
export function verifyWebhook(raw: string, signature: string | null, timestamp: string | null, now = Date.now()): EventSource | null {
  if (!signature || !timestamp || !/^\d{9,11}$/.test(timestamp)) return null;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_SKEW_S) return null;
  const live = liveSecret();
  if (live && safeEq(hmac(live, timestamp, raw), signature)) return "live";
  if (mockEnabled() && safeEq(hmac(mockSecret(), timestamp, raw), signature)) return "mock";
  return null;
}

/**
 * Base URL for server-to-server calls (the mock gateway delivering its webhook). Never derived from the Host header
 * in production: APP_URL → VERCEL_PROJECT_PRODUCTION_URL → (dev only) the request origin.
 */
export function appBaseUrl(req: Request): string | null {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  if (process.env.NODE_ENV !== "production") return new URL(req.url).origin;
  return null;
}

export type InvoiceView = { invoiceId: string; status: string; amount: number; currency: string; plan: string; planLabel: string; expiresAt: string; paymentUrl: string; campaignId: string | null; mock: boolean; refundDue: boolean };

type Meta = { expiresAt?: string; transactionId?: string; txIds?: string[]; refundDue?: boolean; refundReason?: string; latePayment?: boolean; duplicateCharges?: string[]; [k: string]: unknown };

export function view(p: { externalId: string | null; status: string; amount: number; currency: string; plan: string; meta: string; campaignId: string | null; provider: string }): InvoiceView {
  const meta = j<Meta>(p.meta, {});
  const plan = PLANS[p.plan as keyof typeof PLANS];
  return {
    invoiceId: p.externalId!, status: p.status, amount: p.amount, currency: p.currency, plan: p.plan, planLabel: plan?.label ?? p.plan,
    expiresAt: meta.expiresAt ?? "", paymentUrl: `/pay/kaspi/${p.externalId}`, campaignId: p.campaignId, mock: p.provider === MOCK_PROVIDER, refundDue: Boolean(meta.refundDue),
  };
}

export const isExpired = (p: { meta: string }, now = new Date()) => new Date(j<Meta>(p.meta, {}).expiresAt ?? 0) < now;

/** A running campaign blocks new invoices and payments (one campaign at a time, no double charge). */
export async function runningCampaign(userId: string) {
  return db.campaign.findFirst({
    where: { userId, status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

/** Mock-paid payments in the last 24h (abuse cap for the public demo). */
export async function mockPaidLast24h(userId: string) {
  return db.payment.count({ where: { userId, provider: MOCK_PROVIDER, status: "paid", paidAt: { gte: new Date(Date.now() - 86_400_000) } } });
}

/**
 * Creates (or reuses) an invoice. Partner attribution comes only from user.referredByCode (set at signup) —
 * client-supplied codes are ignored so nobody can assign revenue share to an arbitrary partner at checkout.
 */
export async function createInvoice(userId: string, planKey: string) {
  const plan = PLANS[planKey as keyof typeof PLANS];
  if (!plan) throw new Error("unknown plan");
  const provider = mockEnabled() ? MOCK_PROVIDER : LIVE_PROVIDER;
  // Reuse a still-open invoice for the same plan instead of piling up duplicates on double-clicks.
  const open = await db.payment.findFirst({ where: { userId, provider, status: "pending", plan: plan.key }, orderBy: { createdAt: "desc" } });
  if (open && !isExpired(open)) return open;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referredByCode: true } });
  const code = (user.referredByCode ?? "").trim().toUpperCase();
  const partner = code ? await db.partner.findUnique({ where: { code } }) : null;
  return db.payment.create({
    data: {
      userId, amount: plan.priceKzt, currency: "KZT", provider, status: "pending", plan: plan.key,
      externalId: `KSP-${randomBytes(16).toString("hex").toUpperCase()}`, // 128 bits: invoice ids are unguessable
      partnerCode: partner?.code ?? null, partnerCut: partner ? Math.round(plan.priceKzt * partner.revShare) : 0,
      meta: s({ expiresAt: new Date(Date.now() + INVOICE_TTL_MS).toISOString() }),
    },
  });
}

export type WebhookEvent = { event: "payment.succeeded" | "payment.failed"; invoiceId: string; amount: number; currency: string; transactionId: string; occurredAt: string };

/** Structural validation of an (already signature-verified) event body. */
export function parseEvent(raw: string): WebhookEvent | null {
  let e: Partial<WebhookEvent>;
  try {
    e = JSON.parse(raw) as Partial<WebhookEvent>;
  } catch {
    return null;
  }
  if (!e || typeof e !== "object") return null;
  if (e.event !== "payment.succeeded" && e.event !== "payment.failed") return null;
  if (typeof e.invoiceId !== "string" || !/^[A-Za-z0-9_-]{8,80}$/.test(e.invoiceId)) return null;
  if (typeof e.transactionId !== "string" || !/^[A-Za-z0-9_.:-]{4,128}$/.test(e.transactionId)) return null;
  if (typeof e.amount !== "number" || !Number.isInteger(e.amount) || typeof e.currency !== "string") return null;
  return { event: e.event, invoiceId: e.invoiceId, amount: e.amount, currency: e.currency, transactionId: e.transactionId, occurredAt: typeof e.occurredAt === "string" ? e.occurredAt.slice(0, 40) : "" };
}

export type WebhookResult =
  | { ok: false; status: number; error: string }
  | { ok: true; status: 200; duplicate?: boolean; campaignId?: string | null; refundDue?: boolean; startedCampaignId?: string };

const pushTx = (meta: Meta, tx: string) => ({ ...meta, txIds: [...(meta.txIds ?? []), tx].slice(-20) });

/** Webhook handler: source-checked, deduplicated on transactionId, amount-checked, idempotent. */
export async function handleWebhook(evt: WebhookEvent, source: EventSource): Promise<WebhookResult> {
  const p = await db.payment.findUnique({ where: { externalId: evt.invoiceId } });
  if (!p || !KASPI_PROVIDERS.includes(p.provider)) return { ok: false, status: 404, error: "unknown invoice" };
  // A mock-signed event can never settle a real invoice (and vice versa).
  if ((source === "mock") !== (p.provider === MOCK_PROVIDER)) return { ok: false, status: 403, error: "event source does not match invoice provider" };
  if (evt.amount !== p.amount || evt.currency !== p.currency) return { ok: false, status: 400, error: "amount mismatch" };
  if (!p.userId) return { ok: false, status: 410, error: "account deleted" };
  const meta = j<Meta>(p.meta, {});
  const seenTx = (meta.txIds ?? []).includes(evt.transactionId);

  if (evt.event === "payment.failed") {
    if (seenTx || p.status === "paid") return { ok: true, status: 200, duplicate: true, campaignId: p.campaignId };
    await db.payment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed", meta: s({ ...pushTx(meta, evt.transactionId), lastEvent: evt.event, lastEventAt: evt.occurredAt }) } });
    await logEvent(p.userId, "payment_failed", `Оплата ${p.externalId} отклонена`);
    return { ok: true, status: 200 };
  }

  if (p.status === "paid") {
    const duplicateCharge = !seenTx;
    if (duplicateCharge) {
      // Same invoice paid twice with different transactions: the second charge must be refunded, never silently absorbed.
      const fresh = j<Meta>((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).meta, {});
      await db.payment.update({ where: { id: p.id }, data: { meta: s({ ...pushTx(fresh, evt.transactionId), duplicateCharges: [...(fresh.duplicateCharges ?? []), evt.transactionId].slice(-20), refundDue: true, refundReason: "duplicate_charge" }) } });
      await logEvent(p.userId, "payment_refund_due", `Повторное списание по счёту ${p.externalId} (${evt.transactionId}) — будет возвращено`);
    }
    // Retry of an already-paid invoice: make sure the campaign exists (activation may have failed after the claim).
    const r = await activatePaid(p.id);
    return { ok: true, status: 200, duplicate: true, campaignId: r.campaignId ?? p.campaignId, refundDue: duplicateCharge || r.kind === "refund_due", startedCampaignId: r.kind === "created" ? r.campaignId : undefined };
  }

  const late = p.status === "expired" || isExpired(p);
  const claimMeta: Meta = { ...pushTx(meta, evt.transactionId), transactionId: evt.transactionId, lastEvent: evt.event, lastEventAt: evt.occurredAt, ...(late ? { latePayment: true } : {}) };
  const r = await activatePaid(p.id, claimMeta);
  if (r.kind === "not_paid") return { ok: true, status: 200, duplicate: true, campaignId: p.campaignId };
  if (late && r.claimed) await logEvent(p.userId, "payment_late", `Оплата по истёкшему счёту ${p.externalId} получена${r.kind === "refund_due" ? " — кампания уже идёт, платёж будет возвращён" : ""}`);
  return { ok: true, status: 200, duplicate: !r.claimed, campaignId: r.campaignId ?? null, refundDue: r.kind === "refund_due", startedCampaignId: r.kind === "created" ? r.campaignId : undefined };
}

type ActivateResult = { claimed: boolean } & ({ kind: "not_paid"; campaignId?: undefined } | { kind: "attached" | "created"; campaignId: string } | { kind: "refund_due"; campaignId?: undefined });

/**
 * Claims the payment (when claimMeta is given) and creates the campaign in ONE transaction, so a crash between
 * "paid" and "campaign created" can't leave a paid invoice without a campaign — and a retry repairs it anyway.
 * If the user already has a running campaign the payment is marked refund_due instead of being attached silently.
 * The first agent tick is NOT run here; callers schedule it with after() so the webhook returns fast.
 */
export async function activatePaid(paymentId: string, claimMeta?: Meta): Promise<ActivateResult> {
  const found = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { userId: true } });
  if (!found.userId) return { claimed: false, kind: "not_paid" };
  const pre = { userId: found.userId };
  const user = await db.user.findUniqueOrThrow({ where: { id: pre.userId }, include: { goal: true } });
  const readiness = await assessReadinessFor(pre.userId).catch(() => 0);

  const r = await db.$transaction(async (tx): Promise<ActivateResult & { externalId?: string | null; planLabel?: string; days?: number }> => {
    // Row lock on the user (Postgres) / write lock (SQLite): serializes activations of the same user,
    // so two different invoices paid concurrently can't both start a campaign.
    await tx.user.update({ where: { id: pre.userId }, data: { careerMode: user.careerMode } });
    let claimed = false;
    if (claimMeta) {
      const c = await tx.payment.updateMany({ where: { id: paymentId, status: { in: ["pending", "failed", "expired"] } }, data: { status: "paid", paidAt: new Date(), meta: s(claimMeta) } });
      claimed = c.count > 0;
    }
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status !== "paid") return { kind: "not_paid", claimed };
    if (p.campaignId) return { kind: "attached", campaignId: p.campaignId, claimed };
    const meta = j<Meta>(p.meta, {});
    if (meta.refundDue && !meta.duplicateCharges?.length) return { kind: "refund_due", claimed };

    const now = new Date();
    // Campaigns past endsAt are over even if no tick has expired them yet.
    await tx.campaign.updateMany({ where: { userId: pre.userId, status: { in: ["active", "paused"] }, endsAt: { lte: now } }, data: { status: "expired" } });
    const existing = await tx.campaign.findFirst({ where: { userId: pre.userId, status: { in: ["active", "paused"] } }, select: { id: true } });
    if (existing) {
      await tx.payment.update({ where: { id: p.id }, data: { meta: s({ ...meta, refundDue: true, refundReason: "campaign_already_active", conflictingCampaignId: existing.id }) } });
      return { kind: "refund_due", claimed, externalId: p.externalId };
    }
    const plan = PLANS[p.plan as keyof typeof PLANS] ?? PLANS.local;
    const campaign = await tx.campaign.create({
      data: {
        userId: pre.userId, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: user.goal?.mode ?? "autonomous", readiness,
        dailyLimit: plan.dailyLimit, autoSubmit: j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false, startedAt: now, endsAt: new Date(now.getTime() + plan.days * 86400000),
      },
    });
    await tx.payment.update({ where: { id: p.id }, data: { campaignId: campaign.id } });
    await tx.user.update({ where: { id: pre.userId }, data: { careerMode: "active" } });
    // Other open invoices can no longer be paid by mistake (a late payment on one is handled as refund_due).
    await tx.payment.updateMany({ where: { userId: pre.userId, id: { not: p.id }, status: "pending", provider: { in: KASPI_PROVIDERS } }, data: { status: "expired" } });
    return { kind: "created", campaignId: campaign.id, claimed, externalId: p.externalId, planLabel: plan.label, days: plan.days };
  });

  if (r.kind === "created") {
    await logEvent(pre.userId, "campaign_started", `Оплата Kaspi Pay ${r.externalId} прошла. Career Campaign «${r.planLabel}» запущена на ${r.days} дней`);
  } else if (r.kind === "refund_due" && r.externalId) {
    await logEvent(pre.userId, "payment_refund_due", `Оплата ${r.externalId} получена, но кампания уже идёт — платёж будет возвращён`);
    await notify(pre.userId, "info", "Платёж будет возвращён", `Счёт ${r.externalId} оплачен, но у тебя уже есть активная кампания. Мы вернём деньги.`, "/app/campaign");
  }
  return r.kind === "not_paid" || r.kind === "refund_due" ? { kind: r.kind, claimed: r.claimed } : { kind: r.kind, campaignId: r.campaignId, claimed: r.claimed };
}
