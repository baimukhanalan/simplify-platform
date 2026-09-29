// Indicative FX to USD (pure; safe for client + server). The market/matching models are in USD,
// so any user-entered amount in another currency is converted before it is compared or stored as USD.
export const TO_USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AED: 0.27, KZT: 1 / 500 };

export const fxToUsd = (currency: string | null | undefined) => TO_USD[(currency ?? "USD").toUpperCase()] ?? 1;

/** Convert an amount in `currency` to whole USD (unknown currencies pass through unchanged). */
export const toUSD = (amount: number, currency: string | null | undefined) => (amount ? Math.round(amount * fxToUsd(currency)) : 0);

/** Whole units of `currency` for a USD amount (the inverse of toUSD; unknown currencies pass through unchanged). */
export const fromUSD = (usd: number, currency: string | null | undefined) => (usd ? Math.round(usd / fxToUsd(currency)) : 0);

/**
 * A USD model amount (e.g. the market median) as a goal amount in the goal's own currency, rounded to a clean figure
 * (₸ to 10 000, others to 1 000). Goal.minSalary is stored in Goal.currency — never write a USD number next to "KZT".
 */
export function usdToGoalAmount(usd: number, currency: string | null | undefined) {
  const v = fromUSD(usd, currency);
  const step = (currency ?? "USD").toUpperCase() === "KZT" ? 10000 : 1000;
  return v ? Math.max(step, Math.round(v / step) * step) : 0;
}
