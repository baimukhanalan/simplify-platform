import "server-only";
import { z } from "zod";
import { listDevices, pushConfigured, removeSubscription, saveSubscription, sendToUser, setPushPref, subscriptionSchema, type PushSender } from "@/lib/notify/webpush";
import { db } from "@/lib/db";

// Push API logic, separated from the route files so tests can drive it without a request scope.
// Every handler takes the session user id (null = signed out) and returns { status, body }.

export type Result = { status: number; body: Record<string, unknown> };

const subscribeBody = z.object({ subscription: subscriptionSchema, replaces: z.string().max(2048).optional() });
const endpointBody = z.object({ endpoint: z.string().min(1).max(2048) });

const unauthorized: Result = { status: 401, body: { error: "unauthorized" } };
const unavailable: Result = { status: 503, body: { error: "unavailable" } };
const invalid: Result = { status: 400, body: { error: "invalid" } };

export async function subscribe(userId: string | null, raw: unknown, userAgent: string): Promise<Result> {
  if (!userId) return unauthorized;
  if (!pushConfigured()) return unavailable;
  const p = subscribeBody.safeParse(raw);
  if (!p.success) return invalid;
  // The session may outlive its account (deleted user): don't create an orphan.
  if (!(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) return unauthorized;
  await saveSubscription(userId, p.data.subscription, userAgent, p.data.replaces);
  // The user switched push on. A browser-side key rotation (`replaces`, from the service worker) keeps their choice as is.
  if (!p.data.replaces) await setPushPref(userId, true);
  return { status: 200, body: { ok: true, devices: await listDevices(userId) } };
}

export async function unsubscribe(userId: string | null, raw: unknown): Promise<Result> {
  if (!userId) return unauthorized;
  const p = endpointBody.safeParse(raw);
  if (!p.success) return invalid;
  const removed = await removeSubscription(userId, p.data.endpoint);
  return { status: 200, body: { ok: true, removed, devices: await listDevices(userId) } };
}

/** «Проверить связь»: one push to this device only, and only if it is this user's. */
export async function testPush(userId: string | null, raw: unknown, send?: PushSender): Promise<Result> {
  if (!userId) return unauthorized;
  if (!pushConfigured()) return unavailable;
  const p = endpointBody.safeParse(raw);
  if (!p.success) return invalid;
  const own = await db.pushSubscription.findFirst({ where: { userId, endpoint: p.data.endpoint }, select: { id: true } });
  if (!own) return { status: 404, body: { error: "not_found" } };
  const r = await sendToUser(
    userId,
    { title: "Simplify на связи", body: "Сюда будут приходить приглашения на интервью, задания работодателей и офферы.", url: "/app/settings#notifications", tag: "simplify-check" },
    { endpoint: p.data.endpoint, send },
  );
  if (r.removed) return { status: 410, body: { error: "gone", devices: await listDevices(userId) } };
  return { status: r.sent ? 200 : 502, body: r.sent ? { ok: true } : { error: "failed" } };
}

/** Browser requests only from our own pages: a cross-site Origin is refused (belt and braces on top of SameSite). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
