import { z } from "zod";
import { yearsForEmployer } from "../ops";

// Pure module: safe to import from client components (Copilot runs scaffold() in the browser).

// ——— Question intent (runs client- and server-side; pure, <1ms) ———
export type Intent = "behavioral" | "experience" | "technical" | "motivation" | "leadership" | "salary" | "strengths" | "weakness" | "case" | "intro" | "closing";
const INTENTS: [Intent, RegExp][] = [
  ["intro", /tell me about yourself|introduce yourself|walk me through (your|the) (resume|cv|background)|расскажите о себе/i],
  ["salary", /salary|compensation|expectations|pay|how much|зарплат|ожидани/i],
  ["closing", /any questions for (me|us)|questions for us|вопросы к нам/i],
  ["weakness", /weakness|area (of|for) (improvement|growth)|слаб(ые|ая)/i],
  ["strengths", /strength|what are you (best|good) at|сильн(ые|ая)/i],
  // Unicode-aware start boundary: `\b` never fires before Cyrillic, so "конфликт"/"руковод…" were missed.
  ["leadership", /(?<![\p{L}\p{N}_])(lead|led|manage[d]?|mentor|conflict|team of|people management|disagree|конфликт|руковод)/iu],
  ["behavioral", /tell me about a time|describe a (time|situation)|give (me )?an example|failure|mistake|challenge|difficult|pressure|deadline|ошибк|сложн/i],
  ["motivation", /why (do you want|us|our company|this (role|company|position))|what (attracts|interests) you|почему (мы|наша|эта)/i],
  ["case", /how would you (estimate|approach|size|prioriti[sz]e|improve)|case|metric (would|to) (track|use)|drop in|decline in/i],
  ["technical", /how (does|would you|do you)|explain|difference between|design a|write a (query|function)|sql|python|join|index|algorithm|complexity|a\/b test|statistic/i],
  ["experience", /your (role|experience|work) (at|with|in)|what did you do|tell me about (your|the) project|опыт/i],
];
export function detectIntent(q: string): Intent {
  for (const [intent, re] of INTENTS) if (re.test(q)) return intent;
  return "experience";
}

/** How to structure the answer — Russian coaching for the user (the spoken opener stays English). */
export const INTENT_STRATEGY: Record<Intent, string> = {
  intro: "Настоящее → прошлое → будущее, 60–90 секунд",
  behavioral: "STAR: ситуация · задача · действие · результат",
  experience: "Контекст → твоя часть → результат с цифрой",
  technical: "Уточни → подход → компромиссы → пример",
  motivation: "Факт о компании → совпадение с ролью → твоё доказательство",
  leadership: "STAR с акцентом на твоё решение и результат для людей",
  salary: "Твоя собственная вилка, гибкость по пакету",
  strengths: "Одна сильная сторона + история-доказательство + связь с ролью",
  weakness: "Настоящая, но не ключевая слабость + что ты с ней делаешь",
  case: "Структура → гипотезы → метрики → рекомендация",
  closing: "Задай 2 вопроса: о команде и о критериях успеха",
};

export type StoryLite = { id: string; title: string; situation: string; task: string; action: string; result: string; metric: string; tags: string[] };
export type FactLite = { kind: string; title: string; org: string; details: string; metrics: string; tech: string[]; teamSize: number | null; startDate?: string; endDate?: string };

const CURRENT_END = /present|now|current|today|настоящ|н\.?\s?в\.?|сейчас|по н/i;
const yearOf = (d?: string) => Number(d?.match(/(19|20)\d{2}/)?.[0] ?? 0);
/** Ongoing roles (end "present" or no end but a start) first, then by the year they ended. */
function endRank(f: FactLite) {
  const end = (f.endDate ?? "").trim();
  if (end && !CURRENT_END.test(end)) return yearOf(end);
  return end || f.startDate ? 1e6 + yearOf(f.startDate) : -1;
}

/**
 * The user's current (latest) job: an ongoing employment fact, else the one that ended last, else the first listed
 * (facts come in CV order, newest first). Never the target vacancy.
 */
