import { INTRO_CUE_RU, MOCK_QUESTIONS, STRUCTURE_CUE_RU, STRUCTURE_OK, detectIntent, jdSkillsYouHave, scaffold, type FactLite, type StoryLite, type scoreAnswer } from "@/lib/engine/interview";
import type { MessageKey, T } from "@/lib/i18n/translator";

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

// Keys of the «Чего не хватило» points in the interface language (missingPoints with `t`).
const STAR_KEY = { s: "starS", t: "starT", a: "starA", r: "starR" } as const;
const INTRO_KEY: Record<keyof typeof INTRO_CUE_RU, string> = { now: "introNow", past: "introPast", future: "introFuture", proof: "introProof" };
const CUE_KEY: Record<keyof typeof STRUCTURE_CUE_RU, string> = { order: "cueOrder", sentences: "cueSentences", example: "cueExample", conclusion: "cueConclusion" };
const mk = (k: string) => `interviewPractice.missing.${k}` as MessageKey;

/**
 * What the answer lacks, in plain words — beyond the engine's generic tips. Empty (→ «Все ключевые элементы на месте»)
 * only when the structure is really complete: a full STAR (+ the lesson) for behavioral questions, structure ≥ STRUCTURE_OK
 * otherwise; each missing structure cue is named.
 */
export function missingPoints(question: string, answer: string, s: Score, ctx: MockCtx, t?: T): string[] {
  // Without `t`: the Russian wording (tests, server). With `t`: the interface language.
  const tr = (key: string, ru: string, params?: Record<string, string>) => (t ? t(mk(key), params) : ru);
  const intent = detectIntent(question);
  const out: string[] = [];
  const low = answer.toLowerCase();
  const star = intent === "behavioral" || intent === "leadership";
  if (star) {
    const names = { s: "контекст: где и когда", t: "твоя задача", a: "твои конкретные действия", r: "результат" } as const;
    (Object.keys(names) as (keyof typeof names)[]).forEach((k) => !s.star[k] && out.push(tr(STAR_KEY[k], names[k])));
    if (!/(learn|lesson|next time|вывод|научил|понял)/i.test(answer)) out.push(tr("lesson", "чему это научило"));
  }
  // «Tell me about yourself»: its own present → past → future cues, never STAR or «конкретный пример».
  if (intent === "intro" && s.introCues) {
    (Object.keys(INTRO_CUE_RU) as (keyof typeof INTRO_CUE_RU)[]).forEach((k) => !s.introCues![k] && out.push(tr(INTRO_KEY[k], INTRO_CUE_RU[k])));
    return out.slice(0, 4);
  }
  const hasNumber = /\d/.test(answer);
  // Missing structure cues come after the content points (those are more specific to the question). A result with a
  // number is a concrete example already — «конкретный пример» is not claimed missing then.
  const structure = !star && s.structure < STRUCTURE_OK ? (Object.keys(STRUCTURE_CUE_RU) as (keyof typeof STRUCTURE_CUE_RU)[]).filter((k) => !s.cues[k] && !(k === "order" && intent === "technical") && !(k === "example" && hasNumber)).map((k) => tr(CUE_KEY[k], STRUCTURE_CUE_RU[k])) : [];
  if (!hasNumber) out.push(tr("number", "цифра результата (было → стало)"));
  if ((intent === "motivation" || /why .*compan/i.test(question)) && !low.includes(ctx.company.toLowerCase())) out.push(tr("company", `конкретика о ${ctx.company}`, { company: ctx.company }));
  if (intent === "technical" && !/(first|then|step|сначала|затем)/i.test(answer)) out.push(tr("stepwise", "пошаговый подход"));
  if (intent === "closing" && !answer.includes("?")) out.push(tr("questions", "1–2 твоих вопроса"));
  const list = [...new Set([...out, ...structure])];
  // Never an empty list (= «все элементы на месте») while the structure is still weak.
  if (!list.length && s.structure < STRUCTURE_OK) list.push(tr("structure", "чёткая структура: вступление → пример → вывод"));
  return list.slice(0, 4);
}

/** Interviewer personas in Russian (the lib labels are English). The UI uses «interviewPractice.personas.<key>». */
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
export function suggestion(question: string, ctx: MockCtx, jdTerms: string[] = ctx.jdTerms ?? [], t?: T) {
  const sc = scaffold(question, ctx);
  // Only show a number that belongs to the suggested story (scaffold falls back to any fact's metric).
  const story = sc.storyId ? ctx.stories.find((x) => x.id === sc.storyId) : null;
  const usesStory = story && sc.bullets.some((b) => b.startsWith("S:") || b.includes(story.title.slice(0, 20)));
  const core = jdSkillsYouHave(ctx.skills, jdTerms).slice(0, 3);
  const skillsLine = SKILL_INTENTS.has(sc.intent) && core.length && !sc.bullets.some((b) => core.every((k) => b.includes(k)))
    ? t ? t("interviewPractice.missing.skillsLine", { skills: core.join(", ") }) : `Назови навыки из вакансии, которые у тебя есть: ${core.join(", ")} — и где ты их применял(а)`
    : null;
  const bullets = skillsLine ? [...sc.bullets.slice(0, 3), skillsLine] : sc.bullets.slice(0, 4);
  // skillsLine: the one bullet in the interface language (the scaffold's own bullets are engine text, Russian).
  return { opener: sc.opener, bullets, keyNumber: usesStory ? story.metric : sc.keyNumber, strategy: sc.strategy, coreSkills: core, skillsLine };
}
