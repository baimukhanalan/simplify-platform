// Numbers, money and dates per language (pure, Intl). Dates are always shown in Almaty time; ₸ stays ₸ in every language.
import { INTL_TAG, TIME_ZONE, type Locale } from "./config";

const nf = new Map<string, Intl.NumberFormat>();
const df = new Map<string, Intl.DateTimeFormat>();
const key = (l: string, o: object) => `${l}|${JSON.stringify(o)}`;

function numberFormat(locale: Locale, opts: Intl.NumberFormatOptions) {
  const k = key(locale, opts);
  let f = nf.get(k);
  if (!f) nf.set(k, (f = new Intl.NumberFormat(INTL_TAG[locale], opts)));
  return f;
}
function dateFormat(locale: Locale, opts: Intl.DateTimeFormatOptions) {
  const o = { timeZone: TIME_ZONE, ...opts };
  const k = key(locale, o);
  let f = df.get(k);
  if (!f) df.set(k, (f = new Intl.DateTimeFormat(INTL_TAG[locale], o)));
  return f;
}

/** «1 234,5» (ru, kk) / «1,234.5» (en). At most `digits` decimals, no trailing zeros. */
export function formatNumber(locale: Locale, n: number, digits = 1) {
  return numberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

/**
 * Money, whole units: KZT → «29 990 ₸» (ru, kk) / «₸29,990» (en); USD → «$60 000» / «$60,000»; other ISO codes use Intl.
 * The ₸ sign is kept in every language (never «KZT» / «тг»).
 */
export function formatMoney(locale: Locale, amount: number, currency = "KZT") {
  const n = Math.round(amount);
  const cur = currency.toUpperCase();
  const num = formatNumber(locale, n, 0);
  if (cur === "KZT") return locale === "en" ? `₸${num}` : `${num} ₸`;
  if (cur === "USD") return `${n < 0 ? "−" : ""}$${formatNumber(locale, Math.abs(n), 0)}`;
  return numberFormat(locale, { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(n);
}

export type DateStyle =
  | "dayMonth" //       29 сентября · 29 қыркүйек · September 29
  | "dayMonthShort" //  29 сент. · 29 қыр. · Sep 29
  | "dayMonthYear" //   29 сентября 2026 г. · 2026 ж. 29 қыркүйек · September 29, 2026
  | "weekdayDayMonth" // вт, 29 сентября · …
  | "time" //           15:05 (24-hour in every language)
  | "dateTime"; //      29 сентября, 15:05

const STYLES: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  dayMonth: { day: "numeric", month: "long" },
  dayMonthShort: { day: "numeric", month: "short" },
  dayMonthYear: { day: "numeric", month: "long", year: "numeric" },
  weekdayDayMonth: { weekday: "short", day: "numeric", month: "long" },
  time: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
  dateTime: { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
};

/** A date in Almaty time. Null/invalid → «—». */
export function formatDate(locale: Locale, d: Date | number | string | null | undefined, style: DateStyle = "dayMonth") {
  if (d == null) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "—";
  if (style === "dateTime") return `${dateFormat(locale, STYLES.dayMonth).format(date)}, ${dateFormat(locale, STYLES.time).format(date)}`;
  return dateFormat(locale, STYLES[style]).format(date);
}

/** «15:05» — hours and minutes in Almaty time, 24-hour clock everywhere. */
export const formatTime = (locale: Locale, d: Date | number) => formatDate(locale, d, "time");

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400000], ["hour", 3600000], ["minute", 60000]];

/** «3 часа назад» · «3 сағат бұрын» · «3 hours ago»; under a minute → «сейчас» / «қазір» / «now». */
export function formatRelative(locale: Locale, d: Date | number, now: number = Date.now()) {
  const diff = (d instanceof Date ? d.getTime() : d) - now;
  const rtf = new Intl.RelativeTimeFormat(INTL_TAG[locale], { numeric: "auto" });
  for (const [unit, ms] of UNITS) if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  return rtf.format(0, "second");
}

/** «A, B и C» · «A, B және C» · «A, B and C». */
export function formatList(locale: Locale, items: string[]) {
  // ICU's Kazakh list pattern has no conjunction («A, B, C»); UI copy says «және».
  if (locale === "kk") return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} және ${items[items.length - 1]}`;
  return new Intl.ListFormat(INTL_TAG[locale], { style: "long", type: "conjunction" }).format(items);
}
