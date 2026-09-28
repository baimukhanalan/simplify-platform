import { z } from "zod";

// Pure module: safe to import from client components (Copilot runs scaffold() in the browser).

// ——— Question intent (runs client- and server-side; pure, <1ms) ———
export type Intent = "behavioral" | "experience" | "technical" | "motivation" | "leadership" | "salary" | "strengths" | "weakness" | "case" | "intro" | "closing";
const INTENTS: [Intent, RegExp][] = [
  ["intro", /tell me about yourself|introduce yourself|walk me through (your|the) (resume|cv|background)|расскажите о себе/i],
  ["salary", /salary|compensation|expectations|pay|how much|зарплат|ожидани/i],
  ["closing", /any questions for (me|us)|questions for us|вопросы к нам/i],
  ["weakness", /weakness|area (of|for) (improvement|growth)|слаб(ые|ая)/i],
  ["strengths", /strength|what are you (best|good) at|сильн(ые|ая)/i],
  ["leadership", /\b(lead|led|manage[d]?|mentor|conflict|team of|people management|disagree|конфликт|руковод)/i],
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

export const INTENT_STRATEGY: Record<Intent, string> = {
  intro: "Present → Past → Future, 60–90 sec",
  behavioral: "STAR: Situation · Task · Action · Result",
  experience: "Context → your part → result with number",
  technical: "Clarify → approach → trade-offs → example",
  motivation: "Company fact → role fit → your proof",
  leadership: "STAR, emphasize your decision and the people outcome",
  salary: "Range anchored on market, flexible on package",
  strengths: "One strength + proof story + relevance",
  weakness: "Real, non-core weakness + what you do about it",
  case: "Structure → hypotheses → metrics → recommendation",
  closing: "Ask 2 questions about team, success metrics",
};

export type StoryLite = { id: string; title: string; situation: string; task: string; action: string; result: string; metric: string; tags: string[] };
export type FactLite = { kind: string; title: string; org: string; details: string; metrics: string; tech: string[]; teamSize: number | null };

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
export function scaffold(q: string, ctx: { stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; salary?: { low: number; high: number } }): Scaffold {
  const intent = detectIntent(q);
  const [story] = retrieveStories(q, ctx.stories, 1);
  const topFact = ctx.facts.find((f) => f.kind === "employment" && f.metrics) ?? ctx.facts.find((f) => f.kind === "employment");
  const short = (s: string, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
  let bullets: string[] = [];
  let opener = "";
  let keyNumber = story?.metric || topFact?.metrics || "";
  switch (intent) {
    case "intro":
      opener = `I'm a ${ctx.role.toLowerCase()} with ${ctx.yearsExperience} years of hands-on experience.`;
      bullets = [`Now: ${topFact ? `${topFact.title} at ${topFact.org}` : "current role"}`, `Proof: ${short(keyNumber || topFact?.details.split("\n")[0] || "one concrete result")}`, `Tools: ${ctx.skills.slice(0, 4).join(", ")}`, `Why here: ${ctx.role} at ${ctx.company}`];
      break;
    case "salary":
      opener = "Based on the scope and market data, I'm targeting…";
      bullets = ctx.salary ? [`Range: $${Math.round(ctx.salary.low / 1000)}k–$${Math.round(ctx.salary.high / 1000)}k base`, "Flexible on the full package", "Ask about their band first if possible"] : ["Ask for their budgeted range first", "Anchor on market, flexible on package"];
      keyNumber = ctx.salary ? `$${Math.round(ctx.salary.high / 1000)}k` : "";
      break;
    case "motivation":
      opener = `What draws me to ${ctx.company} is…`;
      bullets = [`Company: one specific fact about ${ctx.company}`, `Role: ${ctx.role} scope matches your experience`, `Proof: ${short(story?.title ?? topFact?.title ?? "your best project")}`, "Future: what you want to learn/own there"];
      break;
    case "weakness":
      opener = "One thing I've been actively working on is…";
      bullets = ["Real but non-core weakness", "Concrete example where it showed", "What you changed (system/habit)", "Evidence it's improving"];
      break;
    case "closing":
      opener = "Yes — a couple of questions.";
      bullets = ["What does success look like in the first 90 days?", "What's the team's biggest challenge right now?", "How are decisions made between analytics and product?"];
      keyNumber = "";
      break;
    case "technical":
    case "case":
      opener = intent === "case" ? "Let me structure this first…" : "Let me clarify the context first…";
      bullets = intent === "case" ? ["Clarify goal & constraints", "Break into 2–3 drivers", "Hypotheses → which metric proves each", "Recommend + next step"] : ["Clarify the requirement", "Explain the approach step by step", "Mention one trade-off", story ? `Example: ${short(story.title)}` : `Example from ${topFact?.org ?? "your work"}`];
      break;
    default:
      if (story) {
        opener = `A good example is ${short(story.title, 60).toLowerCase()}.`;
        bullets = [`S: ${short(story.situation)}`, `T: ${short(story.task)}`, `A: ${short(story.action)}`, `R: ${short(story.result)}`];
      } else if (topFact) {
        opener = `At ${topFact.org || "my last role"}, …`;
        bullets = [`Context: ${short(topFact.title)}`, `Your part: ${short(topFact.details.split("\n")[0] ?? "")}`, `Result: ${short(topFact.metrics || "state the outcome")}`];
      } else bullets = ["Pick your strongest verified example", "Your specific action", "Outcome + lesson"];
      if (intent === "behavioral" || intent === "leadership") bullets.push("Close with the lesson learned");
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
  const top = ctx.facts.find((f) => f.kind === "employment");
  const metric = ctx.facts.find((f) => f.metrics)?.metrics;
  const behavioralQs = ["Tell me about a time you had a disagreement with a stakeholder.", "Tell me about a failure and what you learned.", "Describe a project where your work influenced a business decision.", "Tell me about a time you worked under a tight deadline."];
  return {
    tellMeAboutYourself: `Present: ${top ? `${top.title} at ${top.org}` : ctx.role}, ${ctx.yearsExperience} years with ${ctx.skills.slice(0, 3).join(", ")}.\nPast: how you got here — one pivot, one proof${metric ? ` (${metric})` : ""}.\nFuture: why ${ctx.role} at ${ctx.company} is the logical next step. Keep it 60–90 seconds.`,
    whyCompany: `Name one specific thing about ${ctx.company} (product, market, recent news). Connect it to your experience in ${ctx.skills.slice(0, 2).join(" and ")}. End with what you want to build there.`,
    whyRole: `Map the JD to your proof: ${ctx.technologies.filter((t) => ctx.skills.includes(t)).slice(0, 3).join(", ") || ctx.skills.slice(0, 3).join(", ")}. Mention one requirement you're eager to grow into — honestly.`,
    behavioral: behavioralQs.map((q) => {
      const [s] = retrieveStories(q, ctx.stories, 1);
      return { question: q, storyTitle: s?.title ?? "Добавьте STAR-историю в профиль", outline: s ? `S: ${s.situation}\nT: ${s.task}\nA: ${s.action}\nR: ${s.result}` : "Нет подходящей подтверждённой истории" };
    }),
    technicalTopics: [...ctx.technologies.slice(0, 4).map((t) => ({ topic: t, why: "Указано в описании вакансии", prep: ctx.skills.includes(t) ? "Повторите 2 рабочих примера и типичные вопросы" : "Нет в профиле — готовьте честный ответ и ближайший аналог" })), ...(ROUND_TOPICS[ctx.round] ?? []).map((t) => ({ topic: t, why: `Типично для раунда ${ctx.round}`, prep: "Подготовьте 1 историю и 1 вопрос" }))],
    questionsToAsk: ["What does success look like in the first 90 days?", "What is the biggest challenge the team faces this quarter?", "How does this role work with product/engineering?", "What does the interview process look like from here?", "What do the best people on this team do differently?", `What's ${ctx.company}'s biggest priority for this year?`],
    redFlags: [ctx.yearsExperience < 2 ? "Не преувеличивайте стаж — говорите о глубине задач" : "Готовьтесь к вопросам о масштабе", "Не называйте цифру зарплаты первым без вилки"],
  };
}

// ——— Mock interview ———
export const MOCK_QUESTIONS: Record<string, string[]> = {
  recruiter: ["Tell me about yourself.", "Why are you interested in this role?", "Why do you want to leave your current position?", "What are your salary expectations?", "When could you start?"],
  hiring_manager: ["Walk me through the project you're most proud of.", "Tell me about a time you had a disagreement with your manager.", "How do you prioritize when everything is urgent?", "Tell me about a failure and what you learned.", "What would you do in your first 90 days?"],
  technical: ["How would you find the top 3 customers by revenue per month in SQL?", "How would you design an A/B test for a new onboarding flow?", "Explain the difference between a LEFT JOIN and an INNER JOIN.", "Daily active users dropped 15% yesterday — how do you investigate?", "How do you make sure your analysis is correct?"],
};

const FILLERS = /\b(um+|uh+|like|you know|basically|actually|sort of|kind of|ну|типа|как бы|короче|в общем)\b/gi;

export function scoreAnswer(question: string, answer: string, ctx: { skills: string[]; jdTerms: string[] }) {
  const words = answer.trim().split(/\s+/).filter(Boolean);
  const n = words.length;
  const fillers = answer.match(FILLERS)?.length ?? 0;
  const intent = detectIntent(question);
  const hasNumber = /\d/.test(answer);
  const star = { s: /(situation|context|when i|at my|we had|в компании|была ситуация)/i.test(answer), t: /(task|goal|needed to|responsible|задач|цель)/i.test(answer), a: /\b(i (built|led|analy[sz]ed|created|proposed|wrote|designed|decided|implemented))|я (сделал|построил|предложил|проанализировал)/i.test(answer), r: /(result|outcome|increased|reduced|improved|grew|saved|в итоге|результат)/i.test(answer) };
  const starScore = Object.values(star).filter(Boolean).length / 4;
  const relevance = ctx.jdTerms.filter((t) => answer.toLowerCase().includes(t.toLowerCase())).length;
  const lengthScore = n < 40 ? 40 : n <= 220 ? 100 : n <= 320 ? 70 : 45;
  const clarity = Math.max(0, 100 - fillers * 12 - (answer.match(/[^.!?]{220,}/g)?.length ?? 0) * 15);
  const structure = intent === "behavioral" || intent === "leadership" ? Math.round(starScore * 100) : /first|second|then|finally|во-первых|затем/i.test(answer) ? 85 : 60;
  const confidence = Math.max(20, 100 - (answer.match(/\b(i think maybe|i guess|not sure|probably|наверное|не уверен)\b/gi)?.length ?? 0) * 20 - fillers * 5);
  const content = Math.min(100, 45 + (hasNumber ? 25 : 0) + relevance * 10 + (/\bi\b|я /i.test(answer) ? 10 : 0));
  const overall = Math.round((content * 0.3 + structure * 0.2 + clarity * 0.15 + lengthScore * 0.15 + confidence * 0.1 + Math.min(100, relevance * 25) * 0.1));
  const tips: string[] = [];
  if (!hasNumber) tips.push("Добавьте одну цифру результата (было → стало).");
  if ((intent === "behavioral" || intent === "leadership") && starScore < 0.75) tips.push(`STAR неполный: не хватает ${Object.entries(star).filter(([, v]) => !v).map(([k]) => k.toUpperCase()).join(", ")}.`);
  if (n > 220) tips.push("Слишком длинно — уложитесь в 60–120 секунд.");
  if (n < 40) tips.push("Слишком коротко — раскройте своё конкретное действие.");
  if (fillers > 2) tips.push(`Слова-паразиты: ${fillers}. Делайте паузу вместо «um/like».`);
  if (!relevance) tips.push("Свяжите ответ с требованиями вакансии.");
  return { overall, content, structure, clarity, length: lengthScore, confidence, fillers, words: n, star, tips, intent };
}
