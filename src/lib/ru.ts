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
