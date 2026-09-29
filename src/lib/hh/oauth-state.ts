import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomToken } from "../crypto";

// OAuth `state` for the hh.kz connect flow: a random nonce, bound to the user and a 10-minute expiry, signed with
// SESSION_SECRET and kept in an httpOnly cookie. The callback accepts only the same nonce for the same signed-in user.

export const HH_STATE_COOKIE = "sfy_hh_state";
export const HH_STATE_TTL_S = 600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (≥32 chars) in production");
    return "dev-only-hh-state-secret";
  }
  return `hh-state:${s}`;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function newOAuthState(userId: string, now = Date.now()) {
  const nonce = randomToken(24);
  const payload = `${nonce}.${userId}.${Math.floor(now / 1000) + HH_STATE_TTL_S}`;
  return { nonce, cookie: `${payload}.${sign(payload)}` };
}

/** True when `cookie` is ours, unexpired, for `userId`, and carries exactly the `state` hh sent back. */
export function verifyOAuthState(cookie: string | undefined, state: string | null, userId: string, now = Date.now()) {
  if (!cookie || !state) return false;
  const parts = cookie.split(".");
  if (parts.length !== 4) return false;
  const [nonce, uid, exp, sig] = parts;
  const want = Buffer.from(sign(`${nonce}.${uid}.${exp}`));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
  if (uid !== userId || Number(exp) * 1000 < now) return false;
  const a = Buffer.from(nonce), b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}
