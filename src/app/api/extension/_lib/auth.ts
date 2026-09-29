import "server-only";
// Extension API plumbing: token auth (X-Simplify-Token → sha256 → Integration.tokenHash), CORS for chrome-extension://
// origins only, and a per-token rate limit. The raw token is never stored; revoking deletes the Integration row.
import { db, j, s } from "@/lib/db";
import { safeEqualHex, sha256 } from "@/lib/crypto";
import { rateLimitUser } from "@/lib/rate-limit";

export const TOKEN_HEADER = "x-simplify-token";
export const EXTENSION_PROVIDER = "extension";
/** Tokens are randomToken(32): 43 base64url chars. Anything else is rejected before touching the DB. */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export type ExtensionAuth = { userId: string; integrationId: string };

/** Looks the token up by its hash. Null for a malformed, unknown or revoked token. */
export async function authenticateToken(token: string | null | undefined): Promise<ExtensionAuth | null> {
  if (!token || !TOKEN_RE.test(token)) return null;
  const hash = sha256(token);
  const row = await db.integration.findUnique({ where: { tokenHash: hash }, select: { id: true, userId: true, provider: true, tokenHash: true, meta: true } });
  if (!row || row.provider !== EXTENSION_PROVIDER || !row.tokenHash || !safeEqualHex(row.tokenHash, hash)) return null;
  const meta = j<{ lastUsedAt?: string }>(row.meta, {});
  // "Last used" for the settings page, written at most every 10 minutes.
  if (!meta.lastUsedAt || Date.now() - Date.parse(meta.lastUsedAt) > 10 * 60 * 1000) {
    await db.integration.update({ where: { id: row.id }, data: { meta: s({ ...meta, lastUsedAt: new Date().toISOString() }) } }).catch(() => undefined);
  }
  return { userId: row.userId, integrationId: row.id };
}

/**
 * Allowed caller origins: chrome-extension:// only (optionally pinned to SIMPLIFY_EXTENSION_IDS, comma-separated).
 * No Origin header (curl, server-to-server) is allowed through — the token is the credential; a web page can't set it
 * cross-origin without a preflight we refuse.
 */
export function originAllowed(origin: string | null) {
  if (!origin) return true;
  const m = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  if (!m) return false;
  const pinned = (process.env.SIMPLIFY_EXTENSION_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return !pinned.length || pinned.includes(m[1]);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const h: Record<string, string> = { Vary: "Origin", "Cache-Control": "private, no-store" };
  if (origin && originAllowed(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "X-Simplify-Token, Content-Type";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

export function json(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...corsHeaders(req.headers.get("origin")), ...extra } });
}

/** CORS preflight for every extension route. */
export function preflight(req: Request) {
  const origin = req.headers.get("origin");
  if (!originAllowed(origin)) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

/** Origin check + token auth + per-token rate limit; the handler gets the authenticated user. */
export async function withExtension(req: Request, handler: (auth: ExtensionAuth) => Promise<Response>, opts: { bucket?: string; limit?: number } = {}) {
  if (!originAllowed(req.headers.get("origin"))) return json(req, { error: "forbidden origin" }, 403);
  const auth = await authenticateToken(req.headers.get(TOKEN_HEADER));
  if (!auth) return json(req, { error: "unauthorized" }, 401);
  const rl = await rateLimitUser(`ext:${opts.bucket ?? "api"}`, auth.integrationId, opts.limit ?? 120, 10 * 60 * 1000);
  if (!rl.ok) return json(req, { error: "too many requests" }, 429, { "Retry-After": String(rl.retryAfter ?? 60) });
  return handler(auth);
}
