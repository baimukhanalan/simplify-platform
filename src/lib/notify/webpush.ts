import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import type { OutgoingNotification } from "./index";

// Web Push channel (PWA). Subscriptions live in PushSubscription (one row per browser endpoint); the user's switch is
// User.notifyPrefs.webpush (only that key is ever written here). Sending is dependency-injectable for tests.

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushSendOptions = { TTL: number; urgency: "high" | "normal"; timeout: number; vapidDetails: { subject: string; publicKey: string; privateKey: string } };
export type PushSender = (sub: PushTarget, payload: string, opts: PushSendOptions) => Promise<{ statusCode: number }>;
export type PushPayload = { title: string; body: string; url: string; tag?: string };
export type SendResult = { sent: number; removed: number; failed: number };

const SEND_TIMEOUT_MS = 10_000;
const MAX_DEVICES = 10;

const defaultSender: PushSender = async (sub, payload, opts) => {
  const webpush = (await import("web-push")).default;
  return webpush.sendNotification(sub, payload, opts);
};

/** VAPID keys from the environment, or null when push isn't configured (the card then says «скоро»). */
export function vapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:support@simplify.kz";
  return { publicKey, privateKey, subject };
}
export const pushConfigured = () => vapidConfig() !== null;

// ——— validation ———

/**
 * The server POSTs to a subscription's endpoint, so an arbitrary URL would be an SSRF hole: only the browsers' real
 * push services are accepted (Chrome/Edge/Opera/Samsung → FCM, Firefox → Mozilla autopush, Safari → Apple, legacy Edge → WNS).
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export function isAllowedEndpoint(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
    const host = u.hostname.toLowerCase();
    return PUSH_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
/** Decoded byte length of a base64url key, or -1 when it isn't base64url. */
const keyBytes = (s: string) => (b64url.test(s) ? Buffer.from(s.replace(/=+$/, ""), "base64url").length : -1);
export const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedEndpoint, "endpoint"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    // An uncompressed P-256 public key (65 bytes, 0x04 prefix) and a 16-byte auth secret, as every browser sends.
    p256dh: z.string().max(100).refine((s) => keyBytes(s) === 65 && Buffer.from(s.replace(/=+$/, ""), "base64url")[0] === 4, "p256dh"),
    auth: z.string().max(40).refine((s) => keyBytes(s) === 16, "auth"),
  }),
});
export type SubscriptionInput = z.infer<typeof subscriptionSchema>;

// ——— prefs ———

function parsePrefs(raw: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export async function pushPrefOn(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true } });
  return Boolean(u) && parsePrefs(u!.notifyPrefs).webpush !== false;
}

/**
 * Sets notifyPrefs.webpush and keeps every other channel's key as it is. Compare-and-swap on the whole JSON so a
 * concurrent write of another key (Telegram) is never lost: on a conflict re-read and merge again.
 */
export async function setPushPref(userId: string, on: boolean) {
  for (let i = 0; i < 5; i++) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true } });
    if (!u) return false;
    const prefs = parsePrefs(u.notifyPrefs);
    if (prefs.webpush === on) return true;
    const next = JSON.stringify({ ...prefs, webpush: on });
    const r = await db.user.updateMany({ where: { id: userId, notifyPrefs: u.notifyPrefs }, data: { notifyPrefs: next } });
    if (r.count) return true;
  }
  return false;
}

// ——— subscriptions ———

const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

/**
 * Upsert by endpoint. An endpoint is one browser profile: if it was registered by another account (shared computer,
 * re-login), it moves to this user, so pushes never reach the previous account's owner through it.
 */
export async function saveSubscription(userId: string, sub: SubscriptionInput, userAgent = "", replaces?: string) {
  const data = { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: userAgent.slice(0, 300) };
  for (let i = 0; ; i++) {
    try {
      await db.pushSubscription.upsert({ where: { endpoint: sub.endpoint }, create: { endpoint: sub.endpoint, ...data }, update: { ...data, createdAt: new Date() } });
      break;
    } catch (e) {
      // createdAt restarts on re-subscribe: it is «added on» in the device list and the age used for the device cap.
      // Two concurrent first-time upserts of one endpoint: the loser retries and lands on the update branch.
      if (!isUniqueViolation(e) || i >= 3) throw e;
    }
  }
  // A rotated subscription (pushsubscriptionchange) replaces the old endpoint — only this user's own row.
  if (replaces && replaces !== sub.endpoint) await db.pushSubscription.deleteMany({ where: { userId, endpoint: replaces } });
  // Keep the newest MAX_DEVICES browsers per account.
  const extra = await db.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
  if (extra.length) await db.pushSubscription.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
}