export function latestEmployment<T extends FactLite>(facts: T[]): T | undefined {
  const jobs = facts.filter((f) => f.kind === "employment");
  if (!jobs.some((f) => f.startDate || f.endDate)) return jobs[0];
  return jobs.map((f, i) => ({ f, i, r: endRank(f) })).sort((a, b) => b.r - a.r || a.i - b.i)[0]?.f;
}

const ACRONYMS = new Map(["BI", "SQL", "QA", "PM", "UX", "UI", "ML", "AI", "SEO", "CRM", "SDR", "BDR", "HR", "IT", "CX", "ETL", "API", "SDET", "DWH", "B2B", "B2C", "SaaS", "iOS", "DevOps", "FinTech"].map((a) => [a.toLowerCase(), a]));

/**
 * A job title as a noun inside a sentence: "Senior BI Analyst" → "senior BI analyst", "Qa engineer" → "QA engineer".
 * Known acronyms get their canonical casing; other words with inner capitals (DevOps, iOS) are kept; the rest go lower-case.
 */
export function titleInSentence(title: string) {
  return title.trim().split(/(\s+|\/|-|,)/).map((w) => {
    if (!/\p{L}/u.test(w)) return w;
    const known = ACRONYMS.get(w.toLowerCase());
    if (known) return known;
    return /\p{Lu}/u.test(w.slice(1)) ? w : w.toLowerCase();
  }).join("");
}

/** "a" / "an" before a title in a sentence: "an analyst", "a BI analyst"… "an SQL developer", "an ML engineer". */
export function withArticle(noun: string) {
  const first = noun.split(/\s+/)[0] ?? "";
  const acronym = first.length > 1 && first === first.toUpperCase() && /\p{Lu}/u.test(first);
  const an = acronym ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first) && !/^(uni|use|usu|eu|one)/i.test(first);
  return `${an ? "an" : "a"} ${noun}`;
}

