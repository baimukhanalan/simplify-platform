import "server-only";
import { db } from "@/lib/db";
import { deliverTelegram } from "./telegram";
import { deliverWebPush } from "./webpush";

export type OutgoingNotification = { id: string; userId: string; type: string; title: string; body: string; href: string };

/**
 * Fan a freshly created in-app notification out to the user's external channels (Telegram, Web Push).
 * Each channel checks its own configuration and the user's notifyPrefs, and never throws: a failed delivery must not
 * break the agent cycle that produced the notification.
 */
export async function dispatch(n: OutgoingNotification) {
  await Promise.allSettled([deliverTelegram(n), deliverWebPush(n)]);
}

/** Create the in-app notification and deliver it to the external channels. */
export async function createNotification(userId: string, type: string, title: string, body = "", href = "") {
  const n = await db.notification.create({ data: { userId, type, title, body, href } });
  await dispatch(n);
  return n;
}
