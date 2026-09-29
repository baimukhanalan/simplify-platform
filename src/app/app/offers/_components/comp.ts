import type { Offer } from "@prisma/client";
import { j } from "@/lib/db";
import { fmtMoney } from "@/lib/engine/taxonomy";
import type { T } from "@/lib/i18n/translator";

/**
 * A money amount in employer-facing English text, written out in full in the offer's own currency — «$22,000»,
 * «€48,000», «KZT 9,600,000». No «k» shorthand: the talking points, the email and the call script quote the same
 * figures the rest of the Offer Desk shows (fmtMoney), just in English number format.
 */
export function employerMoney(n: number, currency: string) {
  const code = (currency || "USD").toUpperCase();
  const v = Math.round(Math.abs(Number.isFinite(n) ? n : 0));
  const digits = v.toLocaleString("en-US");
  const sign = n < 0 && v ? "−" : "";
  const prefix = EMPLOYER_PREFIX[code];
  return prefix ? `${sign}${prefix}${digits}` : `${sign}${code} ${digits}`;
}
const EMPLOYER_PREFIX: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };


/**
 * Equity is free text ("0.05%, 4 года", "$20k RSU over 4 years", "10000").
 * Returns an annual amount in the offer currency only when the text is an unambiguous money value;
 * percentages, options counts etc. stay text.
 */
export function parseEquity(text: string): number | null {
  const t = text.trim();
  if (!t || /%/.test(t) || /option|опцион|shares?|акци/i.test(t)) return null;
  const m = t.match(/^(?:[$€£₸]|usd|eur|gbp|kzt)?\s*([\d][\d\s,.]*)\s*(k|к|m|м)?\b/i);
  if (!m) return null;
  let v = Number(m[1].replace(/[\s,]/g, ""));
  if (!Number.isFinite(v) || v <= 0) return null;
  const mult = m[2]?.toLowerCase();
  if (mult === "k" || mult === "к") v *= 1000;
  if (mult === "m" || mult === "м") v *= 1_000_000;
  const years = t.match(/(\d+)\s*(?:years?|yrs?|y\b|года|год|лет|жыл)/i);
  const perYear = /\/\s*(?:yr|year|год)|per year|в год|жылына|annual/i.test(t);
  if (years && !perYear) v = v / Math.max(1, Number(years[1]));
  return v >= 100 ? Math.round(v) : null;
}

const SYMBOL_CODE: Record<string, string> = { $: "USD", "€": "EUR", "£": "GBP", "₸": "KZT" };

/** Money inside our own perk strings in the UI's style: "Learning budget $1,000" → «Learning budget $1 000». */
export function moneyInText(text: string) {
  return text
    .replace(/([$€£₸])\s?(\d{1,3}(?:[,\s\u202f\u00a0]\d{3})+|\d{4,})(?![\d.,]*\d)/g, (_, sym: string, num: string) => fmtMoney(Number(num.replace(/\D/g, "")), SYMBOL_CODE[sym]))
    .replace(/\b(\d{1,3}(?:,\d{3})+|\d{4,})\s?(USD|EUR|GBP|KZT)\b/g, (_, num: string, code: string) => fmtMoney(Number(num.replace(/\D/g, "")), code));
}

/**
 * Benefit names the engine and employers write in English → Russian for the UI. Exact names first, then a phrase map for
 * variants («Learning budget of €1,500 a year»); anything unknown (a user-typed perk) stays as written.
 */
