// Server-side language: getLocale() / getT() for server components, actions and route handlers.
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { currentUserId } from "@/lib/auth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, resolveLocale, shouldAdoptCookie, type Locale } from "./config";
import { DICTIONARIES } from "./dictionaries";
import { createTranslator, pickMessages, type Namespace } from "./translator";

/**
 * The request's language, once per request: signed-in User.locale → `locale` cookie → Accept-Language → ru.
 * Every signed-in row has a locale (default «ru»); a fresh account adopts the choice made on /login before signup
 * (shouldAdoptCookie) and saves it.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const [jar, h, userId] = await Promise.all([cookies(), headers(), currentUserId()]);
  const cookie = jar.get(LOCALE_COOKIE)?.value ?? null;
  let userLocale: string | null = null;
  if (userId) {
    const u = await db.user.findUnique({ where: { id: userId }, select: { locale: true, createdAt: true } }).catch(() => null);
    userLocale = u?.locale ?? null;
    if (u && shouldAdoptCookie(u, cookie)) {
      userLocale = cookie;
      await db.user.updateMany({ where: { id: userId, locale: DEFAULT_LOCALE }, data: { locale: cookie } }).catch(() => undefined);
    }
  }
  return resolveLocale({ userLocale, cookie, acceptLanguage: h.get("accept-language") });
});

export async function getDictionary(locale?: Locale) {
  return DICTIONARIES[locale ?? (await getLocale())];
}

/** The translator for this request: const t = await getT(); t("nav.inbox"). */
export const getT = cache(async (locale?: Locale) => {
  const l = locale ?? (await getLocale());
  return createTranslator(l, DICTIONARIES[l]);
});

/** A translator for an explicit language outside a request (tests, emails in the recipient's language later). */
export const translatorFor = (locale: Locale) => createTranslator(locale, DICTIONARIES[locale]);

export async function getMessages(namespaces: readonly Namespace[], locale?: Locale) {
  const l = locale ?? (await getLocale());
  return { locale: l, messages: pickMessages(DICTIONARIES[l], namespaces) };
}
