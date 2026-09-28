import { z } from "zod";
import { count } from "../../../../_components/ru";

// Interview Debrief: turns a ~1 minute free-form story ("how did it go?") into a structured debrief.
// Pure deterministic engine — the server action uses it as the fallback for Claude (same schema).

export const DebriefAISchema = z.object({
  questions: z.array(z.string()),
  hard: z.string(),
  nextStage: z.string(),
  salaryDiscussed: z.boolean(),
  salaryNote: z.string(),
  answerBy: z.string(), // YYYY-MM-DD or ""
  performance: z.number(),
  strong: z.array(z.string()),
  weak: z.array(z.string()),
  nextPrep: z.array(z.string()),
});
export type DebriefAI = z.infer<typeof DebriefAISchema>;

export const DEBRIEF_PROMPTS = ["Какие вопросы задавали?", "Что было сложно?", "Назвали следующий этап?", "Говорили о зарплате?", "Когда обещали ответ?"];

const RE = {
  question: /(спросил|спрашивал|задал|задавал|попросил|просили|asked|wanted to know|had me)/i,
  hard: /(сложн|трудн|не смог|не знал|не вспомнил|забыл|растерял|волнов|запутал|hard|difficult|tough|struggl|stuck|nervous|didn'?t know|forgot|blank)/i,
  good: /(хорошо|отлично|уверенно|понравил|получилось|смог|легко|well|good|great|confident|liked|nailed|smooth|easy|positive)/i,
  next: /(следующ|дальше|next (step|round|stage)|technical|техническ|финал|final|hiring manager|руководител|onsite|тестов|assessment|take-?home)/i,
  salary: /(зарплат|salary|compensation|вилк|ожидани|оклад|pay|budget|бюджет)/i,
};

const PREP_MAP: [RegExp, string][] = [
  [/sql|join|window|оконн|запрос/i, "SQL: JOIN, агрегаты и оконные функции на время"],
  [/a\/b|experiment|эксперимент|тест[аы]? a|significan|значим/i, "A/B-тесты: дизайн, размер выборки, интерпретация"],
  [/retention|churn|funnel|воронк|удержан|метрик|metric/i, "Продуктовые метрики: удержание, воронка, разбор падения"],
  [/python|pandas/i, "Python / pandas: группировки и чистка данных"],
  [/conflict|конфликт|disagree|stakeholder|стейкхолдер/i, "STAR-история про конфликт со стейкхолдером"],
  [/fail|mistake|ошибк|провал/i, "STAR-история про ошибку и вывод"],
  [/salary|зарплат|ожидани|вилк/i, "Ответ про зарплатные ожидания с диапазоном"],
  [/english|англ|accent|speak/i, "Разговорная практика на английском: 3 ответа вслух"],
  [/case|кейс|estimate|оцен|sizing/i, "Кейсы: структура → гипотезы → метрики → рекомендация"],
  [/yourself|о себе|introduc/i, "Рассказ о себе: 60–90 секунд, сейчас → раньше → дальше"],
  [/why (us|company)|почему (мы|компан)|motivation|мотивац/i, "«Почему мы?»: 1 факт о компании + связь с опытом"],
];

const NEXT_ROUND_PREP: Record<string, string> = {
  recruiter: "Рекрутер: мотивация, ожидания, сроки выхода",
  hiring_manager: "Нанимающий менеджер: глубина лучшего проекта и приоритизация",
  technical: "Техническое: задача вживую по SQL / аналитике",
  final: "Финал: ценности, долгосрочные цели, вопросы к лидерам",
};

const sentencesOf = (t: string) =>
  t.replace(/\s+/g, " ").split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim().replace(/^(и|а|но|ну|and|but|so)\s+/i, "")).filter((s) => s.length > 3);

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const trimEnd = (s: string) => s.replace(/[.;,\s]+$/, "");

const WEEKDAYS: [RegExp, number][] = [[/понедельник|monday/i, 1], [/вторник|tuesday/i, 2], [/сред[уы]|wednesday/i, 3], [/четверг|thursday/i, 4], [/пятниц|friday/i, 5]];

