// Indicative FX to USD (pure; safe for client + server). The market/matching models are in USD,
// so any user-entered amount in another currency is converted before it is compared or stored as USD.
export const TO_USD: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AED: 0.27, KZT: 1 / 500 };

export const fxToUsd = (currency: string | null | undefined) => TO_USD[(currency ?? "USD").toUpperCase()] ?? 1;

/** Convert an amount in `currency` to whole USD (unknown currencies pass through unchanged). */
export const toUSD = (amount: number, currency: string | null | undefined) => (amount ? Math.round(amount * fxToUsd(currency)) : 0);

/** Whole units of `currency` for a USD amount (the inverse of toUSD; unknown currencies pass through unchanged). */
export const fromUSD = (usd: number, currency: string | null | undefined) => (usd ? Math.round(usd / fxToUsd(currency)) : 0);
