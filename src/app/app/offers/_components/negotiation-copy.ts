import type { Aggressiveness } from "@/lib/engine/offer";
import { achievementGerund, achievementSentence, lcFirstWord, tidyAchievement } from "@/lib/engine/personalize";

/**
 * Employer-facing negotiation copy (English). Built only from the user's own verified CV results:
 * each result is rephrased so it reads naturally inside a sentence, never spliced in verbatim.
 */
export function strengthPhrase(strength: string | undefined): string {
  if (!strength) return "Given the scope we discussed and the market for this role,";
  const g = achievementGerund(strength);
  return g
    ? `Given my experience ${g} and the scope we discussed,`
    : `Given my track record (${lcFirstWord(tidyAchievement(strength))}) and the scope we discussed,`;
}

const ASK: Record<Aggressiveness, (ask: string) => string> = {
  soft: (a) => `I was wondering whether there is room to move the base closer to ${a}.`,
  balanced: (a) => `I was hoping we could explore a base closer to ${a}.`,
  assertive: (a) => `I'd like to ask for a base of ${a}.`,
};

/** Where the ceiling comes from: the market, or the vacancy's posted range (higher than the market top). */
type Reference = { low: string; high: string; posted?: string | null };

const PACKAGE_ASK: Record<Aggressiveness, (signing: string) => string> = {
  soft: (b) => `I was wondering whether there is room on the rest of the package — for example a signing bonus of around ${b} or an earlier compensation review.`,
  balanced: (b) => `I was hoping we could look at the rest of the package: a signing bonus of around ${b}, a compensation review after six months, or additional learning budget.`,
  assertive: (b) => `I'd like to ask for a signing bonus of ${b} and a compensation review after six months.`,
};

/**
 * `mode: "no_push"` — the offer is already at or above every ceiling: the base is accepted as is and the email asks for
 * the rest of the package; it never "asks" for the offered base or cites a market range below the offer.
 */
export function negotiationEmail(o: { role: string; company: string; name: string; level: Aggressiveness; ask: string; strengths: string[]; mode?: "base" | "no_push"; signing?: string } & Reference) {
  const middle = o.mode === "no_push"
    ? `The base works for me. ${PACKAGE_ASK[o.level](o.signing ?? "")}`
    : `${strengthPhrase(o.strengths[0])} ${ASK[o.level](o.ask)} ${o.posted ? `That is within the range published for this role (up to ${o.posted}).` : `Market data for comparable roles puts the range at ${o.low}–${o.high}.`}`;
  return [
    "Hi,",
    `Thank you so much for the offer for the ${o.role} position — I'm genuinely excited about joining ${o.company}.`,
    middle,
    o.mode === "no_push" ? null : "If base flexibility is limited, I'd be glad to discuss a signing bonus or an earlier compensation review.",
    "Looking forward to finding something that works for both of us.",
    `Best regards,\n${o.name}`,
  ].filter(Boolean).join("\n\n");
}

/** Talking points = what to say (English): the market argument plus the user's own results as clean sentences. */
export function talkingPoints(o: { role: string; low: string; high: string; strengths: string[]; position?: "below" | "upper" | "top"; posted?: string | null; mode?: "base" | "no_push" }): string[] {
  const where = o.position === "top" ? "and this offer is already at the top of that range" : o.position === "upper" ? "and this offer sits in the upper half of that range" : "and this offer sits below the midpoint";
  const lead = o.mode === "no_push"
    ? `The offer is already competitive for comparable ${o.role} roles — the conversation is about the rest of the package, not the base.`
    : o.posted
      ? `The range published for this ${o.role} role goes up to ${o.posted}, so there is room within the approved budget.`
      : `Comparable ${o.role} roles pay ${o.low}–${o.high}, ${where}.`;
  return [lead, ...o.strengths.slice(0, 2).map(achievementSentence)];
}

/** Call script: Russian coaching, with the exact English phrase to say quoted. */
export function callScript(o: { ask: string; walkaway: string; mode?: "base" | "no_push"; signing?: string }): string[] {
  if (o.mode === "no_push") {
    return [
      "Начни с благодарности и интереса к команде и задаче.",
      `Скажи, что оклад устраивает, и назови, что обсудить: “The base works for me — could we look at a signing bonus of around ${o.signing} or a compensation review after six months?”`,
      "Пауза. Дай им ответить первыми — не заполняй тишину.",
      "Если бонус невозможен: спроси о дополнительных днях отпуска, бюджете на обучение или на оборудование.",
      "Финал: договорись о следующих шагах и попроси обновлённый оффер письменно.",
    ];
  }
  return [
    "Начни с благодарности и интереса к команде и задаче.",
    `Назови цифру: “Based on the scope and market data, I was hoping for a base closer to ${o.ask}.”`,
    "Пауза. Дай им ответить первыми — не заполняй тишину.",
    "Если возражают: спроси, где есть гибкость — оклад, бонус за подписание или пересмотр через 6 месяцев.",
    `Нижняя граница: не соглашайся ниже ${o.walkaway} без компенсации в другом виде.`,
    "Финал: договорись о следующих шагах и попроси обновлённый оффер письменно.",
  ];
}

/** Levers when the base salary doesn't move (Russian chips). */
export function fallbackLevers(signing: string): string[] {
  return [`Бонус за подписание ≈ ${signing}`, "Пересмотр компенсации через 6 месяцев", "Дополнительные дни отпуска или бюджет на обучение", "Гибкая удалёнка или бюджет на оборудование"];
}
