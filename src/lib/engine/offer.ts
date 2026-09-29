import { marketRange, percentileIn } from "./market";
import { fromUSD, toUSD } from "./fx";
import { fmtMoney } from "./taxonomy";

export type Aggressiveness = "soft" | "balanced" | "assertive";

export function benchmarkOffer(o: { base: number; roleFamily: string; seniority: string; regions: string[] }) {
  const range = marketRange(o.roleFamily, o.seniority, o.regions);
  const percentile = percentileIn(o.base, range);
  const recommend = percentile < 50;
  // `basis`: the level and regions this median is read for (Career's Market Value exposes the same as marketBasis).
  return { range, percentile, recommend, gap: Math.max(0, range.mid - o.base), basis: { level: o.seniority, regions: o.regions.length ? o.regions : ["WORLD"] } };
}

/** The user's goal minimum (Goal.minSalary in Goal.currency) converted into the offer's currency; 0 = not set. */
export const minimumInOfferCurrency = (minimum: { amount: number; currency: string } | null | undefined, offerCurrency: string) =>
  minimum?.amount ? fromUSD(toUSD(minimum.amount, minimum.currency), offerCurrency) : 0;

/**
 * Negotiation plan for one style. With the user's goal `minimum`: the walk-away floor never sits below it (converted
 * into the offer currency), nor do target and ask; `belowMinimum` + `minimumLine` («Оффер ниже твоего минимума ($60 000)»)
 * say when the offer itself is under it. `upside` = [target − base, ask − base] — the range shown always reaches the ask.
 */
export function negotiationPlan(o: { company: string; role: string; base: number; currency: string; range: { low: number; mid: number; high: number }; strengths: string[]; name: string; level: Aggressiveness; minimum?: { amount: number; currency: string } | null }) {
  const k = o.level === "soft" ? 0.4 : o.level === "balanced" ? 0.65 : 0.9;
  const minimum = minimumInOfferCurrency(o.minimum, o.currency);
  const belowMinimum = minimum > 0 && o.base < minimum;
  const minimumLine = belowMinimum && o.minimum ? `Оффер ниже твоего минимума (${fmtMoney(o.minimum.amount, o.minimum.currency)})` : null;
  // Never ask above the market's top (range.high ≈ p85): an ask past it reads as uninformed, not assertive. An offer that
  // is already at or above the top is not pushed further (cap = the offer itself). The user's own minimum overrides the cap.
  const cap = Math.max(o.range.high, Math.ceil(o.base / 1000) * 1000);
  const target0 = Math.min(cap, roundK(Math.max(o.base * 1.05, o.base + (o.range.high - o.base) * k)));
  const walkaway = Math.max(minimum, Math.min(target0, roundK(Math.max(o.base, o.base + (target0 - o.base) * 0.35))));
  const target = Math.max(target0, walkaway);
  const ask = Math.max(target, walkaway, Math.min(cap, roundK(target0 * (o.level === "assertive" ? 1.04 : 1.02))));
  const upside = { low: Math.max(0, target - o.base), high: Math.max(0, ask - o.base) };
  const position = o.base < o.range.mid ? "the offer sits below the midpoint" : o.base < o.range.high ? "the offer sits in the upper half of that range" : "the offer is already at the top of that range";
  const money = (n: number) => `${o.currency === "USD" ? "$" : ""}${Math.round(n / 1000)}k${o.currency !== "USD" ? ` ${o.currency}` : ""}`;
  const args = [
    `Market data: comparable ${o.role} roles pay ${money(o.range.low)}–${money(o.range.high)}; ${position}.`,
    ...o.strengths.slice(0, 2).map((s) => `Impact: ${s}`),
    "Enthusiasm first — make it clear you want to join; negotiation is about fit, not leverage.",
  ];
  const email = `Hi,\n\nThank you so much for the offer for the ${o.role} position — I'm genuinely excited about joining ${o.company}.\n\nBased on my experience with ${o.strengths[0] ?? "the core of this role"} and the scope we discussed, I was hoping we could explore a base closer to ${money(ask)}. Market data for comparable roles puts the range at ${money(o.range.low)}–${money(o.range.high)}.\n\nIf base flexibility is limited, I'd be glad to discuss a signing bonus or an earlier compensation review.\n\nLooking forward to finding something that works for both of us.\n\nBest regards,\n${o.name}`;
  const callScript = [
    "Open: thank them, restate excitement about the team and the problem.",
    `Anchor: "Based on the scope and market data, I was hoping for a base closer to ${money(ask)}."`,
    "Pause. Let them respond first — don't fill the silence.",
    `If they push back: ask what flexibility exists on base, signing bonus, or a 6-month review.`,
    `Floor: don't go below ${money(walkaway)} without a compensating component.`,
    "Close: confirm next steps and ask for the revised offer in writing.",
  ];
  return { target, ask, walkaway, upside, belowMinimum, minimum, minimumLine, capped: ask >= cap && cap === o.range.high, args, email, callScript, fallback: [`Бонус за выход (signing bonus) ≈ ${money(Math.max(3000, (target - o.base) * 0.6))}`, "Пересмотр компенсации через 6 месяцев", "Дополнительные дни отпуска или бюджет на обучение", "Гибкость по удалённой работе или бюджет на оборудование"] };
}

const roundK = (n: number) => Math.round(n / 1000) * 1000;

/**
 * «Можно добавить» across the styles: from the Soft target to the Assertive (Aggressive) ask, over the base — the range
 * always includes the most assertive number the plan suggests saying.
 */
export function negotiationUpside(plans: Record<Aggressiveness, { target: number; ask: number }>, base: number) {
  const low = Math.max(0, Math.min(...Object.values(plans).map((p) => p.target)) - base);
  const high = Math.max(0, Math.max(...Object.values(plans).map((p) => Math.max(p.ask, p.target))) - base);
  return { low: Math.min(low, high), high };
}
