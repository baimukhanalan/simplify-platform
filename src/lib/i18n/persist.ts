// Saving the chosen language (server only). Separate from the "use server" file so nothing here is client-callable:
// the action passes the session's user id, never one from the request.
import "server-only";
import { db } from "@/lib/db";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, type Locale } from "./config";

export type CookieJar = { set(name: string, value: string, opts: { path: string; maxAge: number; sameSite: "lax"; secure: boolean; httpOnly: boolean }): unknown };

/** Cookie always (signed-in or not); User.locale only for the signed-in user. Invalid input changes nothing. */
export async function applyLocale(userId: string | null, raw: unknown, jar: CookieJar): Promise<{ ok: true; locale: Locale } | { ok: false }> {
  if (!isLocale(raw)) return { ok: false };
  jar.set(LOCALE_COOKIE, raw, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: false });
  if (userId) await db.user.updateMany({ where: { id: userId }, data: { locale: raw } });
  return { ok: true, locale: raw };
}
