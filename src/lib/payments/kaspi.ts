import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, isPostgres, j, s } from "../db";
import { runningCampaignWhere } from "../ops-data";
import { PLANS } from "../engine/taxonomy";
import { logEvent, notify } from "../engine/agent";
import { assessReadinessFor } from "./readiness-snapshot";
import { isSimulation } from "../mode";

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
/** How a payment's provider is named on screen: every Kaspi invoice (whichever gateway settled it) is «Kaspi Pay». */
export const providerLabel = (p: string | null | undefined) => (isKaspiProvider(p) ? "Kaspi Pay" : p === "test" ? "Kaspi Pay" : p || "—");

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

export type InvoiceView = {
  invoiceId: string; status: string; amount: number; currency: string; plan: string; planLabel: string; expiresAt: string; paymentUrl: string; campaignId: string | null; mock: boolean;
  /** Any refund is owed on this invoice (a duplicate charge, a campaign already running, a deleted account). */
  refundDue: boolean;
  /** The payment will never start a campaign: it is refunded instead (campaign already running / account deleted). */
  activationBlocked: boolean;
  /** Why the invoice was closed before its TTL ("campaign_started"), or null. */
  expiredReason: string | null;
};

export type RefundReason = "duplicate_charge" | "campaign_already_active" | "account_deleted";
/** One refund promise. Entries are only ever appended — a later event can never erase an earlier promise. */
export type RefundEntry = { tx: string; reason: RefundReason | string; at: string };
/** Reasons that mean this payment must not activate a campaign (a duplicate charge only refunds the extra charge). */
const BLOCKING_REASONS = new Set<string>(["campaign_already_active", "account_deleted"]);

export type PaymentMeta = {
  expiresAt?: string; transactionId?: string; txIds?: string[]; refunds?: RefundEntry[]; latePayment?: boolean; duplicateCharges?: string[];
  /** Legacy (pre-`refunds`) single-slot fields: still read, never overwritten. */
  refundDue?: boolean; refundReason?: string; conflictingCampaignId?: string;
  /** Why a pending invoice was expired before its TTL ("campaign_started": another invoice started a campaign). */
  expiredReason?: string;
  [k: string]: unknown;
};
type Meta = PaymentMeta;

/**
 * The refund list of a payment. Reads the `refunds` list and the legacy single-slot fields (refundDue / refundReason /
 * duplicateCharges / conflictingCampaignId), so a promise recorded before the list existed — or overwritten by the
 * old code — is still honoured.
 */
export function refundsOf(meta: Meta): RefundEntry[] {
  const out: RefundEntry[] = Array.isArray(meta.refunds) ? meta.refunds.filter((r) => r && typeof r.reason === "string") : [];
  const add = (tx: string, reason: string) => { if (!out.some((r) => r.tx === tx && r.reason === reason)) out.push({ tx, reason, at: "" }); };
  const primary = meta.transactionId ?? "";
  // The old code overwrote refundReason "campaign_already_active" with "duplicate_charge"; conflictingCampaignId survived.
  if (meta.refundReason === "campaign_already_active" || meta.conflictingCampaignId) add(primary, "campaign_already_active");
  for (const tx of meta.duplicateCharges ?? []) add(tx, "duplicate_charge");
  if (meta.refundDue && !out.length) add(primary, meta.refundReason || "unknown");
  return out;
}

/** True when this payment must be refunded instead of starting a campaign. */
export const activationBlocked = (meta: Meta) => refundsOf(meta).some((r) => BLOCKING_REASONS.has(r.reason));

/** Payment meta string → refund state, for screens (payment history, admin, partners). */
export function refundState(metaJson: string) {
  const meta = j<Meta>(metaJson, {});
  const refunds = refundsOf(meta);
  return { refunds, refundDue: refunds.length > 0, blocked: activationBlocked(meta), expiredReason: typeof meta.expiredReason === "string" ? meta.expiredReason : undefined };
}

/**
 * Real money kept: a paid payment through a real provider whose amount is not being refunded. Mock/test-gateway
 * payments move no money; a payment that could not start a campaign (campaign already running / account deleted) is
 * refunded in full. A duplicate charge refunds only the extra charge, so the payment itself still counts.
 */
export function countsAsRevenue(p: { provider: string; status: string; meta: string }) {
  // Simulation mode (src/lib/mode.ts): built-in gateway payments are booked like any paid Kaspi payment.
  const gatewayOk = p.provider !== MOCK_PROVIDER || isSimulation();
  return p.status === "paid" && gatewayOk && p.provider !== "test" && !activationBlocked(j<Meta>(p.meta, {}));
}

