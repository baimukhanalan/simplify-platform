import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "sfy_session";
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set (≥32 chars) in production");
    return new TextEncoder().encode("dev-only-secret-change-me-please-32bytes");
  }
  return new TextEncoder().encode(s);
};

/** Only same-origin relative paths; rejects //host, /\host and control characters browsers strip. */
export function safeNext(next: unknown, fallback = "/app") {
  const n = typeof next === "string" ? next : "";
  if (!n.startsWith("/") || /[\x00-\x1f\\]/.test(n)) return fallback;
  try {
    const u = new URL(n, "http://x");
    return u.origin === "http://x" ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function currentUser() {
  const id = await currentUserId();
  if (!id) return null;
  return db.user.findUnique({ where: { id }, include: { profile: true, goal: true } });
}

/** For pages/actions inside the app: redirects to /login when signed out. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/app");
  return user;
}
