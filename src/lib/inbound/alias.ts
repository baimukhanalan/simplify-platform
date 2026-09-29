// Personal forwarding addresses: <alias>@<INBOUND_EMAIL_DOMAIN>. Pure helpers (no DB).
import { randomInt } from "node:crypto";

export const DEFAULT_INBOUND_DOMAIN = "in.simplify.kz";

/** The receiving domain, lowercased (INBOUND_EMAIL_DOMAIN, default in.simplify.kz). */
export const inboundDomain = () => (process.env.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || DEFAULT_INBOUND_DOMAIN).replace(/^@/, "");

export const aliasAddress = (alias: string) => `${alias}@${inboundDomain()}`;

// Russian + Kazakh Cyrillic → Latin (passport-style, simplified for mailbox names).
const TR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};

export function translit(s: string) {
  // Map Cyrillic first (NFKD would split «й» into «и» + breve), then strip Latin diacritics (é → e).
  let out = "";
  for (const ch of s.normalize("NFC").toLowerCase()) out += TR[ch] ?? ch;
  return out.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Readable part of the alias: the first name, transliterated, a–z/0–9 only, ≤ 16 chars. "" → "me". */
export function aliasBase(name: string | null | undefined) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const base = translit(first).replace(/[^a-z0-9]/g, "").slice(0, 16);
  return base.length >= 2 ? base : "me";
}

// Base32 without look-alikes (no 0/1/i/l/o): the random tail reads unambiguously when dictated.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const ALIAS_TAIL = 5;

export function randomTail(n = ALIAS_TAIL) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** e.g. "alan.k7m2q". */
export const makeAlias = (name: string | null | undefined) => `${aliasBase(name)}.${randomTail()}`;

/** Shape of an alias we issue (also what a recipient's local part must look like after +tag/case normalisation). */
export const ALIAS_RE = /^[a-z0-9]{2,16}\.[a-z0-9]{5}$/;

/**
 * The alias a recipient address points at, or null when it is not one of ours: domain must be the inbound domain
 * (any case), the local part is lowercased and a "+tag" suffix is dropped (alan.k7m2q+jobs@… → alan.k7m2q).
 */
export function aliasOf(address: string, domain = inboundDomain()): string | null {
  const a = address.trim().toLowerCase().replace(/^<|>$/g, "");
  const at = a.lastIndexOf("@");
  if (at <= 0) return null;
  if (a.slice(at + 1) !== domain.toLowerCase()) return null;
  const local = a.slice(0, at).split("+")[0].replace(/^"|"$/g, "");
  return ALIAS_RE.test(local) ? local : null;
}

/** Distinct aliases among a letter's recipients, in order. */
export function aliasesOf(recipients: string[], domain = inboundDomain()) {
  const out: string[] = [];
  for (const r of recipients) {
    const a = aliasOf(r, domain);
    if (a && !out.includes(a)) out.push(a);
  }
  return out;
}