/** Appends a refund entry (idempotent per tx+reason) and keeps the legacy `refundDue` flag set for old readers. */
function withRefund(meta: Meta, tx: string, reason: RefundReason, extra: Partial<Meta> = {}): Meta {
  const refunds = refundsOf(meta);
  if (!refunds.some((r) => r.tx === tx && r.reason === reason)) refunds.push({ tx, reason, at: new Date().toISOString() });
  return { ...meta, ...extra, refunds: refunds.slice(-50), refundDue: true };
}

export function view(p: { externalId: string | null; status: string; amount: number; currency: string; plan: string; meta: string; campaignId: string | null; provider: string }, now = new Date()): InvoiceView {
  const meta = j<Meta>(p.meta, {});
  const plan = PLANS[p.plan as keyof typeof PLANS];
  // A pending invoice past its TTL is dead for the user even before the provider reports it (same rule as the page).
  const status = p.status === "pending" && isExpired(p, now) ? "expired" : p.status;
  return {
    invoiceId: p.externalId!, status, amount: p.amount, currency: p.currency, plan: p.plan, planLabel: plan?.label ?? p.plan,
    expiresAt: meta.expiresAt ?? "", paymentUrl: `/pay/kaspi/${p.externalId}`, campaignId: p.campaignId, mock: p.provider === MOCK_PROVIDER,
    refundDue: refundsOf(meta).length > 0, activationBlocked: activationBlocked(meta), expiredReason: typeof meta.expiredReason === "string" ? meta.expiredReason : null,
  };
}

export const isExpired = (p: { meta: string }, now = new Date()) => new Date(j<Meta>(p.meta, {}).expiresAt ?? 0) < now;

/** A running campaign blocks new invoices and payments (one campaign at a time, no double charge). */
export async function runningCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, ...runningCampaignWhere() }, orderBy: { createdAt: "desc" }, select: { id: true } });
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
      // Built-in gateway payments move no money in live mode: attribution is kept, no revenue share is owed. In simulation
      // mode they are booked like any Kaspi payment, share included.
      partnerCode: partner?.code ?? null, partnerCut: partner && (provider !== MOCK_PROVIDER || isSimulation()) ? Math.round(plan.priceKzt * partner.revShare) : 0,
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
const seen = (meta: Meta, tx: string) => (meta.txIds ?? []).includes(tx) || meta.transactionId === tx;

type Tx = Prisma.TransactionClient;

/**
 * Serializes payment bookkeeping per user until the transaction ends. Postgres: a row lock (SELECT … FOR UPDATE).
 * SQLite (dev/tests) has a single writer: a no-op self-assignment makes the write lock the transaction's first
 * statement — nothing read earlier (and possibly stale) is written back.
 */
async function lockUser(tx: Tx, userId: string) {
  if (isPostgres) await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  else await tx.$executeRaw`UPDATE "User" SET "careerMode" = "careerMode" WHERE "id" = ${userId}`;
}

