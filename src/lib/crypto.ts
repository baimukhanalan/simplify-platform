import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for third-party tokens at rest. Key: ENCRYPTION_KEY (base64/hex, 32 bytes) or derived from SESSION_SECRET.
// Without ENCRYPTION_KEY the key is derived from SESSION_SECRET: rotating SESSION_SECRET then makes every stored token
// undecryptable (hh users have to reconnect). Set ENCRYPTION_KEY before rotating the session secret.
//
// Formats: v2.<iv>.<tag>.<data> binds the ciphertext to its owner via AAD (`userId|provider`), so a token box copied to
// another user's row does not decrypt. v1 (no AAD) is still read for rows written before v2; new writes are v2.
function key() {
  const raw = process.env.ENCRYPTION_KEY?.trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : /^[A-Za-z0-9+/_-]+={0,2}$/.test(raw) ? Buffer.from(raw, "base64") : Buffer.alloc(0);
    if (buf.length === 32) return buf;
    // A malformed key must never silently fall back to another key in production: tokens would be written with a key
    // nobody configured, and every rotation of SESSION_SECRET would lose them.
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
    console.warn("[crypto] ENCRYPTION_KEY is malformed (need 32 bytes) — using the SESSION_SECRET-derived key (dev only)");
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY or SESSION_SECRET (≥32 chars) required");
    return createHash("sha256").update("dev-only-encryption-key").digest();
  }
  return createHash("sha256").update(`simplify:tokens:${secret}`).digest();
}

/** Owner binding for encrypt/decrypt: `userId|provider`. */
export const tokenAad = (userId: string, provider: string) => `${userId}|${provider}`;

/** Encrypt a token. With `aad` (tokenAad) the box is v2 and decrypts only with the same aad. */
export function encrypt(plain: string, aad?: string) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  if (aad) c.setAAD(Buffer.from(aad, "utf8"));
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${aad ? "v2" : "v1"}.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

/** Decrypt a v2 box (needs the same aad it was written with) or a legacy v1 box (aad ignored). "" when it fails. */
export function decrypt(box: string, aad?: string) {
  if (!box) return "";
  const [v, iv, tag, data] = box.split(".");
  if ((v !== "v1" && v !== "v2") || !iv || !tag || !data) return "";
  if (v === "v2" && !aad) return "";
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    if (v === "v2") d.setAAD(Buffer.from(aad!, "utf8"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
