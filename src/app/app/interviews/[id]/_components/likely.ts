import { englishTitle, retrieveStories, scaffold, type FactLite, type Pack, type StoryLite } from "@/lib/engine/interview";
import { hasCyrillic, jdSkillsYouHave, latinName } from "@/lib/engine/taxonomy";
import { achievementClause, achievementLines, possessive } from "@/lib/engine/personalize";
import { createTranslator, type Messages, type T } from "@/lib/i18n/translator";
import { interviewsPageRu } from "@/lib/i18n/dictionaries/ru/interviews-page";

// «Скорее всего спросят». Answer text (opener + points) is English, the interview language, and is assembled
// only from the candidate's own stories and facts. Coaching (`why`, `tips`, `timing`, point labels `k`) is UI copy in
// the interface language: pass the page's `t`; without it the Russian copy is used (the original output).
const RU: T = createTranslator("ru", { interviewsPage: interviewsPageRu } as Messages);

export type LikelyCtx = {
  stories: StoryLite[];
  facts: FactLite[];
  skills: string[];
  yearsExperience: number;
  company: string;
  role: string;
  round: string;
  technologies: string[];
  /** The vacancy text (description + requirements): skills it names count as «what they need» too. */
  jdText?: string;
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
  /** The company-overview line (brief content, stored in Russian) — set instead of a tip when `t` isn't Russian. */
  briefQuote?: string;
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

/** «I studied X at Y, …» — a Cyrillic degree title is left out rather than spliced into English. */
function eduLine(edu: FactLite, org: (o: string | null | undefined) => string) {
  const title = hasCyrillic(edu.title) ? "" : edu.title;
  if (!title && !edu.org) return "";
  return `I studied${title ? ` ${title}` : ""}${edu.org ? ` at ${org(edu.org)}` : ""}, which is where I started working with data.`;
}

/** Present → Past → Future, filled from the profile. */
function intro(ctx: LikelyCtx, t: T): Pick<Likely, "opener" | "points" | "tips"> {
  const jobs = ctx.facts.filter((f) => f.kind === "employment");
  const [now, prev] = jobs;
  const edu = ctx.facts.find((f) => f.kind === "education");
  // English answer text: a Cyrillic CV title becomes English («Аналитик данных» → "Data Analyst"), an org is transliterated.
  const nowTitle = now ? englishTitle(now.title, ctx.role) : "";
  const prevTitle = prev ? englishTitle(prev.title, ctx.role) : "";
  const org = (o: string | null | undefined) => (o ? latinName(o) : "");
  const noun = roleNoun(nowTitle || ctx.role);
  const exp = years(ctx.yearsExperience);
  const opener = `I'm ${article(noun)} ${noun}${exp ? ` with ${exp} of hands-on experience` : ""}.`;
  const tools = ctx.skills.slice(0, 3);

  const nowClause = factClause(now);
  const present = now
    ? `Right now I work as ${article(nowTitle)} ${nowTitle}${now.org ? ` at ${org(now.org)}` : ""}${tools.length ? `, mostly with ${list(tools)}` : ""}.${nowClause ? ` Recently I ${nowClause}.` : ""}`
    : `I work mostly with ${list(tools) || "data"}, and I've built my experience through hands-on projects.`;

  const prevClause = factClause(prev);
  const past = prev
    ? `Before that I was ${article(prevTitle)} ${prevTitle}${prev.org ? ` at ${org(prev.org)}` : ""}${prevClause ? `, where I ${prevClause}` : ""}.`
    : edu
      ? eduLine(edu, org)
      : "";

  const future = `Now I want to take that further, and the ${ctx.role} role at ${ctx.company} is the logical next step for me.`;

  return {
    opener,
    points: [{ k: t("interviewsPage.likely.k.now"), v: present }, ...(past ? [{ k: t("interviewsPage.likely.k.before"), v: past }] : []), { k: t("interviewsPage.likely.k.next"), v: future }],
    tips: [t("interviewsPage.likely.tips.introOrder"), t("interviewsPage.likely.tips.introOneNumber")],
  };
}

function storyAnswer(q: string, ctx: LikelyCtx, tips: string[], t: T): Pick<Likely, "opener" | "points" | "story" | "tips"> {
  const [s] = retrieveStories(q, ctx.stories, 1);
  if (!s) {
    const sc = scaffold(q, ctx);
    return { opener: sc.opener, points: sc.bullets.map((v) => ({ v })), tips: [t("interviewsPage.likely.tips.noStory"), ...tips] };
  }
  return {
    opener: `A good example is ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}.`,
    points: [
      { k: t("interviewsPage.likely.k.situation"), v: short(s.situation) },
      { k: t("interviewsPage.likely.k.task"), v: short(s.task) },
      { k: t("interviewsPage.likely.k.action"), v: short(s.action) },
      { k: t("interviewsPage.likely.k.result"), v: short(s.result) },
    ],
    story: { title: s.title, metric: s.metric },
  };
}

export function buildLikely(_pack: Pack | null, ctx: LikelyCtx, tr?: T): Likely[] {
  const t = tr ?? RU;
  const secs = (range: string) => t("interviewsPage.likely.secs", { range });
  // The company overview is Russian brief content: a tip in Russian, a separate quote (lang="ru") otherwise.
  const quoteAsTip = t.locale === "ru";
  const topFact = ctx.facts.find((f) => f.kind === "employment");
  const topClause = factClause(topFact);
  // Only the user's skills this vacancy asks for (jdSkillsYouHave) — never a profile skill the JD doesn't mention.
  const matched = jdSkillsYouHave(ctx.skills, ctx.technologies, ctx.jdText ?? "");
  const toGrow = ctx.technologies.filter((x) => !matched.some((m) => m.toLowerCase() === x.toLowerCase()));
  const tools = matched.slice(0, 3);
  const proof = topClause ? { k: t("interviewsPage.likely.k.proof"), v: `At ${topFact?.org ? latinName(topFact.org) : "my current job"}, I ${topClause}.` } : null;

  const items: Likely[] = [
    {
      q: "Tell me about yourself.",
      why: t("interviewsPage.likely.why.intro"),
      ...intro(ctx, t),
      timing: secs("60–90"),
    },
    {
      q: `Why ${ctx.company}?`,
      why: t("interviewsPage.likely.why.whyCompany"),
      opener: `What draws me to ${ctx.company} is…`,
      points: [
        ...(tools.length ? [{ k: t("interviewsPage.likely.k.experience"), v: `My day-to-day work with ${list(tools)} maps directly onto what the team needs.` }] : []),
        ...(proof ? [proof] : []),
        { k: t("interviewsPage.likely.k.next"), v: `I'd like to build on that at ${ctx.company} and grow with the product.` },
      ],
      tips: [
        t("interviewsPage.likely.tips.companyFact", { company: ctx.company }),
        ...(ctx.companyWhat && quoteAsTip ? [t("interviewsPage.likely.tips.fromBrief", { text: short(ctx.companyWhat, 160) })] : []),
      ],
      ...(ctx.companyWhat && !quoteAsTip ? { briefQuote: short(ctx.companyWhat, 160) } : {}),
      timing: secs("45–60"),
    },
    {
      q: "Why this role?",
      why: t("interviewsPage.likely.why.whyRole"),
      opener: `The ${ctx.role} role sits right where my experience is strongest.`,
      points: [
        { k: t("interviewsPage.likely.k.experience"), v: tools.length ? `I already work with ${list(tools)} every day.` : "The core of the role is what I already do every day." },
        ...(proof ? [proof] : []),
        ...(toGrow.length ? [{ k: t("interviewsPage.likely.k.growth"), v: `I'd also like to go deeper into ${list(toGrow.slice(0, 2))}.` }] : []),
      ],
      tips: toGrow.length ? undefined : [t("interviewsPage.likely.tips.firstMonths")],
      timing: secs("45"),
    },
    {
      q: "Tell me about a difficult analytical problem you solved.",
      why: t("interviewsPage.likely.why.problem"),
      ...storyAnswer("difficult analytical problem data analysis insight impact decision", ctx, [t("interviewsPage.likely.tips.problemStructure")], t),
      timing: secs("90–120"),
    },
    {
      q: "How do you prioritize conflicting requests from stakeholders?",
      why: t("interviewsPage.likely.why.prioritize"),
      opener: "I start by making the trade-off visible instead of silently picking one.",
      points: [
        { k: t("interviewsPage.likely.k.scoring"), v: "I score every request by impact, urgency and effort in one shared table." },
        { k: t("interviewsPage.likely.k.alignment"), v: "If priorities conflict, I agree the order with my manager." },
        { k: t("interviewsPage.likely.k.communication"), v: "I tell stakeholders the timelines and what moves as a result." },
        ...(() => {
          const [s] = retrieveStories("disagree conflict stakeholder deadline priority", ctx.stories, 1);
          return s ? [{ k: t("interviewsPage.likely.k.example"), v: short(s.title) }] : [];
        })(),
      ],
      timing: secs("60–90"),
    },
  ];

  const sql = ctx.technologies.some((x) => /sql/i.test(x));
  const extra: Record<string, Likely> = {
    recruiter: {
      q: "What are your salary expectations?",
      why: t("interviewsPage.likely.why.salary"),
      opener: "Based on the scope and market data, I'm targeting…",
      points: ctx.salary
        ? [{ k: t("interviewsPage.likely.k.range"), v: `$${Math.round(ctx.salary.low / 1000)}k–$${Math.round(ctx.salary.high / 1000)}k base.` }, { v: "I'm flexible on the overall package: bonus, learning budget, remote." }]
        : [{ v: "I'd love to hear the budgeted range for the role first." }, { v: "I'm flexible on the overall package." }],
      tips: [t("interviewsPage.likely.tips.askBudget"), t("interviewsPage.likely.tips.range")],
      timing: secs("20"),
    },
    hiring_manager: {
      q: "Tell me about a time you disagreed with your manager.",
      why: t("interviewsPage.likely.why.disagree"),
      ...storyAnswer("disagreement with manager conflict", ctx, [t("interviewsPage.likely.tips.disagreeStructure")], t),
      timing: secs("90"),
    },
    technical: {
      q: sql ? "How would you find the top 3 customers by revenue each month in SQL?" : `How would you approach a typical ${ctx.technologies[0] ?? "technical"} task in this role?`,
      why: t("interviewsPage.likely.why.technical"),
      opener: sql ? "Let me clarify the tables and the grain first." : "Let me clarify the requirement first.",
      points: sql
        ? [{ v: "Clarify the schema and what counts as revenue." }, { v: "Aggregate revenue by customer and month." }, { v: "ROW_NUMBER() OVER (PARTITION BY month ORDER BY revenue DESC)" }, { v: "Filter rn ≤ 3 and check how ties are handled." }]
        : [{ v: "Clarify the requirement and the expected output." }, { v: "Walk through the approach step by step." }, { v: "Name one trade-off and one edge case." }],
      tips: [t("interviewsPage.likely.tips.thinkAloud")],
      timing: t("interviewsPage.likely.mins", { range: "5–10" }),
    },
    final: {
      q: "Where do you see yourself in three years?",
      why: t("interviewsPage.likely.why.future"),
      opener: `In three years I'd like to own a meaningful part of ${possessive(ctx.company)} ${roleNoun(ctx.role)} work.`,
      points: [{ v: "Growing in depth: harder problems and more ownership." }, { v: `Tying my work to where ${ctx.company} is heading.` }, { v: "Being honest about what I still want to learn." }],
      timing: secs("45"),
    },
  };
  if (extra[ctx.round]) items.push(extra[ctx.round]);
  return items;
}
