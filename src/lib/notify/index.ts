import "server-only";
import { after } from "next/server";
import { db } from "@/lib/db";
import { telegramMode } from "@/lib/telegram/config";
import { deliverTelegram, type DeliveryBudget } from "./telegram";
import { deliverWebPush, pushConfigured } from "./webpush";

export type OutgoingNotification = { id: string; userId: string; type: string; title: string; body: string; href: string };
export type { DeliveryBudget };

/**
 * Fan a freshly created in-app notification out to the user's external channels (Telegram, Web Push).
 * Each channel checks its own configuration and the user's notifyPrefs, claims the row before sending (so any number
 * of dispatches of one notification send it once) and never throws: a failed delivery must not break the caller.
 * `budget: "request"` (default) is one short attempt per channel; the cron catch-up (deliverPending) retries.
 */
export async function dispatch(n: OutgoingNotification, budget: DeliveryBudget = "request") {
  await Promise.allSettled([deliverTelegram(n, budget), deliverWebPush(n)]);
}

/** Upper bound for a detached delivery outside a request scope (scripts, tests): each channel is bounded anyway. */
const DETACHED_BOUND_MS = 15_000;

/**
 * Runs the delivery without making the caller wait: inside a request / server action / route handler through Next's
 * after() (the platform keeps the function alive until it finishes); outside one (after() throws there) as a bounded
 * fire-and-forget. Whatever doesn't get through is picked up by the cron catch-up (deliverPending).
 */
export function scheduleDelivery(n: OutgoingNotification) {
  const run = () => dispatch(n, "request").catch((e) => console.warn("[notify] dispatch failed", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    let t: ReturnType<typeof setTimeout> | undefined;
    void Promise.race([run(), new Promise<void>((r) => { t = setTimeout(r, DETACHED_BOUND_MS); t.unref?.(); })]).finally(() => clearTimeout(t));
  }
}

/** Create the in-app notification; external delivery happens after the response (never blocks the caller). */
export async function createNotification(userId: string, type: string, title: string, body = "", href = "") {
  const n = await db.notification.create({ data: { userId, type, title, body, href } });
  scheduleDelivery(n);
  return n;
}

/** How far back the catch-up looks: older undelivered news is stale for a push / Telegram message. */
export const CATCH_UP_WINDOW_MS = 6 * 3600_000;
const CATCH_UP_BATCH = 200;

/**
 * Cron catch-up: delivers recent notifications (created in the last CATCH_UP_WINDOW_MS) that a channel hasn't got yet —
 * a request-time send that timed out, failed, or never ran (function frozen). Only users for whom the channel is on
 * (Telegram: linked chat, prefs not off; push: at least one device, prefs not off). Retries are allowed here
 * (budget "cron"), one notification at a time, until `deadline` (epoch ms). Idempotent with any concurrent dispatch.
 */
export async function deliverPending(opts: { deadline: number; now?: Date }) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS);
  const res = { telegram: 0, push: 0, left: 0 };
  const tg = telegramMode() !== "off";
  const push = pushConfigured();
  if (!tg && !push) return res;
  const channels = [
    ...(tg ? [{ telegramSentAt: null, user: { telegramChatId: { not: null }, NOT: { notifyPrefs: { contains: '"telegram":false' } } } }] : []),
    ...(push ? [{ pushSentAt: null, user: { pushSubscriptions: { some: {} }, NOT: { notifyPrefs: { contains: '"webpush":false' } } } }] : []),
  ];
  const rows = await db.notification.findMany({
    where: { createdAt: { gte: since, lte: now }, OR: channels },
    // Newest first: fresh news matters most, and a row that keeps failing can't starve the ones behind it.
    orderBy: { createdAt: "desc" },
    take: CATCH_UP_BATCH,
    select: { id: true, userId: true, type: true, title: true, body: true, href: true, telegramSentAt: true, pushSentAt: true },
  });
  for (const [i, n] of rows.entries()) {
    if (Date.now() >= opts.deadline) { res.left = rows.length - i; break; }
    const out: OutgoingNotification = { id: n.id, userId: n.userId, type: n.type, title: n.title, body: n.body, href: n.href };
    await Promise.allSettled([
      tg && !n.telegramSentAt ? deliverTelegram(out, "cron") : null,
      push && !n.pushSentAt ? deliverWebPush(out) : null,
    ]);
    const now2 = await db.notification.findUnique({ where: { id: n.id }, select: { telegramSentAt: true, pushSentAt: true } });
    if (!n.telegramSentAt && now2?.telegramSentAt) res.telegram++;
    if (!n.pushSentAt && now2?.pushSentAt) res.push++;
  }
  return res;
}
