import { retrieveStories, scaffold, type FactLite, type Pack, type StoryLite } from "@/lib/engine/interview";
import { achievementClause, achievementLines, possessive } from "@/lib/engine/personalize";

// "Most likely questions". Answer text (opener + points) is English, the interview language, and is assembled
// only from the candidate's own stories and facts. Coaching lives separately in `tips` (Russian, «ты»).

export type LikelyCtx = {
  stories: StoryLite[];
  facts: FactLite[];
  skills: string[];
  yearsExperience: number;
  company: string;
  role: string;
  round: string;
  technologies: string[];
  salary?: { low: number; high: number };
  companyWhat?: string;
};

export type Likely = {
  q: string;
  why: string;
  opener: string;
  points: { k?: string; v: string }[];
  tips?: string[];
  story?: { title: string; metric: string };
  timing: string;
};

const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
/** "Data Analyst" → "data analyst", "QA Engineer" → "QA engineer". */
const roleNoun = (t: string) => t.split(/\s+/).map((w) => (/^[A-Z][a-z]/.test(w) ? w.toLowerCase() : w)).join(" ");
const article = (w: string) => (/^[aeiou]/i.test(w) && !/^(uni|use|eu)/i.test(w) ? "an" : "a");
const years = (n: number) => (n >= 1 ? `${n % 1 === 0 ? n : n.toFixed(1)} ${n === 1 ? "year" : "years"}` : "");

/** The line of a fact that carries its metric (or its first line), as a clause after "I". */
function factClause(f: FactLite | undefined): string | null {
  if (!f) return null;
  const lines = achievementLines(f.details);
  const line = (f.metrics && lines.find((l) => l.includes(f.metrics))) || f.metrics || lines[0];
  return line ? achievementClause(line) : null;
}

/** Present → Past → Future, filled from the profile. */
function intro(ctx: LikelyCtx): Pick<Likely, "opener" | "points" | "tips"> {
  const jobs = ctx.facts.filter((f) => f.kind === "employment");
  const [now, prev] = jobs;
  const edu = ctx.facts.find((f) => f.kind === "education");
  const noun = roleNoun(now?.title || ctx.role);
  const exp = years(ctx.yearsExperience);
  const opener = `I'm ${article(noun)} ${noun}${exp ? ` with ${exp} of hands-on experience` : ""}.`;
  const tools = ctx.skills.slice(0, 3);

  const nowClause = factClause(now);
  const present = now
    ? `Right now I work as ${article(now.title)} ${now.title}${now.org ? ` at ${now.org}` : ""}${tools.length ? `, mostly with ${list(tools)}` : ""}.${nowClause ? ` Recently I ${nowClause}.` : ""}`
    : `I work mostly with ${list(tools) || "data"}, and I've built my experience through hands-on projects.`;

  const prevClause = factClause(prev);
  const past = prev
    ? `Before that I was ${article(prev.title)} ${prev.title}${prev.org ? ` at ${prev.org}` : ""}${prevClause ? `, where I ${prevClause}` : ""}.`
    : edu
      ? `I studied ${edu.title}${edu.org ? ` at ${edu.org}` : ""}, which is where I started working with data.`
      : "";

  const future = `Now I want to take that further, and the ${ctx.role} role at ${ctx.company} is the logical next step for me.`;

  return {
    opener,
    points: [{ k: "Present", v: present }, ...(past ? [{ k: "Past", v: past }] : []), { k: "Future", v: future }],
    tips: ["Порядок Present → Past → Future, 60–90 секунд.", "Одной цифры достаточно — не пересказывай всё резюме."],
  };
}

function storyAnswer(q: string, ctx: LikelyCtx, tips: string[]): Pick<Likely, "opener" | "points" | "story" | "tips"> {
  const [s] = retrieveStories(q, ctx.stories, 1);
  if (!s) {
    const sc = scaffold(q, ctx);
    return { opener: sc.opener, points: sc.bullets.map((v) => ({ v })), tips: ["Подходящей STAR-истории пока нет — добавь её в Career Profile.", ...tips] };
  }
  return {
    opener: `A good example is ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}.`,
    points: [
      { k: "Situation", v: short(s.situation) },
      { k: "Task", v: short(s.task) },
      { k: "Action", v: short(s.action) },
      { k: "Result", v: short(s.result) },
    ],
    story: { title: s.title, metric: s.metric },
  };
}

