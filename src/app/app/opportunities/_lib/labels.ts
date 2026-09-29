// Display helpers for Opportunities, Applications, Inbox and Approvals in the interface language. Pure: server and client.
// Russian goes through the existing helpers (identical output); kk / en use the `work` namespace and the locale formatters.
import type { MessageKey, T } from "@/lib/i18n/translator";
import { fmtDateTime, salaryLabel, SOURCE_LABEL } from "@/lib/ops";
import { almatyDayDiff, assessmentDeadline, industryRu, placeWithFormat, shortDate } from "../../../_components/ru";
import { agoRu } from "./when";

const DAY = 86400000;
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });

/** A dynamic key (status, industry…) with a fallback when the dictionary doesn't know it. */
export function tKey(t: T, key: string, fallback: string) {
  return t.has(key) ? t(key as MessageKey) : fallback;
}

/** lang attribute for engine text (journal lines, blockers, reasons) — Russian for now, marked in other languages. */
export const engineLang = (t: T) => (t.locale === "ru" ? undefined : "ru");

/** agoRu() in the interface language: «только что», «5 мин. назад», «вчера», «4 дня назад», then a date. */
export function agoT(t: T, date: Date | null | undefined, now: number = Date.now()) {
  if (t.locale === "ru") return agoRu(date, now);
  if (!date) return "—";
  const diff = now - date.getTime();
  const m = Math.round(Math.abs(diff) / 60000);
  const h = Math.round(m / 60);
  if (diff < 0) {
    const d = almatyDayDiff(date, now);
    if (d === 1) return t("work.tomorrow");
    if (d > 1 && d < 30) return t("work.inDays", { n: d });
    if (m < 1) return t("work.now");
    if (m < 60) return t("work.inMinutes", { n: m });
    if (h < 24) return t("work.inHours", { n: h });
    return t.date(date, "dayMonthShort");
  }
  if (diff < DAY) {
    if (dayKey(date) !== dayKey(new Date(now)) && diff >= 6 * 3600000) return t("work.yesterday");
    if (m < 1) return t("work.justNow");
    if (m < 60) return t("work.minutesAgo", { n: m });
    return t("work.hoursAgo", { n: h });
  }
  const d = -almatyDayDiff(date, now);
  if (d <= 1) return t("work.yesterday");
  if (d < 30) return t("work.daysAgo", { n: d });
  return t.date(date, "dayMonthShort");
}

/** «28 сент.» · «28 қыр.» · «Sep 28». */
export const shortDateT = (t: T, d: Date | null | undefined) => (t.locale === "ru" ? shortDate(d) : d ? t.date(d, "dayMonthShort") : "—");

/** «28 сент., 15:05» · «Sep 28, 15:05». */
export const dateTimeT = (t: T, d: Date | null | undefined) => (t.locale === "ru" ? fmtDateTime(d) : d ? `${t.date(d, "dayMonthShort")}, ${t.time(d)}` : "—");

/** An assessment deadline: «ср, 30 сентября, до 23:59» · «Wed, September 30, by 23:59». */
export function deadlineT(t: T, d: Date | null | undefined) {
  if (t.locale === "ru") return assessmentDeadline(d);
  if (!d) return t("work.deadlineUnknown");
  return t("work.deadlineAt", { date: t.date(d, "weekdayDayMonth"), time: t.time(d) });
}

/** Pipeline status name («Техническое интервью»); unknown keys fall back to the key. */
export const statusT = (t: T, s: string) => tKey(t, `work.status.${s}`, s);

const INDUSTRY_KEY: Record<string, string> = { "e-commerce": "ecommerce", "ai / data": "ai" };

/** Industry name (stored values stay English): «Финтех»; inSentence lower-cases an ordinary first word. */
export function industryT(t: T, industry: string, inSentence = false) {
  if (t.locale === "ru") return industryRu(industry, inSentence);
  const k = industry.trim().toLowerCase();
  const key = `work.industry.${INDUSTRY_KEY[k] ?? k}`;
  if (!t.has(key)) return industry;
  const v = t(key as MessageKey);
  return inSentence && !/^\p{Lu}[\p{Lu}\d-]/u.test(v) ? v.charAt(0).toLowerCase() + v.slice(1) : v;
}

