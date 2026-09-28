import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

// Fixed-window in-memory limiter (per instance). Swap for Redis/Upstash when running multiple instances.
const hits = new Map<string, { n: number; reset: number }>();

function hit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  cur.n++;
  return { ok: cur.n <= limit, retryAfter: Math.ceil((cur.reset - now) / 1000) };
}

/** Per client IP (anonymous endpoints: login, signup, free Career Check). */
export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const h = await headers();
  // On Vercel these headers are set by the edge (client-supplied values are overwritten).
  const ip = h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  return hit(`${bucket}:${ip}`, limit, windowMs);
}

/**
 * Per signed-in user (AI/agent-heavy actions). Keyed by user id, so switching IPs doesn't help.
 * With `eventTypes`, the user's own Event log is also counted — that part is durable and shared across
 * serverless instances (each successful run logs one of those events); the in-memory counter catches bursts.
 */
export async function rateLimitUser(bucket: string, userId: string, limit: number, windowMs: number, opts: { eventTypes?: string[] } = {}) {
  const mem = hit(`u:${bucket}:${userId}`, limit, windowMs);
  if (!mem.ok) return mem;
  if (opts.eventTypes?.length) {
    const n = await db.event.count({ where: { userId, type: { in: opts.eventTypes }, createdAt: { gte: new Date(Date.now() - windowMs) } } });
    if (n >= limit) return { ok: false, retryAfter: Math.ceil(windowMs / 1000) };
  }
  return mem;
}

/** Human-readable "try again in N min" for Russian UI messages. */
export const retryText = (retryAfter?: number) => `Слишком часто. Попробуйте через ${Math.max(1, Math.ceil((retryAfter ?? 60) / 60))} мин.`;
