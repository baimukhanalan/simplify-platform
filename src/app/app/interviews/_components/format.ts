import { almatyDayDiff, assessmentDeadline, plural } from "../../../_components/ru";

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата не назначена";

const DAYS = ["день", "дня", "дней"] as const;

/** "3 дня" with a non-breaking space, so the number never wraps away from its unit. */
export const daysWord = (n: number) => `${n} ${plural(n, DAYS)}`;

/** Relative day by Almaty calendar days: «сегодня», «завтра», «через 3 дня», «2 дня назад». */
export function relDays(d: Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const days = almatyDayDiff(d, now);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  if (days === 2) return "послезавтра";
  if (days === -2) return "позавчера";
  return days > 0 ? `через ${daysWord(days)}` : `${daysWord(-days)} назад`;
}

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export const nowMs = () => Date.now();

/** An assessment deadline: «ср, 30 сентября, до 23:59» — the shared wording (assessmentDeadline). */
export const deadlineText = (d: Date | null | undefined) => assessmentDeadline(d);