const KK_PLACE: [RegExp, string][] = ([
  ["Almaty", "Алматы"], ["Astana|Nur-Sultan", "Астана"], ["Shymkent", "Шымкент"], ["Karaganda|Karagandy", "Қарағанды"], ["Aktobe", "Ақтөбе"], ["Atyrau", "Атырау"],
  ["Kazakhstan", "Қазақстан"], ["Tashkent", "Ташкент"], ["Uzbekistan", "Өзбекстан"], ["Bishkek", "Бішкек"], ["Kyrgyzstan", "Қырғызстан"],
  ["Tbilisi", "Тбилиси"], ["Georgia", "Грузия"], ["Yerevan", "Ереван"], ["Armenia", "Армения"], ["Baku", "Баку"], ["Azerbaijan", "Әзірбайжан"],
  ["Berlin", "Берлин"], ["Munich", "Мюнхен"], ["Germany", "Германия"], ["Warsaw", "Варшава"], ["Poland", "Польша"], ["Amsterdam", "Амстердам"], ["Netherlands", "Нидерланд"],
  ["London", "Лондон"], ["United Kingdom", "Ұлыбритания"], ["New York", "Нью-Йорк"], ["United States|USA", "АҚШ"], ["Dubai", "Дубай"], ["UAE|United Arab Emirates", "БАӘ"],
  ["Europe", "Еуропа"], ["Worldwide|Anywhere", "бүкіл әлем"], ["Remote", "Қашықтан"], ["Hybrid", "гибрид"], ["Onsite|On-site", "кеңседе"],
] as const).map(([en, kk]) => [new RegExp(`(?<![\\p{L}])(?:${en})(?![\\p{L}])`, "giu"), kk]);

/**
 * placeWithFormat() in the interface language: the place plus the work format, never said twice.
 * en keeps the posting's own place names; kk names the common ones in Kazakh.
 */
export function placeT(t: T, place: string | null | undefined, format: string | null | undefined) {
  if (t.locale === "ru") return placeWithFormat(place, format);
  const mode = (format ?? "").toLowerCase();
  const f = t.has(`work.mode.${mode}`) ? t(`work.mode.${mode}` as MessageKey) : "";
  let p = (place ?? "").trim();
  if (f) p = p.replace(/\s*\((?:remote|hybrid|on-?site)\)\s*$/i, "").trim();
  if (t.locale === "kk") p = KK_PLACE.reduce((s, [re, kk]) => s.replace(re, kk), p);
  if (!f) return p;
  if (!p) return f.charAt(0).toUpperCase() + f.slice(1);
  return p.toLowerCase().includes(f) ? p : `${p} · ${f}`;
}

/** A published salary: «$60 000–$80 000» · «₸300,000–₸500,000». Null when none is published. */
export function salaryT(t: T, min: number | null, max: number | null, cur = "USD") {
  if (t.locale === "ru") return salaryLabel(min, max, cur);
  if (!min && !max) return null;
  if (min && max && min !== max) return `${t.money(min, cur)}–${t.money(max, cur)}`;
  return t.money((max || min)!, cur);
}

/** The CV of one application: «CV для Kaspi» · «CV for Kaspi», or just «CV». */
export const cvLabelT = (t: T, company?: string | null) => (company ? t("work.cvFor", { company }) : "CV");

/** How the package went out (submitMethodLabel in src/lib/ops.ts), in the interface language. */
export function submitViaT(t: T, m: string) {
  if (!m) return "";
  if (m === "user-handoff") return t("work.viaHandoff");
  if (m === "hh-api") return t("work.viaHh");
  if (m.startsWith("ats:demo") || m.startsWith("ats:seed")) return t("work.viaEmployerForm");
  if (m.startsWith("ats:")) return t("work.viaAts", { name: SOURCE_LABEL[m.slice(4)] ?? m.slice(4) });
  return m;
}

/** Where a vacancy came from: a public board by name, the internal corpus as «Сайт работодателя». */
export const sourceT = (t: T, source: string) => (source === "demo" || source === "seed" || !SOURCE_LABEL[source] ? t("work.employerSite") : SOURCE_LABEL[source]);
