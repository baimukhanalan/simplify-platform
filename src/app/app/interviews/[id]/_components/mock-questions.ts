import { MOCK_QUESTIONS, STRUCTURE_CUE_RU, STRUCTURE_OK, detectIntent, jdSkillsYouHave, scaffold, type FactLite, type StoryLite, type scoreAnswer } from "@/lib/engine/interview";

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

export type MockCtx = {
  stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; currentTitle?: string;
  salary?: { low: number; high: number; source?: "floor" | "published" | "market" | "none" };
  /** The vacancy's technologies / key terms (the room's jdTerms): «как сказать сильнее» names the ones the user has. */
  jdTerms?: string[];
};
type Score = ReturnType<typeof scoreAnswer>;

/**
 * "Who you are now" in an intro: "I'm a data analyst", "I am…", "currently…", "right now", "at Kaspi", "работаю…", "сейчас…".
 * "at X" needs a capitalised name after it ("at Kaspi", not "at the end").
 */
const WHO_NOW_WORDS = /(?<![\p{L}])(?:i['’]m|i am|currently|right now|now i|these days|сейчас|работаю|я\s+—|я\s+-)(?![\p{L}])/iu;
const AT_COMPANY = /(?<![\p{L}])at\s+\p{Lu}/u; // case-sensitive on purpose: "at Kaspi", not "at the end"
const WHO_NOW = { test: (a: string) => WHO_NOW_WORDS.test(a) || AT_COMPANY.test(a) };

/**
 * What the answer lacks, in plain words — beyond the engine's generic tips. Empty (→ «Все ключевые элементы на месте»)
 * only when the structure is really complete: a full STAR (+ the lesson) for behavioral questions, structure ≥ STRUCTURE_OK
 * otherwise; each missing structure cue is named.
 */
export function missingPoints(question: string, answer: string, s: Score, ctx: MockCtx): string[] {
  const intent = detectIntent(question);
  const out: string[] = [];
  const low = answer.toLowerCase();
  const star = intent === "behavioral" || intent === "leadership";
  if (star) {
    const names = { s: "контекст: где и когда", t: "твоя задача", a: "твои конкретные действия", r: "результат" } as const;
    (Object.keys(names) as (keyof typeof names)[]).forEach((k) => !s.star[k] && out.push(names[k]));
    if (!/(learn|lesson|next time|вывод|научил|понял)/i.test(answer)) out.push("чему это научило");
  }
  // Missing structure cues come after the content points (those are more specific to the question).
  const structure = !star && s.structure < STRUCTURE_OK ? (Object.keys(STRUCTURE_CUE_RU) as (keyof typeof STRUCTURE_CUE_RU)[]).filter((k) => !s.cues[k] && !(k === "order" && intent === "technical")).map((k) => STRUCTURE_CUE_RU[k]) : [];
  if (!/\d/.test(answer)) out.push("цифра результата (было → стало)");
  if ((intent === "motivation" || /why .*compan/i.test(question)) && !low.includes(ctx.company.toLowerCase())) out.push(`конкретика о ${ctx.company}`);
  if (intent === "intro" && !WHO_NOW.test(answer)) out.push("кто ты сейчас");
  if (intent === "technical" && !/(first|then|step|сначала|затем)/i.test(answer)) out.push("пошаговый подход");
  if (intent === "closing" && !answer.includes("?")) out.push("1–2 твоих вопроса");
  const list = [...new Set([...out, ...structure])];
  // Never an empty list (= «все элементы на месте») while the structure is still weak.
  if (!list.length && s.structure < STRUCTURE_OK) list.push("чёткая структура: вступление → пример → вывод");
  return list.slice(0, 4);
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

/** Intents where naming the role's core skills makes the answer stronger (not salary / closing / weakness). */
const SKILL_INTENTS = new Set(["intro", "motivation", "experience", "behavioral", "leadership", "technical", "case", "strengths"]);

/**
 * A stronger skeleton built from the candidate's own stories and facts. It always names the vacancy's core skills the
 * user has (jdSkillsYouHave: e.g. Power BI and SQL for a BI Analyst) — never a skill the JD does not list.
 */
export function suggestion(question: string, ctx: MockCtx, jdTerms: string[] = ctx.jdTerms ?? []) {
  const sc = scaffold(question, ctx);
  // Only show a number that belongs to the suggested story (scaffold falls back to any fact's metric).
  const story = sc.storyId ? ctx.stories.find((x) => x.id === sc.storyId) : null;
  const usesStory = story && sc.bullets.some((b) => b.startsWith("S:") || b.includes(story.title.slice(0, 20)));
  const core = jdSkillsYouHave(ctx.skills, jdTerms).slice(0, 3);
  const skillsLine = SKILL_INTENTS.has(sc.intent) && core.length && !sc.bullets.some((b) => core.every((k) => b.includes(k)))
    ? `Назови навыки из вакансии, которые у тебя есть: ${core.join(", ")} — и где ты их применял(а)`
    : null;
  const bullets = skillsLine ? [...sc.bullets.slice(0, 3), skillsLine] : sc.bullets.slice(0, 4);
  return { opener: sc.opener, bullets, keyNumber: usesStory ? story.metric : sc.keyNumber, strategy: sc.strategy, coreSkills: core };
}
