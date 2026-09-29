// Telegram message texts (HTML parse_mode). Russian, «ты», gender-neutral. Pure.
import { absoluteAppUrl } from "./config";
import type { InlineButton } from "./client";

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

type TypeMeta = { emoji: string; heading?: string; silent?: boolean };

/** Per notification type: emoji, a Russian heading (null → the notification's own title), quiet delivery. */
export const TYPE_META: Record<string, TypeMeta> = {
  interview: { emoji: "🗓", heading: "Тебя пригласили на интервью" },
  assessment: { emoji: "📝", heading: "Новое тестовое задание" },
  offer: { emoji: "🎉", heading: "Пришёл оффер" },
  hired: { emoji: "🏆" },
  rejection: { emoji: "✉️", heading: "Ответ от работодателя", silent: true },
  info: { emoji: "🔔", silent: true },
};

/** Engine titles that the Russian heading replaces outright (anything else is kept as a second line — e.g. «… на hh.kz»). */
const GENERIC_TITLES = new Set(["Новое интервью", "Следующий этап: assessment", "YOU GOT THE OFFER"]);

export const OPEN_BUTTON = "Открыть в Simplify";

export type TgNotification = { type: string; title: string; body: string; href: string };

export function isQuietType(type: string) {
  return Boolean((TYPE_META[type] ?? TYPE_META.info).silent);
}

/** The Telegram message for one in-app notification: bold heading, optional title line, body, «Открыть в Simplify». */
export function formatNotification(n: TgNotification, base?: string | null): { html: string; buttons: InlineButton[]; silent: boolean } {
  const meta = TYPE_META[n.type] ?? TYPE_META.info;
  const title = clip(clean(n.title), 200);
  const heading = meta.heading ?? (title || "Новое уведомление");
  const head = [`${meta.emoji} <b>${esc(heading)}</b>`];
  if (meta.heading && title && !GENERIC_TITLES.has(title) && title !== meta.heading) head.push(esc(title));
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
  return { html, buttons: url ? [{ text: OPEN_BUTTON, url }] : [], silent: Boolean(meta.silent) };
}

// ——— Bot replies ———

export const TEXT = {
  linked: (name: string) => `✅ <b>Telegram подключён</b>\n\n${name ? `${esc(clip(name, 60))}, сюда` : "Сюда"} будут приходить важные новости поиска: приглашения на интервью, тестовые задания, офферы.\n\n/status — как идёт кампания\n/stop — отключить уведомления`,
  alreadyLinked: "✅ Этот чат уже подключён к Simplify.\n\n/status — как идёт кампания\n/stop — отключить уведомления",
  expired: "⏳ Ссылка для подключения устарела.\n\nОткрой Simplify → Настройки → Уведомления и нажми «Подключить Telegram» ещё раз.",
  invalid: "Не получилось распознать ссылку для подключения.\n\nОткрой Simplify → Настройки → Уведомления и нажми «Подключить Telegram».",
  startNoCode: "👋 Это бот Simplify — он присылает важные новости твоего поиска работы.\n\nЧтобы подключить уведомления, открой Simplify → Настройки → Уведомления и нажми «Подключить Telegram».",
  stopped: "🔕 Уведомления отключены. Подключить снова можно в Simplify → Настройки → Уведомления.",
  notLinked: "Этот чат не подключён к Simplify.\n\nОткрой Simplify → Настройки → Уведомления и нажми «Подключить Telegram».",
  help: "Я присылаю важные новости поиска: интервью, тестовые задания, офферы.\n\n/status — как идёт кампания\n/stop — отключить уведомления",
  groupOnly: "Уведомления Simplify приходят только в личный чат с ботом.",
  ping: "✅ <b>Связь с Simplify работает</b>\n\nВажные новости поиска будут приходить сюда.",
  unlinkedFromApp: "🔕 Telegram отключён в настройках Simplify. Уведомления больше не придут.",
};