/** Removes this user's subscription for the endpoint (never another user's). */
export async function removeSubscription(userId: string, endpoint: string) {
  const r = await db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return r.count;
}

/** Short, non-reversible device key: the client hashes its own endpoint the same way to find «это устройство». */
export const endpointKey = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 16);

export function deviceLabel(ua: string) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /YaBrowser/.test(ua) ? "Яндекс Браузер" : /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome|CriOS/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(" · ") || "Браузер";
}

export async function listDevices(userId: string) {
  const rows = await db.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, select: { id: true, endpoint: true, userAgent: true, createdAt: true } });
  return rows.map((r) => ({ id: r.id, key: endpointKey(r.endpoint), label: deviceLabel(r.userAgent), createdAt: r.createdAt.toISOString() }));
}

// ——— sending ———

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(Object.assign(new Error("push timeout"), { statusCode: 0 })), ms); })]).finally(() => clearTimeout(t));
}

/** Sends to the given subscriptions in parallel; gone ones (404/410) are deleted. Never throws. */
async function sendTo(subs: { id: string; endpoint: string; p256dh: string; auth: string }[], payload: PushPayload, send: PushSender): Promise<SendResult> {
  const cfg = vapidConfig();
  const res: SendResult = { sent: 0, removed: 0, failed: 0 };
  if (!cfg || !subs.length) return res;
  const body = JSON.stringify(payload);
  const opts: PushSendOptions = { TTL: 24 * 3600, urgency: "high", timeout: SEND_TIMEOUT_MS, vapidDetails: cfg };
  const gone: { id: string; endpoint: string }[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await withTimeout(send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, opts), SEND_TIMEOUT_MS + 2000);
        res.sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.push({ id: s.id, endpoint: s.endpoint });
        else {
          res.failed++;
          console.error("[webpush] send failed", code ?? "", e instanceof Error ? e.message.slice(0, 200) : "");
        }
      }
    }),
  );
  if (gone.length) {
    try {
      // id + endpoint: a row re-subscribed meanwhile keeps its id, so the check is only a guard against id reuse.
      const r = await db.pushSubscription.deleteMany({ where: { OR: gone.map((g) => ({ id: g.id, endpoint: g.endpoint })) } });
      res.removed = r.count;
    } catch (e) {
      console.error("[webpush] cleanup failed", e);
    }
  }
  return res;
}

/** Push to every device of the user (or only the one `endpoint`, for «Проверить связь»). */
export async function sendToUser(userId: string, payload: PushPayload, opts: { endpoint?: string; send?: PushSender } = {}): Promise<SendResult> {
  try {
    const subs = await db.pushSubscription.findMany({ where: { userId, ...(opts.endpoint ? { endpoint: opts.endpoint } : {}) } });
    return await sendTo(subs, payload, opts.send ?? defaultSender);
  } catch (e) {
    console.error("[webpush] sendToUser failed", e);
    return { sent: 0, removed: 0, failed: 0 };
  }
}

/** Only in-app paths: a notification's href can never send the user off-site. */
export const pushUrl = (href: string) => (href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\") ? href.slice(0, 500) : "/app");

/**
 * Web Push channel for engine notifications. Skips when push isn't configured or the user switched it off. The
 * notification is claimed via pushSentAt first, so two dispatches of the same notification (two cron runs) push once;
 * if no device accepted it, the claim is released. Never throws.
 */
export async function deliverWebPush(n: OutgoingNotification, deps: { send?: PushSender } = {}): Promise<void> {
  try {
    if (!pushConfigured()) return;
    if (!(await pushPrefOn(n.userId))) return;
    const subs = await db.pushSubscription.findMany({ where: { userId: n.userId } });
    if (!subs.length) return;
    const claim = await db.notification.updateMany({ where: { id: n.id, userId: n.userId, pushSentAt: null }, data: { pushSentAt: new Date() } });
    if (!claim.count) return;
    const payload: PushPayload = { title: n.title.slice(0, 120) || "Simplify", body: n.body.slice(0, 300), url: pushUrl(n.href), tag: n.id };
    const r = await sendTo(subs, payload, deps.send ?? defaultSender);
    if (!r.sent) await db.notification.updateMany({ where: { id: n.id }, data: { pushSentAt: null } });
  } catch (e) {
    console.error("[webpush] deliver failed", e);
  }
}
