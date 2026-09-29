// Plural categories per language (pure). Explicit rules instead of Intl.PluralRules so the product copy never shifts
// with an ICU update and Kazakh follows its grammar, not CLDR.
import type { Locale } from "./config";

export type PluralCategory = "one" | "few" | "many" | "other";

/** Categories a plural message must spell out in each language (checked by tests/i18n.test.ts). */
export const PLURAL_CATEGORIES: Record<Locale, readonly PluralCategory[]> = {
  ru: ["one", "few", "many"],
  kk: ["other"],
  en: ["one", "other"],
};

/**
 * ru: 1, 21, 101 → one; 2–4, 22–24 → few; 0, 5–20, 25… → many; fractions → other (falls back to few: «2,5 года»).
 * kk: a noun after a numeral is never plural («5 вакансия») → always other.
 * en: exactly 1 → one; everything else (0, 2, 1.5) → other.
 */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  const abs = Math.abs(n);
  if (locale === "kk") return "other";
  if (locale === "en") return abs === 1 ? "one" : "other";
  if (!Number.isInteger(abs)) return "other";
  const m10 = abs % 10, m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return "one";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "few";
  return "many";
}

/** Fallback chain when a message lacks the exact category. */
export const PLURAL_FALLBACK: Record<PluralCategory, PluralCategory[]> = {
  one: ["one", "other"],
  few: ["few", "other", "many"],
  many: ["many", "other"],
  other: ["other", "few", "many"],
};
