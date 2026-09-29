import type { Offer } from "@prisma/client";
import { j } from "@/lib/db";
import { fmtMoney } from "@/lib/engine/taxonomy";

/** "$72k" for USD, compact currency for everything else ("KZT 25M"). Employer-facing English text only — the UI uses fmtMoney. */
export function kMoney(n: number, currency: string) {
  if (currency === "USD") {
    const abs = Math.abs(n);
    return `${n < 0 ? "−" : ""}$${abs >= 1000 ? `${Math.round(abs / 1000)}k` : abs}`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(n);
}


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
  const years = t.match(/(\d+)\s*(?:years?|yrs?|y\b|года|год|лет)/i);
  const perYear = /\/\s*(?:yr|year|год)|per year|в год|annual/i.test(t);
  if (years && !perYear) v = v / Math.max(1, Number(years[1]));
  return v >= 100 ? Math.round(v) : null;
}

export function compBreakdown(o: Offer) {
  const base = o.finalBase ?? o.base;
  const equityYear = parseEquity(o.equity);
  const total = base + o.bonus + o.signingBonus + (equityYear ?? 0);
  const bonusPct = base ? Math.round((o.bonus / base) * 100) : 0;
  const benefits = j<string[]>(o.benefits, []);
  const money = (n: number) => fmtMoney(n, o.currency);
  return { base, equityYear, total, bonusPct, benefits, money };
}