/** Same as lockUser for a payment that has no user any more (deleted account). */
async function lockPayment(tx: Tx, paymentId: string) {
  if (isPostgres) await tx.$queryRaw`SELECT 1 FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
  else await tx.$executeRaw`UPDATE "Payment" SET "status" = "status" WHERE "id" = ${paymentId}`;
}

/** Webhook handler: source-checked, deduplicated on transactionId, amount-checked, idempotent. */
export async function handleWebhook(evt: WebhookEvent, source: EventSource): Promise<WebhookResult> {
  const p = await db.payment.findUnique({ where: { externalId: evt.invoiceId } });
  if (!p || !KASPI_PROVIDERS.includes(p.provider)) return { ok: false, status: 404, error: "unknown invoice" };
  // A mock-signed event can never settle a real invoice (and vice versa).
  if ((source === "mock") !== (p.provider === MOCK_PROVIDER)) return { ok: false, status: 403, error: "event source does not match invoice provider" };
  if (evt.amount !== p.amount || evt.currency !== p.currency) return { ok: false, status: 400, error: "amount mismatch" };
  // Deleted account: the money may still have moved. Book it (paid + refund promise) and acknowledge, so the provider
  // stops retrying and the refund is on record — a 4xx here would leave a real charge with no trace.
  if (!p.userId) return settleOrphan(p.id, evt);
  const meta = j<Meta>(p.meta, {});

  if (evt.event === "payment.failed") {
    if (seen(meta, evt.transactionId) || p.status === "paid") return { ok: true, status: 200, duplicate: true, campaignId: p.campaignId };
    await db.payment.updateMany({ where: { id: p.id, status: "pending" }, data: { status: "failed", meta: s({ ...pushTx(meta, evt.transactionId), lastEvent: evt.event, lastEventAt: evt.occurredAt }) } });
    await logEvent(p.userId, "payment_failed", `Оплата ${p.externalId} отклонена`);
    return { ok: true, status: 200 };
  }

  // Claim, duplicate-charge bookkeeping and activation all happen under one per-user lock (see activatePaid).
  const r = await activatePaid(p.id, { tx: evt.transactionId, event: evt.event, occurredAt: evt.occurredAt });
  if (r.kind === "not_paid") return { ok: true, status: 200, duplicate: true, campaignId: p.campaignId };
  return {
    ok: true, status: 200, duplicate: !r.claimed, campaignId: r.campaignId ?? null,
    refundDue: r.duplicateCharge || r.kind === "refund_due", startedCampaignId: r.kind === "created" ? r.campaignId : undefined,
  };
}

/** A payment event for an invoice whose account was deleted (Payment.userId nulled). */
async function settleOrphan(paymentId: string, evt: WebhookEvent): Promise<WebhookResult> {
  const r = await db.$transaction(async (tx) => {
    await lockPayment(tx, paymentId);
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const meta = j<Meta>(p.meta, {});
    if (seen(meta, evt.transactionId)) return { duplicate: true, refund: false };
    const base = { ...pushTx(meta, evt.transactionId), lastEvent: evt.event, lastEventAt: evt.occurredAt };
    if (evt.event === "payment.failed") {
      if (p.status !== "pending") return { duplicate: true, refund: false };
      await tx.payment.update({ where: { id: p.id }, data: { status: "failed", meta: s(base) } });
      return { duplicate: false, refund: false };
    }
    if (p.status === "paid") {
      // Charged again for a deleted account: this charge is owed back too.
      const next = withRefund({ ...base, duplicateCharges: [...(meta.duplicateCharges ?? []), evt.transactionId].slice(-20) }, evt.transactionId, "duplicate_charge");
      await tx.payment.update({ where: { id: p.id }, data: { meta: s(next) } });
      return { duplicate: true, refund: true };
    }
    await tx.payment.update({
      where: { id: p.id },
      data: { status: "paid", paidAt: new Date(), meta: s(withRefund({ ...base, transactionId: evt.transactionId }, evt.transactionId, "account_deleted")) },
    });
    return { duplicate: false, refund: true };
  });
  if (r.refund) console.warn("[kaspi] payment for a deleted account — refund due", { paymentId, transactionId: evt.transactionId });
  return { ok: true, status: 200, duplicate: r.duplicate, campaignId: null, refundDue: r.refund };
}

/** The charge being processed: its transaction id and the event that reported it. */
export type Charge = { tx: string; event: string; occurredAt: string };

type ActivateResult = { claimed: boolean; duplicateCharge: boolean } & (
  | { kind: "not_paid"; campaignId?: undefined }
  | { kind: "attached" | "created"; campaignId: string }
  | { kind: "refund_due"; campaignId?: undefined }
);

/**
 * Under a per-user lock and in ONE transaction: claims the payment for `charge` (or, when the invoice is already paid
 * by another transaction, records that charge as a duplicate to refund) and creates the campaign — so a crash between
 * "paid" and "campaign created" can't leave a paid invoice without a campaign, and a retry repairs it anyway.
 * A payment with a blocking refund entry (campaign already running / account deleted) never activates; if the user
 * already has a running campaign the payment gets such an entry instead of being attached silently.
 * The first agent tick is NOT run here; callers schedule it with after() so the webhook returns fast.
 */
export async function activatePaid(paymentId: string, charge?: Charge): Promise<ActivateResult> {
  const found = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { userId: true } });
  if (!found.userId) return { claimed: false, duplicateCharge: false, kind: "not_paid" };
  const userId = found.userId;
  const readiness = await assessReadinessFor(userId).catch(() => 0);

  type Inner = ActivateResult & { externalId?: string | null; planLabel?: string; days?: number; late?: boolean; newlyBlocked?: boolean };
  const r = await db.$transaction(async (tx): Promise<Inner> => {
    // Serializes activations and bookkeeping of the same user: two invoices paid concurrently can't both start a
    // campaign, and two deliveries can't both append (or lose) a refund entry.
    await lockUser(tx, userId);
    let p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    let meta = j<Meta>(p.meta, {});
    let claimed = false, duplicateCharge = false, late = false;
    if (charge && !seen(meta, charge.tx)) {
      if (p.status === "pending" || p.status === "failed" || p.status === "expired") {
        late = p.status === "expired" || isExpired(p);
        meta = { ...pushTx(meta, charge.tx), transactionId: charge.tx, lastEvent: charge.event, lastEventAt: charge.occurredAt, ...(late ? { latePayment: true } : {}) };
        p = await tx.payment.update({ where: { id: p.id }, data: { status: "paid", paidAt: new Date(), meta: s(meta) } });
        claimed = true;
      } else if (p.status === "paid") {
        // Same invoice paid twice with different transactions: the second charge must be refunded, never silently absorbed.
        meta = withRefund({ ...pushTx(meta, charge.tx), duplicateCharges: [...(meta.duplicateCharges ?? []), charge.tx].slice(-20) }, charge.tx, "duplicate_charge");
        p = await tx.payment.update({ where: { id: p.id }, data: { meta: s(meta) } });
        duplicateCharge = true;
      }
    }
    const base = { claimed, duplicateCharge, externalId: p.externalId, late };
    if (p.status !== "paid") return { ...base, kind: "not_paid" };
    if (p.campaignId) return { ...base, kind: "attached", campaignId: p.campaignId };
    if (activationBlocked(meta)) return { ...base, kind: "refund_due" };

    const now = new Date();
    // Campaigns past endsAt are over even if no tick has expired them yet.
    await tx.campaign.updateMany({ where: { userId, status: { in: ["active", "paused"] }, endsAt: { lte: now } }, data: { status: "expired" } });
    const existing = await tx.campaign.findFirst({ where: { userId, ...runningCampaignWhere(now) }, select: { id: true } });
    if (existing) {
      const next = withRefund(meta, meta.transactionId ?? charge?.tx ?? "", "campaign_already_active", { conflictingCampaignId: existing.id });
      await tx.payment.update({ where: { id: p.id }, data: { meta: s(next) } });
      return { ...base, kind: "refund_due", newlyBlocked: true };
    }
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { consents: true, goal: { select: { mode: true } } } });
    const plan = PLANS[p.plan as keyof typeof PLANS] ?? PLANS.local;
    const campaign = await tx.campaign.create({
      data: {
        userId, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: user.goal?.mode ?? "autonomous", readiness,
        dailyLimit: plan.dailyLimit, autoSubmit: j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false, startedAt: now, endsAt: new Date(now.getTime() + plan.days * 86400000),
      },
    });
    await tx.payment.update({ where: { id: p.id }, data: { campaignId: campaign.id } });
    await tx.user.update({ where: { id: userId }, data: { careerMode: "active" } });
    // Other open invoices can no longer be paid by mistake (a late payment on one is handled as refund_due). The reason
    // is recorded so the payment history doesn't claim they ran out of time.
    const others = await tx.payment.findMany({ where: { userId, id: { not: p.id }, status: "pending", provider: { in: KASPI_PROVIDERS } }, select: { id: true, meta: true } });
    for (const o of others) {
      await tx.payment.update({ where: { id: o.id }, data: { status: "expired", meta: s({ ...j<Meta>(o.meta, {}), expiredReason: "campaign_started", expiredAt: now.toISOString() }) } });
    }
    return { ...base, kind: "created", campaignId: campaign.id, planLabel: plan.label, days: plan.days };
  });

  if (r.duplicateCharge) await logEvent(userId, "payment_refund_due", `Повторное списание по счёту ${r.externalId} (${charge?.tx}) — будет возвращено`);
  if (r.late && r.claimed) await logEvent(userId, "payment_late", `Оплата по истёкшему счёту ${r.externalId} получена${r.kind === "refund_due" ? " — кампания уже идёт, платёж будет возвращён" : ""}`);
  if (r.kind === "created") {
    await logEvent(userId, "campaign_started", `Оплата Kaspi Pay ${r.externalId} прошла. Career Campaign «${r.planLabel}» запущена на ${r.days} дней`);
  } else if (r.kind === "refund_due" && r.newlyBlocked) {
    await logEvent(userId, "payment_refund_due", `Оплата ${r.externalId} получена, но кампания уже идёт — платёж будет возвращён`);
    await notify(userId, "info", "Платёж будет возвращён", `Счёт ${r.externalId} оплачен, но у тебя уже есть активная кампания — деньги вернутся тем же способом оплаты.`, "/app/campaign");
  }
  const flags = { claimed: r.claimed, duplicateCharge: r.duplicateCharge };
  return r.kind === "not_paid" || r.kind === "refund_due" ? { ...flags, kind: r.kind } : { ...flags, kind: r.kind, campaignId: r.campaignId };
}
