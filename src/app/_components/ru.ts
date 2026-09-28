// Tiny Russian text helpers shared by the UI. Pure: safe on server and client.

type Forms = readonly [one: string, few: string, many: string];

/** Plural form for n: plural(5, ["вакансия", "вакансии", "вакансий"]) → "вакансий". */
export function plural(n: number, forms: Forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Number plus its word: count(3, ["заявка", "заявки", "заявок"]) → "3 заявки". */
export const count = (n: number, forms: Forms) => `${n} ${plural(n, forms)}`;

/**
 * Short date "28 сент." — and a sentence-safe variant that never ends in a double period
 * when the caller puts a full stop after it ("…отправлена 28 сент.").
 */
export function shortDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" });
}

/** Ends a sentence: adds a period unless the text already ends with one. */
export const endSentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
