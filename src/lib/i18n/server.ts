// Server-side language: getLocale() / getT() for server components, actions and route handlers.
import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import { currentUser, currentUserId } from "@/lib/auth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, fromAcceptLanguage, isLocale, resolveLocale, shouldAdoptCookie, type Locale } from "./config";
import { DICTIONARIES } from "./dictionaries";
import { createTranslator, pickMessages, type Namespace } from "./translator";

/**
 * The request's language, once per request: signed-in User.locale → `locale` cookie → ru. This is what <html lang>
 * and every translated screen use. Accept-Language is deliberately NOT part of it: several public pages (the landing)
 * are Russian-only, and a browser preference must not label them lang="en". It only pre-selects the language of the
 * sign-in page (entryLocale), and becomes the saved choice once the visitor signs up there.
 * Every signed-in row has a locale (default «ru»); a fresh account adopts the choice made on /login before signup
 * (shouldAdoptCookie) and saves it.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const [jar, userId] = await Promise.all([cookies(), currentUserId()]);
  const cookie = jar.get(LOCALE_COOKIE)?.value ?? null;
  let userLocale: string | null = null;
  if (userId) {
    // The same (per-request memoized) row the app layout and the page read — no separate query for the language.
    const u = await currentUser().catch(() => null);
    userLocale = u?.locale ?? null;
    if (u && shouldAdoptCookie(u, cookie)) {
      userLocale = cookie;
      await db.user.updateMany({ where: { id: userId, locale: DEFAULT_LOCALE }, data: { locale: cookie } }).catch(() => undefined);
    }
  }
  return resolveLocale({ userLocale, cookie });
});

/**
 * The language of the sign-in / sign-up page: getLocale() when the visitor has one (signed in, or a `locale` cookie);
 * otherwise the browser's Accept-Language (ru when nothing matches). The page renders its content in it (with a
 * matching lang attribute), and signup saves it as the account's language — the language the person actually saw.
 */
export const entryLocale = cache(async (): Promise<Locale> => {
  const [jar, h, userId] = await Promise.all([cookies(), headers(), currentUserId()]);
  if (userId || isLocale(jar.get(LOCALE_COOKIE)?.value)) return getLocale();
  return fromAcceptLanguage(h.get("accept-language")) ?? DEFAULT_LOCALE;
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
