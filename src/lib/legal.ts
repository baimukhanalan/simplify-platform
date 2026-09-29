// Legal documents: one place for versions, edition dates, company requisites and the product terms the documents quote.
// Pure module (no server imports) — safe in server components, client components and server actions.
//
// Requisites are placeholders in square brackets («[БИН]»). The legal pages render any «[…]» as a highlighted mark so
// the owner can find and replace them here; readers see them as ordinary text.
//
// Bumping a document's `version` makes the in-app acceptance banner appear again for everyone whose stored acceptance
// is older (see needsLegalAcceptance). Change `version` only when the content changes materially.

/** One support address for every legal page, the reset page and refund requests. */
export const SUPPORT_EMAIL = "support@wesimplify.works";

export type LegalDocKey = "offer" | "terms" | "privacy" | "consent" | "refund";

export type LegalDoc = { key: LegalDocKey; href: `/${string}`; title: string; short: string; version: string; edition: string };

export const LEGAL_DOCS: Record<LegalDocKey, LegalDoc> = {
  offer: { key: "offer", href: "/offer", title: "Публичная оферта", short: "Оферта", version: "2026-09-29", edition: "29.09.2026" },
  terms: { key: "terms", href: "/terms", title: "Пользовательское соглашение", short: "Соглашение", version: "2026-09-29", edition: "29.09.2026" },
  privacy: { key: "privacy", href: "/privacy", title: "Политика конфиденциальности", short: "Конфиденциальность", version: "2026-09-29", edition: "29.09.2026" },
  consent: { key: "consent", href: "/consent", title: "Согласие на обработку персональных данных", short: "Согласие на обработку ПД", version: "2026-09-29", edition: "29.09.2026" },
  refund: { key: "refund", href: "/refund", title: "Политика возврата", short: "Возврат", version: "2026-09-29", edition: "29.09.2026" },
};

/** Footer / cross-link order. */
export const LEGAL_ORDER: LegalDocKey[] = ["offer", "terms", "privacy", "consent", "refund"];

/** Company requisites. Placeholders until the owner fills them in. */
export const COMPANY = {
  brand: "Simplify",
  name: "[наименование ИП / ТОО]",
  head: "[ФИО руководителя]",
  bin: "[БИН]",
  address: "[юридический адрес]",
  postAddress: "[почтовый адрес]",
  bank: "[наименование банка]",
  iik: "[ИИК]",
  bik: "[БИК]",
  kbe: "[КБе]",
  phone: "[телефон]",
  email: SUPPORT_EMAIL,
  site: "[адрес сайта]",
  city: "г. Алматы",
  /** Where the personal-data database is hosted (Закон РК о ПД, ст. 12-2). */
  dataLocation: "[место хранения базы персональных данных — сервер на территории Республики Казахстан]",
} as const;

/** Product terms quoted by the offer. The campaign / referral / guarantee code must match these numbers. */
export const OFFER_TERMS = {
  /** No interview invitation during the campaign → one free extension of this many days per campaign. */
  guaranteeExtensionDays: 30,
  /** Invited friend's discount on their first campaign, percent. */
  referralDiscountPct: 10,
  /** Days added to the inviter's active (or next) campaign after the friend's first payment. */
  referralBonusDays: 15,
  /** Unused campaign refund window, calendar days from payment. */
  refundWindowDays: 14,
  /** Kaspi refund processing, working days. */
  refundProcessingWorkingDays: 10,
  /** Invoice lifetime, minutes (src/lib/payments/kaspi.ts INVOICE_TTL_MS). */
  invoiceTtlMinutes: 30,
} as const;

/** Versions the user accepts at signup (or via the in-app banner). */
export const SIGNUP_DOCS = ["terms", "privacy", "consent"] as const satisfies readonly LegalDocKey[];

export type LegalAcceptance = { terms: string; privacy: string; consent: string; at: string };

/** The `legal` object stored in User.consents on acceptance. */
export function legalAcceptance(now = new Date()): LegalAcceptance {
  return { terms: LEGAL_DOCS.terms.version, privacy: LEGAL_DOCS.privacy.version, consent: LEGAL_DOCS.consent.version, at: now.toISOString() };
}

/** Offer acceptance recorded in Payment.meta when an invoice is created. */
export function offerAcceptance(now = new Date()) {
  return { version: LEGAL_DOCS.offer.version, at: now.toISOString() };
}

/** True when the stored consents lack an acceptance of the current terms / privacy / consent versions. */
export function needsLegalAcceptance(consents: unknown): boolean {
  const legal = consents && typeof consents === "object" ? (consents as { legal?: unknown }).legal : undefined;
  if (!legal || typeof legal !== "object") return true;
  const l = legal as Record<string, unknown>;
  return SIGNUP_DOCS.some((k) => l[k] !== LEGAL_DOCS[k].version);
}

/** Merges an acceptance into a stored consents JSON string without dropping other keys. Malformed input → a fresh object. */
export function mergeLegalConsents(raw: string | null | undefined, now = new Date()): string {
  let prev: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prev = parsed as Record<string, unknown>;
  } catch {
    /* malformed → start over, keeping nothing unreadable */
  }
  return JSON.stringify({ ...prev, legal: legalAcceptance(now) });
}

/** A paragraph (string) or a bulleted list (string[]). Strings use the inline markup of `Rich` (legal-page.tsx):
 *  [[/href|text]] is a link, [text] is a highlighted placeholder. */
export type LegalBlock = string | string[];
export type LegalSection = { h: string; p: LegalBlock[] };
export type LegalContent = { lead?: string; sections: LegalSection[] };

/** Requisites block used at the end of the offer and the other documents. */
export function requisites(): string[] {
  return [
    `Исполнитель: ${COMPANY.name}`,
    `БИН: ${COMPANY.bin}`,
    `Юридический адрес: ${COMPANY.address}`,
    `Банк: ${COMPANY.bank}, ИИК: ${COMPANY.iik}, БИК: ${COMPANY.bik}, КБе: ${COMPANY.kbe}`,
    `Телефон: ${COMPANY.phone}`,
    `Электронная почта: [[mailto:${SUPPORT_EMAIL}|${SUPPORT_EMAIL}]]`,
  ];
}
