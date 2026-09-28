import { retrieveStories, scaffold, type FactLite, type Pack, type StoryLite } from "@/lib/engine/interview";

// "Most likely questions" — each answer is assembled from the candidate's own stories, facts and pack.

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
  story?: { title: string; metric: string };
  timing: string;
};

const short = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

/** "Present: …\nPast: …" → labelled points. */
const packLines = (text: string | undefined) =>
  (text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^([A-Za-zА-Яа-я ]{1,14}):\s*(.*)$/);
      return m ? { k: m[1], v: m[2] } : { v: l };
    });

function storyAnswer(q: string, ctx: LikelyCtx, fallbackPoints: string[]): Pick<Likely, "opener" | "points" | "story"> {
  const [s] = retrieveStories(q, ctx.stories, 1);
  if (!s) {
    const sc = scaffold(q, ctx);
    return { opener: sc.opener || "Хороший пример из моей практики…", points: (sc.bullets.length ? sc.bullets : fallbackPoints).map((v) => ({ v })) };
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

export function buildLikely(pack: Pack | null, ctx: LikelyCtx): Likely[] {
  const intro = scaffold("Tell me about yourself", ctx);
  const why = scaffold("Why do you want to work at our company?", ctx);
  const topFact = ctx.facts.find((f) => f.kind === "employment");
  const matched = ctx.technologies.filter((t) => ctx.skills.some((s) => s.toLowerCase() === t.toLowerCase()));
  const toGrow = ctx.technologies.filter((t) => !matched.includes(t));

  const list: Likely[] = [
    {
      q: "Tell me about yourself.",
      why: "Открывает почти каждый раунд — задаёт тон всему разговору.",
      opener: topFact ? `I'm a ${topFact.title.toLowerCase()} with ${ctx.yearsExperience} ${ctx.yearsExperience === 1 ? "year" : "years"} of hands-on experience.` : intro.opener,
      points: pack?.tellMeAboutYourself ? packLines(pack.tellMeAboutYourself) : intro.bullets.map((v) => ({ v })),
      timing: "60–90 сек",
    },
    {
      q: `Why ${ctx.company}?`,
      why: "Проверяют, что вы выбрали их осознанно, а не рассылаете резюме всем.",
      opener: `What draws me to ${ctx.company} is…`,
      points: [
        ...(ctx.companyWhat ? [{ k: "Company", v: short(ctx.companyWhat, 140) }] : []),
        ...(pack?.whyCompany ? packLines(pack.whyCompany) : why.bullets.map((v) => ({ v }))),
      ].slice(0, 4),
      timing: "45–60 сек",
    },
    {
      q: "Why this role?",
      why: "Хотят услышать связку: требования роли → ваш опыт → чему хотите научиться.",
      opener: `The ${ctx.role} role sits right where my experience is strongest.`,
      points: [
        matched.length ? { k: "Fit", v: `Уже работаю с ${matched.slice(0, 3).join(", ")}` } : { k: "Fit", v: `Ваш опыт с ${ctx.skills.slice(0, 3).join(", ") || "данными"}` },
        topFact ? { k: "Proof", v: short(`${topFact.title}${topFact.org ? ` в ${topFact.org}` : ""}${topFact.metrics ? ` — ${topFact.metrics}` : ""}`) } : { k: "Proof", v: "Один проект, где вы делали то же, что в вакансии" },
        toGrow.length ? { k: "Growth", v: `Хочу глубже освоить ${toGrow.slice(0, 2).join(" и ")}` } : { k: "Growth", v: "Что хотите взять на себя в первые 6 месяцев" },
      ],
      timing: "45 сек",
    },
    {
      q: "Tell me about a difficult analytical problem you solved.",
      why: "Проверяют, как вы думаете: постановка, гипотезы, проверка, влияние на решение.",
      ...storyAnswer("difficult analytical problem data analysis insight impact decision", ctx, ["Контекст и почему было сложно", "Как разложили задачу на гипотезы", "Как проверили данными", "Какое решение приняли и цифра результата"]),
      timing: "90–120 сек",
    },
    {
      q: "How do you prioritize conflicting requests from stakeholders?",
      why: "В аналитике запросов всегда больше, чем времени — важно, как вы договариваетесь.",
      opener: "I start by making the trade-off visible instead of silently picking one.",
      points: [
        { k: "Frame", v: "Impact × срочность × усилия — одна таблица для всех запросов" },
        { k: "Align", v: "Согласую порядок с менеджером, если приоритеты конфликтуют" },
        { k: "Communicate", v: "Сообщаю стейкхолдерам сроки и что сдвигается" },
        ...(() => {
          const [s] = retrieveStories("disagree conflict stakeholder deadline priority", ctx.stories, 1);
          return s ? [{ k: "Example", v: short(s.title) }] : [];
        })(),
      ],
      timing: "60–90 сек",
    },
  ];

  const extra: Record<string, Likely> = {
    recruiter: {
      q: "What are your salary expectations?",
      why: "На Recruiter-звонке спрашивают почти всегда.",
      opener: "Based on the scope and market data, I'm targeting…",
      points: ctx.salary
        ? [{ k: "Range", v: `$${Math.round(ctx.salary.low / 1000)}k–$${Math.round(ctx.salary.high / 1000)}k base` }, { v: "Гибко по пакету целиком: бонус, обучение, remote" }, { v: "Если возможно — сначала спросите их бюджет" }]
        : [{ v: "Сначала спросите бюджет роли" }, { v: "Назовите диапазон, а не одну цифру" }],
      timing: "20 сек",
    },
    hiring_manager: {
      q: "Tell me about a time you disagreed with your manager.",
      why: "Hiring Manager проверяет, как вы спорите и договариваетесь.",
      ...storyAnswer("disagreement with manager conflict", ctx, ["Суть разногласия", "Как аргументировали данными", "Чем закончилось", "Что вынесли"]),
      timing: "90 сек",
    },
    technical: {
      q: ctx.technologies.some((t) => /sql/i.test(t)) ? "How would you find the top 3 customers by revenue each month in SQL?" : `How would you approach a typical ${ctx.technologies[0] ?? "technical"} task in this role?`,
      why: "Live-задача по ключевому навыку из вакансии.",
      opener: "Let me clarify the tables and the grain first.",
      points: [{ v: "Уточните схему и что значит «revenue»" }, { v: "Агрегат по клиенту и месяцу" }, { v: "ROW_NUMBER() OVER (PARTITION BY month ORDER BY revenue DESC)" }, { v: "Фильтр rn ≤ 3, проверка на ничьи" }],
      timing: "5–10 мин",
    },
    final: {
      q: "Where do you see yourself in three years?",
      why: "Final round проверяет долгосрочную мотивацию и совпадение с траекторией компании.",
      opener: `In three years I'd like to own a meaningful part of ${ctx.company}'s analytics.`,
      points: [{ v: "Рост в глубину: сложнее задачи, больше влияния" }, { v: "Связь с направлением компании" }, { v: "Честно: чему хотите научиться" }],
      timing: "45 сек",
    },
  };
  if (extra[ctx.round]) list.push(extra[ctx.round]);
  return list;
}