const BENEFITS: [RegExp, string, string][] = [
  [/^private\s+health\s+insurance$/i, "Частная медицинская страховка", "Жеке медициналық сақтандыру"],
  [/^(?:health|medical)\s+insurance$/i, "Медицинская страховка", "Медициналық сақтандыру"],
  [/^private\s+medical\s+insurance$/i, "Частная медицинская страховка", "Жеке медициналық сақтандыру"],
  [/^medical,\s*dental\s+and\s+vision(?:\s+coverage)?$/i, "Медицинская, стоматологическая и офтальмологическая страховка", "Медициналық, стоматологиялық және офтальмологиялық сақтандыру"],
  [/^health\s+and\s+pension\s+plan$/i, "Медицинская страховка и пенсионный план", "Медициналық сақтандыру және зейнетақы жоспары"],
  [/^official\s+employment\s+and\s+health\s+insurance$/i, "Официальное трудоустройство и медицинская страховка", "Ресми жұмысқа орналасу және медициналық сақтандыру"],
  [/^learning\s+budget$/i, "Бюджет на обучение", "Оқуға бюджет"],
  [/^learning\s+budget\s+(?:of\s+)?(.+?)(?:\s+a\s+year)?$/i, "Бюджет на обучение $1 в год", "Оқуға жылына $1 бюджет"],
  [/^home-office\s+stipend$/i, "Компенсация домашнего офиса", "Үй кеңсесіне өтемақы"],
  [/^home-office\s+setup\s+budget$/i, "Бюджет на оборудование домашнего офиса", "Үй кеңсесін жабдықтауға бюджет"],
  [/^home-office\s+and\s+internet\s+stipend$/i, "Компенсация домашнего офиса и интернета", "Үй кеңсесі мен интернетке өтемақы"],
  [/^401\(k\)\s+(?:match|with\s+company\s+match)$/i, "Пенсионный план 401(k) с доплатой работодателя", "Жұмыс беруші қосымша төлейтін 401(k) зейнетақы жоспары"],
  [/^pension\s+matching\s+up\s+to\s+(\d+%)$/i, "Доплата к пенсионным взносам до $1", "Зейнетақы жарналарына $1 дейін қосымша төлем"],
  [/^equity(?:\s+for\s+every\s+employee)?$/i, "Акции компании", "Компания акциялары"],
  [/^annual\s+bonus\s+up\s+to\s+(\d+)\s+salar(?:y|ies)$/i, "Годовой бонус до $1 окладов", "Жылдық бонус — $1 жалақыға дейін"],
  [/^relocation\s+support(?:\s+for\s+you\s+and\s+your\s+family)?$/i, "Помощь с релокацией", "Релокацияға көмек"],
  [/^flexible\s+hours$/i, "Гибкий график", "Икемді кесте"],
  [/^fully\s+flexible\s+hours$/i, "Полностью гибкий график", "Толық икемді кесте"],
  [/^flexible\s+pto$/i, "Гибкий отпуск", "Икемді демалыс"],
  [/^paid\s+language\s+courses$/i, "Оплачиваемые языковые курсы", "Ақылы тіл курстары"],
  [/^annual\s+team\s+retreat$/i, "Ежегодный выезд команды", "Команданың жыл сайынғы сапары"],
  [/^cycle-to-work\s+scheme$/i, "Компенсация велосипеда для поездок на работу", "Жұмысқа велосипедпен қатынауға өтемақы"],
  [/^(\d+)\s+days\s+of\s+paid\s+vacation$/i, "$1 дней оплачиваемого отпуска", "$1 күн ақылы демалыс"],
  [/^paid\s+time\s+off:\s*(\d+)\s+days\s+a\s+year$/i, "$1 дней оплачиваемого отпуска в год", "Жылына $1 күн ақылы демалыс"],
  [/^(\d+)\s+days\s+of\s+holiday\s+plus\s+bank\s+holidays$/i, "$1 дней отпуска плюс государственные праздники", "$1 күн демалыс және мемлекеттік мерекелер"],
  [/^gym\s+membership$/i, "Абонемент в спортзал", "Спортзалға абонемент"],
  [/^stock\s+options$/i, "Опционы", "Опциондар"],
];
export function benefitRu(text: string) {
  const t = text.trim();
  for (const [re, ru] of BENEFITS) if (re.test(t)) return t.replace(re, ru);
  return t;
}

/** A benefit in the UI language: ru/kk from the map above (unknown perks stay as written), en = the original text. */
export function benefitLabel(text: string, locale: T["locale"]) {
  const t = text.trim();
  if (locale === "en") return t;
  if (locale === "ru") return moneyInText(benefitRu(t));
  for (const [re, , kk] of BENEFITS) if (re.test(t)) return moneyInText(t.replace(re, kk));
  return moneyInText(t);
}

/** With `t`, money and benefits follow the UI language; without it, the Russian formatting (fmtMoney, benefitRu). */
export function compBreakdown(o: Offer, t?: T) {
  const base = o.finalBase ?? o.base;
  const equityYear = parseEquity(o.equity);
  const total = base + o.bonus + o.signingBonus + (equityYear ?? 0);
  const bonusPct = base ? Math.round((o.bonus / base) * 100) : 0;
  const benefits = j<string[]>(o.benefits, []).map((b) => (t ? benefitLabel(b, t.locale) : moneyInText(benefitRu(b))));
  const money = (n: number) => (t ? t.money(n, o.currency) : fmtMoney(n, o.currency));
  return { base, equityYear, total, bonusPct, benefits, money };
}
