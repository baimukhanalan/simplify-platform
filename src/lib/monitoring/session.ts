import { jwtVerify } from "jose";

// Session user id from a raw Cookie header — for onRequestError, which runs outside the request's cookies() scope.
// Mirrors the cookie name and secret of src/lib/auth.ts (verify only; no DB, never throws).

const COOKIE = "sfy_session";

export async function sessionUserIdFromCookieHeader(cookieHeader: string): Promise<string | null> {
  try {
    const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    if (!m) return null;
    const s = process.env.SESSION_SECRET;
    if (!s || s.length < 32) {
      if (process.env.NODE_ENV === "production") return null;
    }
    const key = new TextEncoder().encode(s && s.length >= 32 ? s : "dev-only-secret-change-me-please-32bytes");
    const { payload } = await jwtVerify(decodeURIComponent(m[1]), key);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
