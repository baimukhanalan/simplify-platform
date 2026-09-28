import "server-only";
import { headers } from "next/headers";

// Fixed-window in-memory limiter (per instance). Swap for Redis/Upstash when running multiple instances.
const hits = new Map<string, { n: number; reset: number }>();

export async function rateLimit(bucket: string, limit: number, windowMs: number) {
  const h = await headers();
  // On Vercel these headers are set by the edge (client-supplied values are overwritten).
  const ip = h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true };
  }
  cur.n++;
  return { ok: cur.n <= limit, retryAfter: Math.ceil((cur.reset - now) / 1000) };
}
