// Telegram message texts (HTML parse_mode), in the linked user's interface language (telegramCard.bot.*; Russian by
// default — «ты», gender-neutral). Pure apart from reading the dictionaries.
import { absoluteAppUrl } from "./config";
import type { InlineButton } from "./client";
import { DEFAULT_LOCALE, fromAcceptLanguage, isLocale, type Locale } from "../i18n/config";
import { DICTIONARIES } from "../i18n/dictionaries";
import { createTranslator, type T } from "../i18n/translator";

const translators = new Map<Locale, T>();
/** The bot's translator for a language (cached). */
export function botT(locale: Locale = DEFAULT_LOCALE): T {
  let t = translators.get(locale);
  if (!t) translators.set(locale, (t = createTranslator(locale, DICTIONARIES[locale])));
  return t;
}

/** A saved User.locale → the bot's language; for a chat with no linked user, Telegram's language_code (else Russian). */
export function botLocale(userLocale?: string | null, telegramLanguage?: string | null): Locale {
  if (isLocale(userLocale)) return userLocale;
  return fromAcceptLanguage(telegramLanguage) ?? DEFAULT_LOCALE;
}

/** Escape text for Telegram HTML: only &, <, > (and " inside attributes) are special. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Telegram's hard limit is 4096 characters of the parsed text; keep a margin for the tags. */
export const MAX_TEXT = 3800;

/** Trim to `max` characters on a character boundary (never splits a surrogate pair), with an ellipsis. */
export function clip(s: string, max: number) {
  const chars = [...s];
  return chars.length <= max ? s : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

/** Strip control characters (except newline) — Telegram rejects some, and NUL breaks Postgres elsewhere. */
const clean = (s: string) => s.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").replace(/\n{3,}/g, "\n\n").trim();

type Heading = "headingInterview" | "headingAssessment" | "headingOffer" | "headingRejection";
type TypeMeta = { emoji: string; heading?: Heading; silent?: boolean };

/** Per notification type: emoji, a heading key (none → the notification's own title), quiet delivery. */
export const TYPE_META: Record<string, TypeMeta> = {
  interview: { emoji: "🗓", heading: "headingInterview" },
  assessment: { emoji: "📝", heading: "headingAssessment" },
  offer: { emoji: "🎉", heading: "headingOffer" },
  hired: { emoji: "🏆" },
  rejection: { emoji: "✉️", heading: "headingRejection", silent: true },
  info: { emoji: "🔔", silent: true },
};

/** Engine titles that the heading replaces outright (anything else is kept as a second line — e.g. «… на hh.kz»). */
const GENERIC_TITLES = new Set(["Новое интервью", "Новое тестовое задание", "Следующий этап: assessment", "YOU GOT THE OFFER"]);

/** «Открыть в Simplify» (Russian); other languages: botT(locale)("telegramCard.bot.openButton"). */
export const OPEN_BUTTON = botT()("telegramCard.bot.openButton");

export type TgNotification = { type: string; title: string; body: string; href: string };

export function isQuietType(type: string) {
  return Boolean((TYPE_META[type] ?? TYPE_META.info).silent);
}

/** The Telegram message for one in-app notification: bold heading, optional title line, body, «Открыть в Simplify». */
export function formatNotification(n: TgNotification, base?: string | null, locale: Locale = DEFAULT_LOCALE): { html: string; buttons: InlineButton[]; silent: boolean } {
  const t = botT(locale);
  const meta = TYPE_META[n.type] ?? TYPE_META.info;
  const title = clip(clean(n.title), 200);
  const own = meta.heading ? t(`telegramCard.bot.${meta.heading}`) : null;
  const heading = own ?? (title || t("telegramCard.bot.newNotification"));
  const head = [`${meta.emoji} <b>${esc(heading)}</b>`];
  // Engine titles are Russian: compare with the Russian heading, whatever the language.
  const ruHeading = meta.heading ? botT()(`telegramCard.bot.${meta.heading}`) : null;
  if (own && title && !GENERIC_TITLES.has(title) && title !== own && title !== ruHeading) head.push(esc(title));
  // Escaping can grow the text up to 6×: shorten the body until the whole message fits.
  let html = head.join("\n");
  for (let max = 3000; max > 0; max = Math.floor(max * 0.6)) {
    const body = clip(clean(n.body), max);
    const candidate = body ? `${html}\n\n${esc(body)}` : html;
    if (candidate.length <= MAX_TEXT) {
      html = candidate;
      break;
    }
  }
  const url = absoluteAppUrl(n.href, base);
  return { html, buttons: url ? [{ text: t("telegramCard.bot.openButton"), url }] : [], silent: Boolean(meta.silent) };
}

// ——— Bot replies ———

/** Every bot reply in one language. */
export function botText(locale: Locale = DEFAULT_LOCALE) {
  const t = botT(locale);
  const b = (k: string) => t(`telegramCard.bot.${k}` as Parameters<T>[0]);
  const commands = b("commands");
  return {
    linked: (name: string) =>
      `✅ <b>${esc(b("linkedTitle"))}</b>\n\n${name ? t("telegramCard.bot.linkedNamed", { name: esc(clip(name, 60)) }) : b("linkedPlain")}\n\n${commands}`,
    alreadyLinked: `${b("alreadyLinked")}\n\n${commands}`,
    expired: b("expired"),
    invalid: b("invalid"),
    startNoCode: b("startNoCode"),
    stopped: b("stopped"),
    notLinked: b("notLinked"),
    help: `${b("help")}\n\n${commands}`,
    groupOnly: b("groupOnly"),
    ping: `✅ <b>${esc(b("pingTitle"))}</b>\n\n${b("pingText")}`,
    unlinkedFromApp: b("unlinkedFromApp"),
  };
}

/** The Russian replies (the default language). */
export const TEXT = botText();
