// Interface languages. Pure module: safe on the server and in client components.

export const LOCALES = ["ru", "kk", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** Russian is the product's source language and the fallback for everything. */
export const DEFAULT_LOCALE: Locale = "ru";
/** Cookie that remembers the choice (also for signed-out visitors). Not httpOnly: global-error.tsx reads it on the client. */
export const LOCALE_COOKIE = "locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Every date and time in the product is Almaty time, whatever the language. */
export const TIME_ZONE = "Asia/Almaty";

/** BCP 47 tags for Intl. */
export const INTL_TAG: Record<Locale, string> = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };
/** Switcher labels: RU · ҚАЗ · EN. */
export const LOCALE_SHORT: Record<Locale, string> = { ru: "RU", kk: "ҚАЗ", en: "EN" };
/** Each language named in itself (aria-labels, lang menus). */
export const LOCALE_NATIVE: Record<Locale, string> = { ru: "Русский", kk: "Қазақша", en: "English" };

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/**
 * Best supported language from an Accept-Language header, honouring q-values and order.
 * «kk», «kk-KZ» and the common mistake «kz» map to Kazakh; «ru-*», «en-*» to their base. Null when nothing matches.
 */
export function fromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const qv = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(qv) ? qv : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    const l = base === "kz" ? "kk" : base;
    if (isLocale(l)) return l;
  }
  return null;
}

/**
 * The resolution order, pure: the signed-in user's saved language → the `locale` cookie → Accept-Language → Russian.
 * Invalid values at any step are skipped, never trusted.
 */
export function resolveLocale(src: { userLocale?: string | null; cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(src.userLocale)) return src.userLocale;
  if (isLocale(src.cookie)) return src.cookie;
  return fromAcceptLanguage(src.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** How long a brand-new account may adopt the language picked before signup (the row starts with the default «ru»). */
export const ADOPT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Should a signed-in user's row take the cookie's language? Only for an account created within ADOPT_WINDOW_MS whose
 * row still has the default: the switcher always writes cookie and row together, so on a fresh account a different
 * cookie can only be the choice made on /login before signup. Anything else — the row wins.
 */
export function shouldAdoptCookie(user: { locale: string; createdAt: Date }, cookie: string | null | undefined, now = Date.now()): cookie is Locale {
  return user.locale === DEFAULT_LOCALE && isLocale(cookie) && cookie !== DEFAULT_LOCALE && now - user.createdAt.getTime() < ADOPT_WINDOW_MS && now >= user.createdAt.getTime();
}
