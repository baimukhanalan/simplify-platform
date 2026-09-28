import { marketRange, percentileIn } from "./market";

export type Aggressiveness = "soft" | "balanced" | "assertive";

export function benchmarkOffer(o: { base: number; roleFamily: string; seniority: string; regions: string[] }) {
  const range = marketRange(o.roleFamily, o.seniority, o.regions);
  const percentile = percentileIn(o.base, range);
  const recommend = percentile < 50;
  return { range, percentile, recommend, gap: Math.max(0, range.mid - o.base) };
}

export function negotiationPlan(o: { company: string; role: string; base: number; currency: string; range: { low: number; mid: number; high: number }; strengths: string[]; name: string; level: Aggressiveness }) {
  const k = o.level === "soft" ? 0.4 : o.level === "balanced" ? 0.65 : 0.9;
  const target = roundK(Math.max(o.base * 1.05, o.base + (o.range.high - o.base) * k));
  const ask = roundK(target * (o.level === "assertive" ? 1.04 : 1.02));
  const walkaway = roundK(Math.max(o.base, o.base + (target - o.base) * 0.35));
  const money = (n: number) => `${o.currency === "USD" ? "$" : ""}${Math.round(n / 1000)}k${o.currency !== "USD" ? ` ${o.currency}` : ""}`;
  const args = [
    `Market data: comparable ${o.role} roles pay ${money(o.range.low)}–${money(o.range.high)}; the offer sits below the midpoint.`,
    ...o.strengths.slice(0, 2).map((s) => `Verified impact: ${s}`),
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
  return { target, ask, walkaway, args, email, callScript, fallback: [`Signing bonus ≈ ${money(Math.max(3000, (target - o.base) * 0.6))}`, "Compensation review after 6 months", "Extra vacation days or learning budget", "Remote flexibility / equipment budget"] };
}

const roundK = (n: number) => Math.round(n / 1000) * 1000;
