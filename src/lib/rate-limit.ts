import "server-only";
import { headers } from "next/headers";

// Fixed-window in-memory limiter (per instance). Swap for Redis/Upstash when running multiple instances.
const hits = new Map<string, { n: number; reset: number }>();

export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true };
  }
  cur.n++;
  return { ok: cur.n <= limit, retryAfter: Math.ceil((cur.reset - now) / 1000) };
}
