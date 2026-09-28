import { plural } from "../../../_components/ru";

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата не назначена";

const DAYS = ["день", "дня", "дней"] as const;

/** "3 дня" with a non-breaking space, so the number never wraps away from its unit. */
export const daysWord = (n: number) => `${n} ${plural(n, DAYS)}`;

export function relDays(d: Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const days = Math.round((d.getTime() - now) / 86400000);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  if (days === 2) return "послезавтра";
  if (days === -2) return "позавчера";
  return days > 0 ? `через ${daysWord(days)}` : `${daysWord(-days)} назад`;
}

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export const nowMs = () => Date.now();

/** "пятница, 3 октября, 18:00" — weekday stays lowercase inside a sentence («Дедлайн: пятница, …»). */
export const deadlineText = (d: Date | null | undefined) =>
  d
    ? `${d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", weekday: "long", day: "numeric", month: "long" }).toLowerCase()}, ${d.toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" })}`
    : "не указан";
