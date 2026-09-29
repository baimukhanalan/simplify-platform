import "server-only";
// POST /api/inbound/email — the provider-facing half. Kept out of the route file so tests can drive it with a Request.
import { createHash, timingSafeEqual } from "node:crypto";
import { parseInbound } from "./parse";
import { deliverLetter, inboundSecret } from "./service";

/** Whole request (JSON, may carry base64 attachments we ignore). Larger → 413. */
export const REQUEST_MAX = 12 * 1024 * 1024;

const digest = (v: string) => createHash("sha256").update(v).digest();
/** Constant-time string compare (hashing first makes the lengths equal). */
export const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b)) && a.length === b.length;

/**
 * The shared secret, from any of: `X-Inbound-Secret` header (the Worker), HTTP basic auth — user or password (Postmark:
 * https://inbound:<secret>@host/api/inbound/email), or `?token=` (Postmark URLs without credentials).
 */
export function authorized(req: Request, secret = inboundSecret()) {
  if (!secret) return false;
  const candidates: string[] = [];
  const h = req.headers.get("x-inbound-secret");
  if (h) candidates.push(h.trim());
  const auth = req.headers.get("authorization");
  if (auth && /^basic\s+/i.test(auth)) {
    try {
      const decoded = Buffer.from(auth.replace(/^basic\s+/i, "").trim(), "base64").toString("utf8");
      const i = decoded.indexOf(":");
      if (i >= 0) candidates.push(decoded.slice(0, i), decoded.slice(i + 1));
    } catch {
      /* malformed */
    }
  }
  try {
    const t = new URL(req.url).searchParams.get("token");
    if (t) candidates.push(t);
  } catch {
    /* relative URL */
  }
  let ok = false;
  for (const c of candidates.slice(0, 4)) if (c && safeEqual(c, secret)) ok = true; // no early exit: same work either way
  return ok;
}

/** Read at most `max` bytes of the body; null when it is larger. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(len) && len > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const json = (body: object, status = 200) => Response.json(body, { status });

export async function handleInbound(req: Request): Promise<Response> {
  if (!inboundSecret()) return json({ error: "inbound email is not configured" }, 503);
  if (!authorized(req)) return json({ error: "unauthorized" }, 401);
  const raw = await readCapped(req, REQUEST_MAX);
  if (raw === null) return json({ error: "payload too large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const letter = parseInbound(body);
  if (!letter) return json({ error: "unsupported payload" }, 400);
  const { outcomes } = await deliverLetter(letter);
  if (outcomes.every((o) => o === "unknown_recipient")) return json({ ok: true, ignored: true });
  // Everything for this letter was over the limit: 429 lets Postmark retry later instead of dropping it.
  if (outcomes.every((o) => o === "rate_limited")) return json({ error: "rate limited" }, 429);
  return json({ ok: true, outcomes });
}
