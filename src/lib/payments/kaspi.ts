import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { db, j, s } from "../db";
import { PLANS } from "../engine/taxonomy";
import { runTick, logEvent } from "../engine/agent";
import { assessReadinessFor } from "./readiness-snapshot";

/**
 * Kaspi Pay — MOCK provider. Mirrors a typical merchant flow:
 *   1. merchant creates an invoice            → POST /api/payments/kaspi/invoices
 *   2. customer pays in the (mock) gateway    → /pay/kaspi/[id] → POST /api/payments/kaspi/mock/[id]/pay
 *   3. gateway calls the merchant webhook     → POST /api/payments/kaspi/webhook  (HMAC-SHA256 signed)
 *   4. webhook marks the payment paid and activates the Career Campaign (idempotent)
 * Swapping in the real Kaspi Pay API only replaces steps 1–3; activation stays the same.
 */

export const PROVIDER = "kaspi_mock";
const INVOICE_TTL_MS = 30 * 60 * 1000;

function secret() {
  const s = process.env.KASPI_WEBHOOK_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("KASPI_WEBHOOK_SECRET must be set (≥32 chars) in production");
  return "dev-only-kaspi-mock-webhook-secret-32bytes!";
}

export function sign(rawBody: string) {
  return `sha256=${createHmac("sha256", secret()).update(rawBody).digest("hex")}`;
}

export function verify(rawBody: string, header: string | null) {
  if (!header) return false;
  const want = Buffer.from(sign(rawBody));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type InvoiceView = { invoiceId: string; status: string; amount: number; currency: string; plan: string; planLabel: string; expiresAt: string; paymentUrl: string; campaignId: string | null };

export function view(p: { externalId: string | null; status: string; amount: number; currency: string; plan: string; meta: string; campaignId: string | null }): InvoiceView {
  const meta = j<{ expiresAt?: string }>(p.meta, {});
  const plan = PLANS[p.plan as keyof typeof PLANS];
  return { invoiceId: p.externalId!, status: p.status, amount: p.amount, currency: p.currency, plan: p.plan, planLabel: plan?.label ?? p.plan, expiresAt: meta.expiresAt ?? "", paymentUrl: `/pay/kaspi/${p.externalId}`, campaignId: p.campaignId };
}

export async function createInvoice(userId: string, planKey: string, partnerCode?: string | null) {
  const plan = PLANS[planKey as keyof typeof PLANS];
  if (!plan) throw new Error("unknown plan");
  // Reuse a still-open invoice for the same plan instead of piling up duplicates on double-clicks.
  const open = await db.payment.findFirst({ where: { userId, provider: PROVIDER, status: "pending", plan: plan.key }, orderBy: { createdAt: "desc" } });
  if (open && new Date(j<{ expiresAt?: string }>(open.meta, {}).expiresAt ?? 0) > new Date()) return open;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referredByCode: true } });
  const code = (user.referredByCode ?? partnerCode ?? "").trim().toUpperCase();
  const partner = code ? await db.partner.findUnique({ where: { code } }) : null;
  return db.payment.create({
    data: {
      userId, amount: plan.priceKzt, currency: "KZT", provider: PROVIDER, status: "pending", plan: plan.key,
      externalId: `KSP-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`,
      partnerCode: partner?.code ?? null, partnerCut: partner ? Math.round(plan.priceKzt * partner.revShare) : 0,
      meta: s({ expiresAt: new Date(Date.now() + INVOICE_TTL_MS).toISOString() }),
    },
  });
}

export type WebhookEvent = { event: "payment.succeeded" | "payment.failed"; invoiceId: string; amount: number; currency: string; transactionId: string; occurredAt: string };

/** Webhook handler: verified, idempotent, amount-checked. */
export async function handleWebhook(evt: WebhookEvent) {
  const p = await db.payment.findUnique({ where: { externalId: evt.invoiceId } });
  if (!p || p.provider !== PROVIDER) return { ok: false as const, status: 404, error: "unknown invoice" };
  if (p.status === "paid") return { ok: true as const, status: 200, duplicate: true, campaignId: p.campaignId };
  if (evt.amount !== p.amount || evt.currency !== p.currency) return { ok: false as const, status: 400, error: "amount mismatch" };
  const meta = { ...j<Record<string, unknown>>(p.meta, {}), transactionId: evt.transactionId, lastEvent: evt.event, lastEventAt: evt.occurredAt };
  if (evt.event === "payment.failed") {
    await db.payment.update({ where: { id: p.id }, data: { status: "failed", meta: s(meta) } });
    await logEvent(p.userId, "payment_failed", `Оплата ${p.externalId} отклонена`);
    return { ok: true as const, status: 200 };
  }
  // Claim the transition atomically so two concurrent webhooks can't both activate a campaign.
  const claimed = await db.payment.updateMany({ where: { id: p.id, status: { in: ["pending", "failed"] } }, data: { status: "paid", paidAt: new Date(), meta: s(meta) } });
  if (!claimed.count) return { ok: true as const, status: 200, duplicate: true };
  const campaignId = await activateCampaign(p.id);
  return { ok: true as const, status: 200, campaignId };
}

export async function activateCampaign(paymentId: string) {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { user: { include: { goal: true } } } });
  const plan = PLANS[p.plan as keyof typeof PLANS] ?? PLANS.local;
  const existing = await db.campaign.findFirst({ where: { userId: p.userId, status: { in: ["active", "paused"] } } });
  if (existing) {
    await db.payment.update({ where: { id: p.id }, data: { campaignId: existing.id } });
    return existing.id;
  }
  const readiness = await assessReadinessFor(p.userId);
  const now = new Date();
  const campaign = await db.campaign.create({
    data: {
      userId: p.userId, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: p.user.goal?.mode ?? "autonomous", readiness,
      dailyLimit: plan.dailyLimit, autoSubmit: j<{ autoSubmit?: boolean }>(p.user.consents, {}).autoSubmit !== false, startedAt: now, endsAt: new Date(now.getTime() + plan.days * 86400000),
    },
  });
  await db.payment.update({ where: { id: p.id }, data: { campaignId: campaign.id } });
  await db.user.update({ where: { id: p.userId }, data: { careerMode: "active" } });
  await logEvent(p.userId, "campaign_started", `Оплата Kaspi Pay ${p.externalId} прошла. Career Campaign «${plan.label}» запущена на ${plan.days} дней`);
  try {
    await runTick(campaign.id);
  } catch (e) {
    console.error("[kaspi] first tick failed", e);
  }
  return campaign.id;
}
