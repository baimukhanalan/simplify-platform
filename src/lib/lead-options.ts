// The /apply form's option lists and phone / Telegram normalization — shared by the client form and the server.

export const ENGLISH_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

export const SPECIALIZATIONS = [
  "data_analyst", "product_analyst", "data_scientist",
  "backend", "frontend", "fullstack", "mobile", "qa", "devops",
  "product_manager", "project_manager", "designer",
  "marketing", "sales", "finance", "hr", "support", "operations",
  "other",
] as const;
export type Specialization = (typeof SPECIALIZATIONS)[number];

/**
 * Phone → "+<digits>" (E.164-ish), or null. Kazakhstan-friendly: «8 701 …» and «701 …» (10 digits) become +7…,
 * a «+7» / «7» number must have 11 digits. Anything else needs a country code (+… or 00…), 8–15 digits.
 */
export function normalizePhone(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 32 || /[^\d\s()+\-.]/.test(s) || s.lastIndexOf("+") > 0) return null;
  let d = s.replace(/\D/g, "");
  if (s.startsWith("+")) {
    // as typed
  } else if (d.startsWith("00")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("8")) d = `7${d.slice(1)}`;
  else if (d.length === 10 && /^[79]/.test(d)) d = `7${d}`;
  else if (!(d.length === 11 && d.startsWith("7")) && d.length < 11) return null;
  if (d.startsWith("0") || d.length < 8 || d.length > 15) return null;
  if (d.startsWith("7") && d.length !== 11) return null;
  return `+${d}`;
}

/** Telegram username without «@» (also accepts t.me links); "" → null; malformed → undefined. */
export function normalizeTelegram(raw: string): string | null | undefined {
  const s = raw.trim().replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "").replace(/^@/, "").replace(/\/+$/, "");
  if (!s) return null;
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(s) ? s : undefined;
}


/**
 * As-you-type mask for Kazakhstan / Russia numbers: «+7…» or «8…» → «+7 (701) 123-45-67». Any other start (an
 * international number, or a bare 10-digit «701…») is left as typed, minus characters a phone can't have.
 * `prev` is the previous value: deleting a separator also deletes the digit before it, so backspace never sticks.
 */
export function maskPhone(input: string, prev = ""): string {
  if (!/^\s*(\+7|8)/.test(input)) return input.replace(/[^\d+\s()\-.]/g, "").slice(0, 24);
  let d = input.replace(/\D/g, "");
  if (input.length < prev.length && d === prev.replace(/\D/g, "")) d = d.slice(0, -1);
  if (d.startsWith("8")) d = `7${d.slice(1)}`;
  const r = d.slice(1, 11);
  let out = "+7";
  if (r.length) out += ` (${r.slice(0, 3)}`;
  if (r.length >= 3) out += ")";
  if (r.length > 3) out += ` ${r.slice(3, 6)}`;
  if (r.length > 6) out += `-${r.slice(6, 8)}`;
  if (r.length > 8) out += `-${r.slice(8, 10)}`;
  return out;
}
