import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for third-party tokens at rest. Key: ENCRYPTION_KEY (base64/hex, 32 bytes) or derived from SESSION_SECRET.
function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("ENCRYPTION_KEY or SESSION_SECRET (≥32 chars) required");
    return createHash("sha256").update("dev-only-encryption-key").digest();
  }
  return createHash("sha256").update(`simplify:tokens:${secret}`).digest();
}

export function encrypt(plain: string) {
  if (!plain) return "";
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(box: string) {
  if (!box) return "";
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1" || !iv || !tag || !data) return "";
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
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
