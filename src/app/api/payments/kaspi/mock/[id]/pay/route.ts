import { randomBytes } from "node:crypto";
import { currentUserId } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { sign, view, type WebhookEvent } from "@/lib/payments/kaspi";

export const maxDuration = 60;

/**
 * MOCK gateway: simulates the customer paying (or declining) in Kaspi, then delivers the signed
 * webhook to our own endpoint over HTTP — exactly what the real provider would do.
 * Body: { outcome?: "success" | "fail" }. Owner-only.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const p = await db.payment.findFirst({ where: { externalId: id, userId } });
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  if (p.status === "paid") return Response.json(view(p));
  if (new Date(j<{ expiresAt?: string }>(p.meta, {}).expiresAt ?? 0) < new Date()) {
    await db.payment.update({ where: { id: p.id }, data: { status: "expired" } });
    return Response.json({ error: "invoice expired" }, { status: 410 });
  }
  const { outcome } = (await req.json().catch(() => ({}))) as { outcome?: string };
  const evt: WebhookEvent = {
    event: outcome === "fail" ? "payment.failed" : "payment.succeeded",
    invoiceId: id, amount: p.amount, currency: p.currency,
    transactionId: `TX-${randomBytes(6).toString("hex").toUpperCase()}`, occurredAt: new Date().toISOString(),
  };
  const raw = JSON.stringify(evt);
  const origin = new URL(req.url).origin;
  const res = await fetch(`${origin}/api/payments/kaspi/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-kaspi-signature": sign(raw) }, body: raw, cache: "no-store" });
  if (!res.ok) return Response.json({ error: "webhook delivery failed", status: res.status }, { status: 502 });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  return Response.json(view(fresh));
}
