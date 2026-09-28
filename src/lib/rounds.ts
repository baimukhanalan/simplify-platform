// Interview round chain (pure; safe for client + server). Owned by the Interview layer.

export const ROUND_CHAIN = ["recruiter", "hiring_manager", "technical", "final"] as const;
export const ROUNDS = ["assessment", ...ROUND_CHAIN] as const;
export type Round = (typeof ROUNDS)[number];

export const ROUND_LABEL: Record<string, string> = {
  assessment: "Assessment",
  recruiter: "Recruiter",
  hiring_manager: "Hiring Manager",
  technical: "Technical",
  final: "Final",
};

export const ROUND_TONE: Record<string, "amber" | "teal" | "green" | "dark" | "neutral"> = {
  assessment: "amber",
  recruiter: "teal",
  hiring_manager: "teal",
  technical: "neutral",
  final: "dark",
};

export const IV_STATUS_LABEL: Record<string, string> = { upcoming: "Предстоит", done: "Ждём ответа", passed: "Пройден", failed: "Не пройден" };
export const IV_STATUS_TONE: Record<string, "green" | "rose" | "amber" | "neutral"> = { upcoming: "neutral", done: "amber", passed: "green", failed: "rose" };

/** Next step after a passed round. `null` after Final → the offer stage. Assessment feeds the recruiter screen. */
export function nextRound(round: string): Round | null {
  if (round === "assessment") return "recruiter";
  const i = ROUND_CHAIN.indexOf(round as (typeof ROUND_CHAIN)[number]);
  return i >= 0 && i < ROUND_CHAIN.length - 1 ? ROUND_CHAIN[i + 1] : null;
}

// Opportunity pipeline order — used to move status forward only.
const OPP_ORDER = ["found", "qualified", "prepared", "submitted", "pending", "assessment", "recruiter", "hiring_manager", "technical", "final", "offer", "hired"];
export const isAhead = (next: string, current: string) => OPP_ORDER.indexOf(next) > OPP_ORDER.indexOf(current);

export const PERSONAS = [
  { key: "recruiter", label: "Recruiter", sub: "мотивация, ожидания, логистика" },
  { key: "hiring_manager", label: "Hiring Manager", sub: "глубина проектов, STAR, приоритеты" },
  { key: "technical", label: "Technical", sub: "SQL, эксперименты, разбор кейсов" },
] as const;
