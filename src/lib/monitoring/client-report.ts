import { z } from "zod";
import { db } from "../db";
import { captureError, maybePruneErrorLog } from "./index";
import { sessionUserIdFromCookieHeader } from "./session";

// POST /api/monitoring/client — error-boundary reports from browsers. Public (no auth), so: same-origin only, JSON only,
// ≤16 KB, zod-validated, spam-filtered, rate-limited per IP (and globally per instance). userId is tagged when the
// request carries a valid session cookie.

export const MAX_BODY = 16 * 1024;
const PER_IP = { limit: 20, windowMs: 60_000 };
const GLOBAL = { limit: 300, windowMs: 60_000 };
/** Open (unresolved) client-sourced ErrorLog rows kept; past it every report folds into one overflow row (count++). */
export const CLIENT_OPEN_CAP = 500;
export const OVERFLOW_MESSAGE = "client error overflow";
/** Chance that a capture also runs the (at most daily per instance) retention cleanup. */
const PRUNE_CHANCE = 0.01;

const Report = z.object({
  message: z.string().trim().min(1).max(1000),
  name: z.string().trim().max(80).optional(),
  stack: z.string().max(8000).optional(),
  digest: z.string().trim().max(100).regex(/^[\w-]*$/).optional(),
  route: z.string().max(300).regex(/^\/[^\s]*$/),
  boundary: z.enum(["global", "app", "admin", "root", "segment"]).default("segment"),
}).strict();
export type ClientReport = z.infer<typeof Report>;

/** Spam / junk heuristics: links, markup, obvious ad text, non-text noise. */
export function looksLikeSpam(r: Pick<ClientReport, "message" | "stack">): boolean {
  const text = `${r.message}\n${r.stack ?? ""}`;
  const links = (r.message.match(/https?:\/\//gi) ?? []).length;
  if (links > 2) return true;
  if (/<a\s|<script|\[url=|href=/i.test(r.message)) return true;
  if (/\b(casino|viagra|crypto ?airdrop|free money|porn|loan offer|бесплатн\w* деньги|казино|ставк\w* на спорт)\b/i.test(r.message)) return true;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.message)) return true;
  const printable = text.replace(/[^\p{L}\p{N}\p{P}\p{S}\s]/gu, "");
  if (printable.length < text.length * 0.9) return true;
  return false;
}

const hits = new Map<string, { n: number; reset: number }>();
function hit(key: string, limit: number, windowMs: number, now = Date.now()) {
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  cur.n++;
  return { ok: cur.n <= limit, retryAfter: Math.ceil((cur.reset - now) / 1000) };
}
export const resetClientReportLimits = () => { hits.clear(); fullCache = null; };

/** Same trust rules as src/lib/rate-limit.ts: Vercel's header, X-Forwarded-For only behind a trusted proxy. */
function clientIp(h: Headers) {
  const trustXff = Boolean(process.env.VERCEL) || process.env.TRUST_PROXY === "1";
  return h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || (trustXff ? h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0].trim() : "") || "local";
}

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export async function handleClientReport(req: Request): Promise<Response> {
  const h = req.headers;
  // Browsers send Sec-Fetch-Site; a cross-site page must not be able to write into our error log.
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return json(403, { error: "forbidden" });
  const origin = h.get("origin");
  // A browser's fetch() POST always carries one of the two; a script without either is not our page (dev tools aside).
  if (!origin && site !== "same-origin" && process.env.NODE_ENV !== "development") return json(403, { error: "forbidden" });
  const host = h.get("x-forwarded-host") || h.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return json(403, { error: "forbidden" }); } catch { return json(403, { error: "forbidden" }); }
  }
  if (!(h.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json(415, { error: "unsupported media type" });
  const declared = Number(h.get("content-length") ?? "0");
  if (declared > MAX_BODY) return json(413, { error: "too large" });

  const ip = clientIp(h);
  const rl = hit(`ip:${ip}`, PER_IP.limit, PER_IP.windowMs);
  if (!rl.ok) return json(429, { error: "rate limited" }, { "retry-after": String(rl.retryAfter) });

  let raw: string;
  try { raw = await readLimited(req, MAX_BODY); } catch { return json(413, { error: "too large" }); }
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return json(400, { error: "invalid json" }); }
  const parsed = Report.safeParse(data);
  if (!parsed.success) return json(400, { error: "invalid report" });
  if (looksLikeSpam(parsed.data)) return json(400, { error: "rejected" });
  if (!hit("global", GLOBAL.limit, GLOBAL.windowMs).ok) return json(429, { error: "rate limited" }, { "retry-after": "60" });

  const r = parsed.data;
  const userId = await sessionUserIdFromCookieHeader(h.get("cookie") ?? "");
  if (Math.random() < PRUNE_CHANCE) void maybePruneErrorLog();
  if (await clientLogFull()) {
    // Storage cap: anyone can post here, so past CLIENT_OPEN_CAP open client rows nothing new is stored — one row counts.
    await captureError(Object.assign(new Error(OVERFLOW_MESSAGE), { name: "Overflow", stack: "" }), { source: "client", route: "/", userId, meta: { overflow: true } });
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  const err = Object.assign(new Error(r.message), { name: r.name || "Error", stack: r.stack ? `${r.name || "Error"}: ${r.message}\n${r.stack.split("\n").filter((l) => /^\s*at\s|@/.test(l)).join("\n")}` : "" });
  await captureError(err, {
    source: "client",
    route: r.route,
    digest: r.digest,
    userId,
    meta: { boundary: r.boundary, userAgent: (h.get("user-agent") ?? "").slice(0, 200) },
  });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** Open client rows at the cap? Cached for a few seconds per instance (the endpoint is rate-limited anyway). */
let fullCache: { at: number; full: boolean } | null = null;
async function clientLogFull(now = Date.now()) {
  if (fullCache && now - fullCache.at < 5000) return fullCache.full;
  try {
    const open = await db.errorLog.count({ where: { source: "client", resolvedAt: null, NOT: { message: OVERFLOW_MESSAGE } } });
    fullCache = { at: now, full: open >= CLIENT_OPEN_CAP };
  } catch {
    fullCache = { at: now, full: false };
  }
  return fullCache.full;
}
export const resetClientLogCache = () => { fullCache = null; };

/** Read the body, aborting past `max` bytes (a missing / lying Content-Length can't make us buffer more). */
async function readLimited(req: Request, max: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new Error("too large"); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
