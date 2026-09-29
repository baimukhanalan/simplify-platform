// Russian text helpers for engine and server copy (pure). The UI has the same plural() in src/app/_components/ru.ts.

export type Forms = readonly [one: string, few: string, many: string];

/** Plural form for n: plural(5, ["вакансия", "вакансии", "вакансий"]) → "вакансий". Fractions take the "few" form (2,5 года). */
export function plural(n: number, forms: Forms) {
  if (!Number.isInteger(n)) return forms[1];
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Number plus its word: count(3, ["заявка", "заявки", "заявок"]) → "3 заявки". */
export const count = (n: number, forms: Forms) => `${fmtNum(n)} ${plural(n, forms)}`;

/** Russian number: one decimal at most, decimal comma ("3,4"), no trailing ",0". */
export function fmtNum(n: number, digits = 1) {
  const f = 10 ** digits;
  const r = Math.round(n * f) / f;
  return r.toLocaleString("ru-RU", { maximumFractionDigits: digits });
}

export const YEARS: Forms = ["год", "года", "лет"];

/** "1 год", "2 года", "5 лет", "3,4 года"; with suffix "+": "5+ лет". */
export function fmtYearsRu(y: number, suffix = "") {
  const r = Math.round(y * 10) / 10;
  return `${fmtNum(r)}${suffix} ${plural(r, YEARS)}`;
}

export const NBSP = " ";

/* ——— Localized values for the Russian UI (stored values stay as written; these only format them) ——— */

const PLACE_RU: [RegExp, string][] = ([
  ["Almaty", "Алматы"], ["Astana|Nur-Sultan", "Астана"], ["Shymkent", "Шымкент"], ["Karaganda|Karagandy", "Караганда"], ["Aktobe", "Актобе"], ["Atyrau", "Атырау"],
  ["Kazakhstan", "Казахстан"], ["Tashkent", "Ташкент"], ["Uzbekistan", "Узбекистан"], ["Bishkek", "Бишкек"], ["Kyrgyzstan", "Кыргызстан"],
  ["Tbilisi", "Тбилиси"], ["Georgia", "Грузия"], ["Yerevan", "Ереван"], ["Armenia", "Армения"], ["Baku", "Баку"], ["Azerbaijan", "Азербайджан"],
  ["Berlin", "Берлин"], ["Munich", "Мюнхен"], ["Germany", "Германия"], ["Warsaw", "Варшава"], ["Poland", "Польша"], ["Amsterdam", "Амстердам"], ["Netherlands", "Нидерланды"],
  ["London", "Лондон"], ["United Kingdom", "Великобритания"], ["New York", "Нью-Йорк"], ["United States|USA", "США"], ["Dubai", "Дубай"], ["UAE|United Arab Emirates", "ОАЭ"],
  ["Europe", "Европа"], ["Worldwide", "весь мир"], ["Remote", "Удалённо"], ["Hybrid", "гибрид"], ["Onsite|On-site", "офис"],
] as const).map(([en, ru]) => [new RegExp(`(?<![\\p{L}])(?:${en})(?![\\p{L}])`, "giu"), ru]);

/** "Almaty, Kazakhstan" → «Алматы, Казахстан»; "Remote — Europe" → «Удалённо — Европа». Unknown names stay as written. */
export function placeRu(place: string) {
  let out = place;
  for (const [re, ru] of PLACE_RU) out = out.replace(re, ru);
  return out;
}

/** Notice period for the Russian UI: "2 weeks" → «2 недели», "1 month" → «1 месяц», "Immediately" → «Сразу». Stored as written. */
export function noticeRu(v: string | null | undefined) {
  const t = (v ?? "").trim();
  if (!t) return "";
  if (/^(immediately|asap|now|right away)$/i.test(t)) return "Сразу";
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(day|week|month)s?$/i);
  if (!m) return t;
  const n = Number(m[1].replace(",", "."));
  const forms: Record<string, Forms> = { day: ["день", "дня", "дней"], week: ["неделя", "недели", "недель"], month: ["месяц", "месяца", "месяцев"] };
  return `${fmtNum(n)} ${plural(n, forms[m[2].toLowerCase()])}`;
}
export { fmtFactPeriod, fmtFactDate } from "./engine/dates";

const FORMAT_RU: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", onsite: "офис" };

/**
 * Where a posting is, for journal lines: the city (first part of the location, localized) and the work format —
 * «Алматы, офис», «Удалённо — Европа», «Берлин, гибрид». Empty when nothing is known.
 */
export function jobPlaceRu(job: { location?: string | null; remote?: string | null }) {
  const loc = (job.location ?? "").trim();
  const fmt = FORMAT_RU[job.remote ?? ""] ?? "";
  // "Remote — Europe" is one place; "Almaty, Kazakhstan" → the city only.
  const place = placeRu(/\s[—–-]\s/.test(loc) ? loc : loc.split(",")[0].trim());
  if (!place) return fmt ? fmt.charAt(0).toUpperCase() + fmt.slice(1) : "";
  if (!fmt || place.toLowerCase().includes(fmt)) return place;
  return `${place}, ${fmt}`;
}

/** «Vantage Media · BI Analyst (Алматы, офис)» — a role named so that two locations of the same posting never look alike. */
export function roleLabelRu(job: { company: string; title: string; location?: string | null; remote?: string | null }) {
  const where = jobPlaceRu(job);
  return `${job.company} · ${job.title}${where ? ` (${where})` : ""}`;
}