export function buildLikely(_pack: Pack | null, ctx: LikelyCtx): Likely[] {
  const topFact = ctx.facts.find((f) => f.kind === "employment");
  const topClause = factClause(topFact);
  const matched = ctx.technologies.filter((t) => ctx.skills.some((s) => s.toLowerCase() === t.toLowerCase()));
  const toGrow = ctx.technologies.filter((t) => !matched.includes(t));
  const tools = matched.length ? matched.slice(0, 3) : ctx.skills.slice(0, 3);
  const proof = topClause ? { k: "Proof", v: `At ${topFact?.org || "my current job"}, I ${topClause}.` } : null;

  const items: Likely[] = [
    {
      q: "Tell me about yourself.",
      why: "Открывает почти каждый раунд — задаёт тон всему разговору.",
      ...intro(ctx),
      timing: "60–90 сек",
    },
    {
      q: `Why ${ctx.company}?`,
      why: "Проверяют, что твой выбор осознанный, а не массовая рассылка резюме.",
      opener: `What draws me to ${ctx.company} is…`,
      points: [
        ...(tools.length ? [{ k: "Fit", v: `My day-to-day work with ${list(tools)} maps directly onto what the team needs.` }] : []),
        ...(proof ? [proof] : []),
        { k: "Future", v: `I'd like to build on that at ${ctx.company} and grow with the product.` },
      ],
      tips: [
        `Начни с одного конкретного факта про ${ctx.company}: продукт, рынок или свежая новость.`,
        ...(ctx.companyWhat ? [`Из Brief: ${short(ctx.companyWhat, 160)}`] : []),
      ],
      timing: "45–60 сек",
    },
    {
      q: "Why this role?",
      why: "Хотят услышать связку: требования роли → твой опыт → чему хочешь научиться.",
      opener: `The ${ctx.role} role sits right where my experience is strongest.`,
      points: [
        { k: "Fit", v: tools.length ? `I already work with ${list(tools)} every day.` : "The core of the role is what I already do every day." },
        ...(proof ? [proof] : []),
        ...(toGrow.length ? [{ k: "Growth", v: `I'd also like to go deeper into ${list(toGrow.slice(0, 2))}.` }] : []),
      ],
      tips: toGrow.length ? undefined : ["Добавь, что хочешь взять на себя в первые 6 месяцев."],
      timing: "45 сек",
    },
    {
      q: "Tell me about a difficult analytical problem you solved.",
      why: "Проверяют, как ты думаешь: постановка, гипотезы, проверка, влияние на решение.",
      ...storyAnswer("difficult analytical problem data analysis insight impact decision", ctx, ["Структура: контекст → гипотезы → проверка данными → решение и цифра результата."]),
      timing: "90–120 сек",
    },
    {
      q: "How do you prioritize conflicting requests from stakeholders?",
      why: "Запросов всегда больше, чем времени — важно, как ты договариваешься.",
      opener: "I start by making the trade-off visible instead of silently picking one.",
      points: [
        { k: "Frame", v: "I score every request by impact, urgency and effort in one shared table." },
        { k: "Align", v: "If priorities conflict, I agree the order with my manager." },
        { k: "Communicate", v: "I tell stakeholders the timelines and what moves as a result." },
        ...(() => {
          const [s] = retrieveStories("disagree conflict stakeholder deadline priority", ctx.stories, 1);
          return s ? [{ k: "Example", v: short(s.title) }] : [];
        })(),
      ],
      timing: "60–90 сек",
    },
  ];

  const sql = ctx.technologies.some((t) => /sql/i.test(t));
  const extra: Record<string, Likely> = {
    recruiter: {
      q: "What are your salary expectations?",
      why: "На Recruiter-звонке спрашивают почти всегда.",
      opener: "Based on the scope and market data, I'm targeting…",
      points: ctx.salary
        ? [{ k: "Range", v: `$${Math.round(ctx.salary.low / 1000)}k–$${Math.round(ctx.salary.high / 1000)}k base.` }, { v: "I'm flexible on the overall package: bonus, learning budget, remote." }]
        : [{ v: "I'd love to hear the budgeted range for the role first." }, { v: "I'm flexible on the overall package." }],
      tips: ["Если можно — сначала спроси их бюджет.", "Называй диапазон, а не одну цифру."],
      timing: "20 сек",
    },
    hiring_manager: {
      q: "Tell me about a time you disagreed with your manager.",
      why: "Hiring Manager проверяет, как ты споришь и договариваешься.",
      ...storyAnswer("disagreement with manager conflict", ctx, ["Структура: суть разногласия → аргументы данными → чем закончилось → какой вывод из этого следует."]),
      timing: "90 сек",
    },
    technical: {
      q: sql ? "How would you find the top 3 customers by revenue each month in SQL?" : `How would you approach a typical ${ctx.technologies[0] ?? "technical"} task in this role?`,
      why: "Live-задача по ключевому навыку из вакансии.",
      opener: sql ? "Let me clarify the tables and the grain first." : "Let me clarify the requirement first.",
      points: sql
        ? [{ v: "Clarify the schema and what counts as revenue." }, { v: "Aggregate revenue by customer and month." }, { v: "ROW_NUMBER() OVER (PARTITION BY month ORDER BY revenue DESC)" }, { v: "Filter rn ≤ 3 and check how ties are handled." }]
        : [{ v: "Clarify the requirement and the expected output." }, { v: "Walk through the approach step by step." }, { v: "Name one trade-off and one edge case." }],
      tips: ["Думай вслух: интервьюеру важен ход решения, а не только ответ."],
      timing: "5–10 мин",
    },
    final: {
      q: "Where do you see yourself in three years?",
      why: "Final round проверяет долгосрочную мотивацию и совпадение с траекторией компании.",
      opener: `In three years I'd like to own a meaningful part of ${possessive(ctx.company)} ${roleNoun(ctx.role)} work.`,
      points: [{ v: "Growing in depth: harder problems and more ownership." }, { v: `Tying my work to where ${ctx.company} is heading.` }, { v: "Being honest about what I still want to learn." }],
      timing: "45 сек",
    },
  };
  if (extra[ctx.round]) items.push(extra[ctx.round]);
  return items;
}
