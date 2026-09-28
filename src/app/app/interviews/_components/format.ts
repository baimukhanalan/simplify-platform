export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата не назначена";

export function relDays(d: Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const days = Math.round((d.getTime() - now) / 86400000);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  // Non-breaking spaces: "через 3 дн." never breaks between the number and its unit.
  return days > 0 ? `через\u00a0${days}\u00a0дн.` : `${-days}\u00a0дн. назад`;
}

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export const nowMs = () => Date.now();