const tokenize = (s: string) => s.toLowerCase().match(/[a-zа-я0-9%+#.]{3,}/g) ?? [];
const THEME: Record<string, string[]> = {
  conflict: ["disagree", "conflict", "pushback", "argue", "disagreement", "конфликт"],
  failure: ["fail", "failure", "mistake", "wrong", "ошибк"],
  leadership: ["lead", "led", "mentor", "manage", "team", "руковод"],
  impact: ["impact", "influence", "decision", "result", "business"],
  pressure: ["deadline", "pressure", "tight", "urgent"],
  initiative: ["initiative", "own", "proactive", "improve"],
  data: ["data", "analysis", "analytics", "sql", "python", "insight"],
  customer: ["customer", "client", "user"],
};

export function retrieveStories(q: string, stories: StoryLite[], k = 2) {
  const qt = new Set(tokenize(q));
  const themes = Object.entries(THEME).filter(([, ws]) => ws.some((w) => [...qt].some((t) => t.startsWith(w)))).map(([t]) => t);
  return stories
    .map((s) => {
      const st = tokenize(`${s.title} ${s.situation} ${s.task} ${s.action} ${s.result}`);
      let score = st.filter((t) => qt.has(t)).length;
      score += s.tags.filter((t) => themes.includes(t)).length * 3;
      if (s.metric) score += 0.5;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((x) => x.s);
}

export type Scaffold = { intent: Intent; strategy: string; opener: string; bullets: string[]; keyNumber: string; storyId: string | null };

/** Build the on-screen scaffold: 3–5 bullets, one number, one opener. Deterministic → instant. */
export function scaffold(q: string, ctx: { stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; currentTitle?: string; salary?: { low: number; high: number; source?: "floor" | "published" | "market" | "none" } }): Scaffold {
  const intent = detectIntent(q);
  const [story] = retrieveStories(q, ctx.stories, 1);
  const current = latestEmployment(ctx.facts);
  const topFact = ctx.facts.find((f) => f.kind === "employment" && f.metrics) ?? current;
  // Who the candidate is NOW: their latest job title, not the vacancy they are interviewing for.
  const nowTitle = (ctx.currentTitle || current?.title || "").trim();
  const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
  let bullets: string[] = [];
  let opener = "";
  let keyNumber = story?.metric || topFact?.metrics || "";
  switch (intent) {
    case "intro":
      opener = nowTitle
        ? `I'm ${withArticle(titleInSentence(nowTitle))} with ${yearsForEmployer(ctx.yearsExperience) ?? "hands-on project"} of hands-on experience.`
        : `I have ${yearsForEmployer(ctx.yearsExperience) ?? "hands-on project"} of hands-on experience with ${ctx.skills.slice(0, 2).join(" and ") || "this kind of work"}.`;
      bullets = [`Сейчас: ${current ? `${current.title}${current.org ? ` в ${current.org}` : ""}` : "твоя текущая роль"}`, `Доказательство: ${short(keyNumber || topFact?.details.split("\n")[0] || "один конкретный результат")}`, `Инструменты: ${ctx.skills.slice(0, 4).join(", ")}`, `Почему сюда: ${ctx.role} в ${ctx.company}`];
      break;
    case "salary": {
      // The same number the agent put in the screening answer (./salary.ts salaryTarget), never a lower market range.
      const sal = ctx.salary && ctx.salary.high > 0 ? ctx.salary : null;
      const k = (n: number) => `$${Math.round(n / 1000)}k`;
      const range = sal ? (sal.low === sal.high ? k(sal.low) : `${k(sal.low)}–${k(sal.high)}`) : "";
      if (sal && sal.source === "market") {
        opener = "Could you share the budgeted range for this role first?";
        bullets = ["Сначала спроси их бюджетную вилку", `Ориентир рынка: ${range} base (оценка) — своя вилка не указана в цели`, "Покажи гибкость по всему пакету"];
        keyNumber = "";
      } else if (sal) {
        opener = sal.source === "published" ? `In line with the published range, I'm targeting around ${range} base.` : `I'm targeting ${range} base, depending on the full package.`;
        bullets = [sal.source === "published" ? `Цель: ${range} base — по опубликованной вилке` : `Вилка: ${range} base — твоё ожидание, как в заявке`, "Покажи гибкость по всему пакету", "Если можно, сначала узнай их вилку"];
        keyNumber = range;
      } else {
        bullets = ["Сначала спроси их бюджетную вилку", "Назови свою вилку, оставь гибкость по пакету"];
        keyNumber = "";
      }
      break;
    }
    case "motivation":
      opener = `What draws me to ${ctx.company} is…`;
      bullets = [`Компания: один конкретный факт о ${ctx.company}`, `Роль: чем задачи ${ctx.role} совпадают с твоим опытом`, `Доказательство: ${short(story?.title ?? topFact?.title ?? "твой лучший проект")}`, "Будущее: чему хочешь научиться и за что отвечать"];
      break;
    case "weakness":
      opener = "One thing I've been actively working on is…";
      bullets = ["Настоящая, но не ключевая для роли слабость", "Конкретный пример, где она проявилась", "Что поменялось: система или привычка", "Доказательство, что становится лучше"];
      break;
    case "closing":
      opener = "Yes — a couple of questions.";
      bullets = ["What does success look like in the first 90 days?", "What's the team's biggest challenge right now?", "How are decisions made between analytics and product?"];
      keyNumber = "";
      break;
    case "technical":
    case "case":
      opener = intent === "case" ? "Let me structure this first…" : "Let me clarify the context first…";
      bullets = intent === "case" ? ["Уточни цель и ограничения", "Разбей на 2–3 драйвера", "Гипотезы → какая метрика подтвердит каждую", "Рекомендация + следующий шаг"] : ["Уточни требование", "Объясни подход по шагам", "Назови один компромисс (trade-off)", story ? `Пример: ${short(story.title)}` : `Пример из ${topFact?.org ?? "твоей работы"}`];
      break;
    default:
      if (story) {
        opener = `A good example is ${short(story.title, 60).toLowerCase()}.`;
        bullets = [`S: ${short(story.situation)}`, `T: ${short(story.task)}`, `A: ${short(story.action)}`, `R: ${short(story.result)}`];
      } else if (topFact) {
        opener = `At ${topFact.org || "my last role"}, …`;
        bullets = [`Контекст: ${short(topFact.title)}`, `Твоя часть: ${short(topFact.details.split("\n")[0] ?? "")}`, `Результат: ${short(topFact.metrics || "назови итог")}`];
      } else bullets = ["Выбери свой самый сильный реальный пример", "Твоё конкретное действие", "Итог + вывод"];
      if (intent === "behavioral" || intent === "leadership") bullets.push("Закончи выводом: чему это научило");
  }
  return { intent, strategy: INTENT_STRATEGY[intent], opener, bullets: bullets.slice(0, 5), keyNumber, storyId: story?.id ?? null };
}

// ——— Interview Pack ———
export const PackSchema = z.object({
  tellMeAboutYourself: z.string(),
  whyCompany: z.string(),
  whyRole: z.string(),
  behavioral: z.array(z.object({ question: z.string(), storyTitle: z.string(), outline: z.string() })),
  technicalTopics: z.array(z.object({ topic: z.string(), why: z.string(), prep: z.string() })),
  questionsToAsk: z.array(z.string()),
  redFlags: z.array(z.string()),
});
export type Pack = z.infer<typeof PackSchema>;

const ROUND_TOPICS: Record<string, string[]> = {
  recruiter: ["Motivation and career story", "Salary expectations and availability", "Work authorization / location"],
  hiring_manager: ["Depth on your most relevant project", "How you prioritize and communicate", "Collaboration with stakeholders"],
  technical: ["Core hard skills from the JD", "Live problem-solving", "Trade-offs and edge cases"],
  final: ["Culture and values", "Long-term fit", "Questions for leadership"],
  assessment: ["Timed test format", "Core skills from the JD", "Practice under time pressure"],
};

export function buildPackHeuristic(ctx: { name: string; role: string; company: string; round: string; jd: string; technologies: string[]; skills: string[]; yearsExperience: number; stories: StoryLite[]; facts: FactLite[] }): Pack {
  const top = latestEmployment(ctx.facts);
  const metric = ctx.facts.find((f) => f.metrics)?.metrics;
  const behavioralQs = ["Tell me about a time you had a disagreement with a stakeholder.", "Tell me about a failure and what you learned.", "Describe a project where your work influenced a business decision.", "Tell me about a time you worked under a tight deadline."];
  return {
    tellMeAboutYourself: `Present: ${top ? `${top.title} at ${top.org}` : ctx.role}, ${yearsForEmployer(ctx.yearsExperience) ?? "hands-on projects"} with ${ctx.skills.slice(0, 3).join(", ")}.\nPast: how you got here — one pivot, one proof${metric ? ` (${metric})` : ""}.\nFuture: why ${ctx.role} at ${ctx.company} is the logical next step. Keep it 60–90 seconds.`,
    whyCompany: `Name one specific thing about ${ctx.company} (product, market, recent news). Connect it to your experience in ${ctx.skills.slice(0, 2).join(" and ")}. End with what you want to build there.`,
    whyRole: `Map the JD to your proof: ${ctx.technologies.filter((t) => ctx.skills.includes(t)).slice(0, 3).join(", ") || ctx.skills.slice(0, 3).join(", ")}. Mention one requirement you're eager to grow into — honestly.`,
    behavioral: behavioralQs.map((q) => {
      const [s] = retrieveStories(q, ctx.stories, 1);
      return { question: q, storyTitle: s?.title ?? "Добавь STAR-историю в профиль", outline: s ? `S: ${s.situation}\nT: ${s.task}\nA: ${s.action}\nR: ${s.result}` : "Нет подходящей истории — добавь её в профиль" };
    }),
    technicalTopics: [...ctx.technologies.slice(0, 4).map((t) => ({ topic: t, why: "Указано в описании вакансии", prep: ctx.skills.includes(t) ? "Повтори 2 рабочих примера и типичные вопросы" : "Нет в профиле — подготовь честный ответ и ближайший аналог" })), ...(ROUND_TOPICS[ctx.round] ?? []).map((t) => ({ topic: t, why: `Типично для раунда ${ctx.round}`, prep: "Подготовь 1 историю и 1 вопрос" }))],
    questionsToAsk: ["What does success look like in the first 90 days?", "What is the biggest challenge the team faces this quarter?", "How does this role work with product/engineering?", "What does the interview process look like from here?", "What do the best people on this team do differently?", `What's ${ctx.company}'s biggest priority for this year?`],
    redFlags: [ctx.yearsExperience < 2 ? "Не преувеличивай стаж — говори о глубине задач" : "Готовься к вопросам о масштабе", "Не называй цифру зарплаты первым без вилки"],
  };
}

// ——— Mock interview ———
export const MOCK_QUESTIONS: Record<string, string[]> = {
  recruiter: ["Tell me about yourself.", "Why are you interested in this role?", "Why do you want to leave your current position?", "What are your salary expectations?", "When could you start?"],
  hiring_manager: ["Walk me through the project you're most proud of.", "Tell me about a time you had a disagreement with your manager.", "How do you prioritize when everything is urgent?", "Tell me about a failure and what you learned.", "What would you do in your first 90 days?"],
  technical: ["How would you find the top 3 customers by revenue per month in SQL?", "How would you design an A/B test for a new onboarding flow?", "Explain the difference between a LEFT JOIN and an INNER JOIN.", "Daily active users dropped 15% yesterday — how do you investigate?", "How do you make sure your analysis is correct?"],
};

// Lookarounds instead of `\b`, which does not work next to Cyrillic ("ну", "типа" never matched).
// "like" is a filler only as one: set off by a comma («it was, like, big», «like, um») or quotative «I was like» / «I'm like».
// "I like SQL", "would like to", "tools like dbt" are words, not fillers.
const FILLERS = /(?<![\p{L}\p{N}_])(um+|uh+|you know|basically|actually|sort of|kind of|ну|типа|как бы|короче|в общем|like(?=\s*,)|(?<=,\s*)like(?![\p{L}\p{N}_])|(?<=\b(?:i|he|she|they|we|you) (?:was|were|am|is|are) )like|(?<=\b(?:i'm|he's|she's|they're|we're|you're) )like)(?![\p{L}\p{N}_])/giu;

const HEDGES = /(?<![\p{L}\p{N}_])(i think maybe|i guess|not sure|probably|maybe|kind of|sort of|i hope|наверное|не уверен\p{L}*|может быть|вроде|как бы)(?![\p{L}\p{N}_])/giu;
/** A typed answer shows wording, not delivery: confidence comes from hedging words only and never reads as 100. */
export const TYPED_CONFIDENCE_CAP = 80;

/**
 * Confidence of an answer. Spoken (speech recognition): hedges and fillers. Typed (the default — the text box): hedges only,
 * capped at TYPED_CONFIDENCE_CAP, since typing says nothing about pauses or tone.
 */
export function answerConfidence(answer: string, spoken = false) {
  const hedges = answer.match(HEDGES)?.length ?? 0;
  if (!spoken) return Math.max(20, TYPED_CONFIDENCE_CAP - hedges * 15);
  const fillers = answer.match(FILLERS)?.length ?? 0;
  return Math.max(20, 100 - hedges * 20 - fillers * 5);
}

/** Answers shorter than this many words are capped at SHORT_ANSWER_CAP overall. */
export const SHORT_ANSWER_WORDS = 20;
export const SHORT_ANSWER_CAP = 30;

/**
 * Structure of a non-STAR answer from what is actually there (no free default): ordering words, more than one sentence,
 * a concrete example, a conclusion. 0 cues = 20, each cue adds up to 100.
 */
export function structureScore(answer: string) {
  const sentences = answer.split(/[.!?]+(?:\s|$)/).filter((x) => x.trim().split(/\s+/).length >= 3).length;
  const cues = [
    /(?<![\p{L}])(first(?:ly)?|second(?:ly)?|then|next|after that|finally|во-первых|во-вторых|затем|потом|после этого|наконец)(?![\p{L}])/iu.test(answer),
    sentences >= 2,
    /(?<![\p{L}])(for example|for instance|e\.g\.|such as|например|к примеру)(?![\p{L}])/iu.test(answer),
    /(?<![\p{L}])(so|as a result|in short|overall|in the end|that's why|итак|в итоге|в результате|поэтому)(?![\p{L}])/iu.test(answer),
  ].filter(Boolean).length;
  return [20, 45, 65, 85, 100][cues];
}

export function scoreAnswer(question: string, answer: string, ctx: { skills: string[]; jdTerms: string[]; /** true when the answer came through the microphone */ spoken?: boolean }) {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  const fillers = answer.match(FILLERS)?.length ?? 0;
  const intent = detectIntent(question);
  const hasNumber = /\d/.test(answer);
  const star = { s: /(situation|context|when i|at my|we had|в компании|была ситуация)/i.test(answer), t: /(task|goal|needed to|responsible|задач|цель)/i.test(answer), a: /\b(i (built|led|analy[sz]ed|created|proposed|wrote|designed|decided|implemented))|я (сделал|построил|предложил|проанализировал)/i.test(answer), r: /(result|outcome|increased|reduced|improved|grew|saved|в итоге|результат)/i.test(answer) };
  const starScore = Object.values(star).filter(Boolean).length / 4;
  const relevance = ctx.jdTerms.filter((t) => answer.toLowerCase().includes(t.toLowerCase())).length;
  const lengthScore = n < SHORT_ANSWER_WORDS ? 15 : n < 40 ? 40 : n <= 220 ? 100 : n <= 320 ? 70 : 45;
  const clarity = Math.max(0, 100 - fillers * 12 - (answer.match(/[^.!?]{220,}/g)?.length ?? 0) * 15);
  const structure = intent === "behavioral" || intent === "leadership" ? Math.round(starScore * 100) : structureScore(answer);
  const confidence = answerConfidence(answer, ctx.spoken);
  const content = Math.min(100, 45 + (hasNumber ? 25 : 0) + relevance * 10 + (/\bi\b|я /i.test(answer) ? 10 : 0));
  const weighted = Math.round((content * 0.3 + structure * 0.2 + clarity * 0.15 + lengthScore * 0.15 + confidence * 0.1 + Math.min(100, relevance * 25) * 0.1));
  // A one-liner is not an answer, however well-worded: under SHORT_ANSWER_WORDS words the overall stays at SHORT_ANSWER_CAP.
  const overall = n < SHORT_ANSWER_WORDS ? Math.min(SHORT_ANSWER_CAP, weighted) : weighted;
  const tips: string[] = [];
  if (!hasNumber) tips.push("Добавь одну цифру результата (было → стало).");
  const STAR_RU: Record<string, string> = { s: "ситуации", t: "задачи", a: "действия", r: "результата" };
  if ((intent === "behavioral" || intent === "leadership") && starScore < 0.75) tips.push(`STAR неполный — не хватает: ${Object.entries(star).filter(([, v]) => !v).map(([k]) => STAR_RU[k]).join(", ")}.`);
  if (n > 220) tips.push("Слишком длинно — уложись в 60–120 секунд.");
  if (n < SHORT_ANSWER_WORDS) tips.push("Это одна фраза, а не ответ — расскажи о своём конкретном действии и его результате.");
  else if (n < 40) tips.push("Слишком коротко — раскрой своё конкретное действие.");
  if (fillers > 2) tips.push(`Слова-паразиты: ${fillers}. Делай паузу вместо «um/like».`);
  if (!relevance) tips.push("Свяжи ответ с требованиями вакансии.");
  return { overall, content, structure, clarity, length: lengthScore, confidence, fillers, words: n, star, tips, intent };
}
