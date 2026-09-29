// Interview readiness — one definition, used by Career Score (component "interviewReadiness"), the Career Readiness
// check "interview" (src/lib/engine/readiness.ts) and the Readiness page's "Interview readiness" parameter.
// Pure: safe on server and client.

import { count } from "../ru";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** Score a missing mock counts as: no practice yet is below average, not zero. */
const NO_MOCK = 40;

/**
 * General interview readiness of the candidate (not tied to one interview): mock-interview quality (average overall
 * score of every mock, 60%) plus STAR stories ready for behavioral questions (10 points each, up to 4).
 */
export function interviewReadiness(i: { stories: number; mockScores: number[] }) {
  const scores = i.mockScores.filter((v) => typeof v === "number" && Number.isFinite(v));
  const mockAvg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const score = clamp((mockAvg ?? NO_MOCK) * 0.6 + Math.min(4, Math.max(0, i.stories)) * 10);
  const note = `${count(i.stories, ["история", "истории", "историй"])} для интервью · ${count(scores.length, ["тренировка", "тренировки", "тренировок"])}${mockAvg != null ? ` (в среднем ${mockAvg})` : ""}`;
  return { score, stories: i.stories, mocks: scores.length, mockAvg, note };
}
export type InterviewReadiness = ReturnType<typeof interviewReadiness>;

/**
 * Readiness for ONE specific interview (Interview Room aside) — a different measure, so it has a different name:
 * «Готовность к этому интервью». Match with the vacancy, the best mock for this room, stories, brief/answers.
 */
/**
 * `value` weighs into the total (a mock not taken yet counts as NO_MOCK — no practice lowers readiness); `score` is what
 * the line shows: null for «Пробное интервью · ещё не пройдено» (no invented 40 next to «not done»).
 */
export function roomReadiness(i: { match: number; bestMock: number | null; stories: number; hasPack: boolean }) {
  const parts: { label: string; value: number; score: number | null; w: number; hint?: string }[] = [
    { label: "Match с вакансией", value: clamp(i.match), score: clamp(i.match), w: 0.45 },
    { label: "Пробное интервью", value: clamp(i.bestMock ?? NO_MOCK), score: i.bestMock == null ? null : clamp(i.bestMock), w: 0.25, hint: i.bestMock == null ? "ещё не пройдено" : "лучший результат" },
    { label: "STAR-истории", value: clamp(i.stories * 25), score: clamp(i.stories * 25), w: 0.2, hint: `${i.stories} в библиотеке` },
    { label: "Бриф и ответы", value: i.hasPack ? 100 : 60, score: i.hasPack ? 100 : 60, w: 0.1 },
  ];
  return { title: "Готовность к этому интервью", score: clamp(parts.reduce((a, p) => a + p.value * p.w, 0)), parts };
}