export function parseAnswerBy(text: string, now: Date): string {
  const d = new Date(now);
  const n = text.match(/(?:через|in|within|в течение)\s+(\d+|один|одну|два|две|двух|три|трёх|трех|пять|пяти|one|two|three|five)\s*(дн|день|дня|недел|business days|days|day|weeks?)/i);
  const words: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, двух: 2, три: 3, трёх: 3, трех: 3, пять: 5, пяти: 5, one: 1, two: 2, three: 3, five: 5 };
  if (/(через|in|within|в течение)\s+(неделю|недели|a week)/i.test(text)) d.setDate(d.getDate() + 7);
  else if (n) {
    const k = Number(n[1]) || words[n[1].toLowerCase()] || 1;
    d.setDate(d.getDate() + (/недел|week/i.test(n[2]) ? k * 7 : k));
  } else if (/на следующей неделе|next week|в течение недели|within a week/i.test(text)) d.setDate(d.getDate() + 7);
  else if (/завтра|tomorrow/i.test(text)) d.setDate(d.getDate() + 1);
  else {
    const wd = WEEKDAYS.find(([re]) => re.test(text));
    if (!wd || !/(до|к|by|until|on)\s/i.test(text)) return "";
    const diff = (wd[1] - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
  }
  return d.toISOString().slice(0, 10);
}

export function structureDebrief(i: { transcript: string; outcome: string; round: string; nextRound: string | null; technologies: string[]; now: Date }): DebriefAI {
  const ss = sentencesOf(i.transcript);
  const pick = (re: RegExp) => ss.filter((s) => re.test(s));

  const questions = [
    ...ss.filter((s) => /\?$/.test(s)),
    ...pick(RE.question).map((s) => s.replace(/^.*?(спросил[аи]?|спрашивали|задавали|задали|попросили|asked( me)?|wanted to know)\s+(?:(?:про|о|об|about|to)\s+)?/i, "")),
  ]
    .map((q) => cap(trimEnd(q)))
    .filter((q, idx, a) => q.length > 3 && a.indexOf(q) === idx)
    .slice(0, 8);

  const hardS = pick(RE.hard);
  const goodS = pick(RE.good).filter((s) => !RE.hard.test(s));
  const nextS = pick(RE.next).filter((s) => !RE.question.test(s) || /следующ|next/i.test(s));
  const noSalary = /(не|didn'?t|did not|wasn'?t|no)\s+(говорили|обсуждали|спрашивали|затрагивали|discuss|talk|ask|come up|mention)/i;
  const salS = pick(RE.salary).filter((x) => !noSalary.test(x));
  const answerTxt = ss.find((s) => /(ответ|свяжутся|вернутся|напишут|get back|hear back|let me know|respond|follow up)/i.test(s)) ?? "";
  const answerBy = parseAnswerBy(answerTxt || i.transcript, i.now);

  const weak = hardS.map((s) => cap(trimEnd(s))).slice(0, 4);
  const strong = goodS.map((s) => cap(trimEnd(s))).slice(0, 4);
  if (!strong.length) {
    if (nextS.length) strong.push("Дошли до обсуждения следующего этапа — хороший сигнал");
    if (questions.length >= 3) strong.push(`Ответы на ${count(questions.length, ["вопрос", "вопроса", "вопросов"])} без пропусков`);
    if (/\d/.test(i.transcript)) strong.push("Приводили конкретные цифры");
  }
  if (!weak.length && !/\d/.test(i.transcript)) weak.push("В рассказе нет цифр — проверь, были ли они в ответах");

  const prep = new Set<string>();
  for (const s of [...hardS, ...questions]) for (const [re, topic] of PREP_MAP) if (re.test(s)) prep.add(topic);
  if (i.outcome !== "failed" && i.nextRound && NEXT_ROUND_PREP[i.nextRound]) prep.add(NEXT_ROUND_PREP[i.nextRound]);
  for (const t of i.technologies) if (prep.size < 3 && ![...prep].some((p) => p.toLowerCase().startsWith(t.toLowerCase()))) prep.add(`${t}: 2 рабочих примера и типичные вопросы`);

  const score = 72 + Math.min(3, strong.length) * 4 - Math.min(3, hardS.length) * 6 + (nextS.length ? 5 : 0) + (i.outcome === "passed" ? 10 : i.outcome === "failed" ? -14 : 0) + (i.transcript.split(/\s+/).length > 60 ? 2 : -3);

  return {
    questions,
    hard: weak.join(". "),
    nextStage: nextS[0] ? cap(trimEnd(nextS[0].replace(/^(они\s+)?(сказали|сказал[аи]?|говорили|обещали|they said|he said|she said|told me),?\s*(что|that)?\s*/i, ""))) : "",
    salaryDiscussed: salS.length > 0,
    salaryNote: salS[0] ? cap(trimEnd(salS[0])) : "",
    answerBy,
    performance: Math.max(35, Math.min(96, Math.round(score))),
    strong,
    weak,
    nextPrep: [...prep].slice(0, 4),
  };
}
