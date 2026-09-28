import { MOCK_QUESTIONS, detectIntent, scaffold, type FactLite, type StoryLite, type scoreAnswer } from "@/lib/engine/interview";

// Local mock-interview question sets (English: the interview language). The engine ships recruiter /
// hiring_manager / technical; behavioral and final live here.

export const MOCK_SETS: Record<string, string[]> = {
  recruiter: MOCK_QUESTIONS.recruiter,
  hiring_manager: MOCK_QUESTIONS.hiring_manager,
  technical: MOCK_QUESTIONS.technical,
  behavioral: [
    "Tell me about a time you had a conflict with a stakeholder.",
    "Describe a mistake you made and what you learned from it.",
    "Tell me about a time you worked under a tight deadline.",
    "Give me an example of when you took initiative without being asked.",
    "Tell me about a time you had to influence a decision with data.",
  ],
  final: [
    "Why do you want to join our company, and why now?",
    "What kind of team culture brings out your best work?",
    "Where do you see yourself in three years?",
    "Tell me about the achievement you are most proud of.",
    "What questions do you have for us?",
  ],
};

export type MockCtx = { stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; currentTitle?: string; salary?: { low: number; high: number; source?: "floor" | "published" | "market" | "none" } };
type Score = ReturnType<typeof scoreAnswer>;

/** What the answer lacks, in plain words — beyond the engine's generic tips. */
export function missingPoints(question: string, answer: string, s: Score, ctx: MockCtx): string[] {
  const intent = detectIntent(question);
  const out: string[] = [];
  const low = answer.toLowerCase();
  if (intent === "behavioral" || intent === "leadership") {
    const names = { s: "контекст: где и когда", t: "твоя задача", a: "твои конкретные действия", r: "результат" } as const;
    (Object.keys(names) as (keyof typeof names)[]).forEach((k) => !s.star[k] && out.push(names[k]));
    if (!/(learn|lesson|next time|вывод|научил|понял)/i.test(answer)) out.push("чему это научило");
  }
  if (!/\d/.test(answer)) out.push("цифра результата (было → стало)");
  if ((intent === "motivation" || /why .*compan/i.test(question)) && !low.includes(ctx.company.toLowerCase())) out.push(`конкретика о ${ctx.company}`);
  if (intent === "intro" && !/(now|currently|сейчас)/i.test(answer)) out.push("кто ты сейчас");
  if (intent === "technical" && !/(first|then|step|сначала|затем)/i.test(answer)) out.push("пошаговый подход");
  if (intent === "closing" && !answer.includes("?")) out.push("1–2 твоих вопроса");
  return [...new Set(out)].slice(0, 4);
}

/** Interviewer personas in Russian (the lib labels are English). */
export const PERSONA_RU: Record<string, string> = {
  recruiter: "Рекрутер",
  hiring_manager: "Нанимающий менеджер",
  technical: "Техническое",
  behavioral: "Поведенческое",
  final: "Финальный раунд",
};
export const personaRu = (k: string) => PERSONA_RU[k] ?? k;

/** A stronger skeleton built from the candidate's own stories and facts. */
export function suggestion(question: string, ctx: MockCtx) {
  const sc = scaffold(question, ctx);
  // Only show a number that belongs to the suggested story (scaffold falls back to any fact's metric).
  const story = sc.storyId ? ctx.stories.find((x) => x.id === sc.storyId) : null;
  const usesStory = story && sc.bullets.some((b) => b.startsWith("S:") || b.includes(story.title.slice(0, 20)));
  return { opener: sc.opener, bullets: sc.bullets.slice(0, 4), keyNumber: usesStory ? story.metric : sc.keyNumber, strategy: sc.strategy };
}
