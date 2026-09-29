// Career strengths: themes that recur across the user's own experience, results and skills.
// Derived only from what is in the profile — each strength points at the positions it comes from.

type FactIn = { kind: string; title: string; org: string; details: string; metrics: string; tech: string; ownership: string; teamSize: number | null };
/** `key` names the theme for the UI (profilePage.strengths.themes); `label`/`metric` stay the Russian text. `teamSize`
 * (team leadership only) lets the UI say «Команда до N человек» in the current language. */
export type Strength = { key: StrengthKey; label: string; evidence: string[]; metric: string; teamSize?: number };
export type StrengthKey = "productAnalytics" | "segmentation" | "experiments" | "dataViz" | "sqlModeling" | "automation" | "ml" | "growth" | "research" | "stakeholders" | "software" | "customers" | "operations" | "leadership";

const THEMES: { key: StrengthKey; label: string; re: RegExp }[] = [
  { key: "productAnalytics", label: "Продуктовая аналитика", re: /product analytics|amplitude|mixpanel|funnel|воронк|retention|удержан|activation|активац|conversion|конверси/i },
  { key: "segmentation", label: "Сегментация клиентов", re: /segment|сегмент|cohort|когорт|rfm|ltv|clv|персонализ/i },
  { key: "experiments", label: "Эксперименты и A/B-тесты", re: /a\/b|ab[- ]?test|experiment|эксперимент|hypothes|гипотез/i },
  { key: "dataViz", label: "Визуализация данных и дашборды", re: /tableau|power bi|looker|metabase|dashboard|дашборд|отчётност|reporting/i },
  { key: "sqlModeling", label: "SQL и моделирование данных", re: /\bsql\b|postgres|clickhouse|bigquery|snowflake|\bdbt\b|etl|data model|витрин/i },
  { key: "automation", label: "Автоматизация", re: /automat|автоматиз|airflow|script|скрипт|pipeline|пайплайн/i },
  { key: "ml", label: "Машинное обучение", re: /machine learning|\bml\b|scikit|pytorch|tensorflow|прогноз|forecast|model(?:ing|s)?\b/i },
  { key: "growth", label: "Рост и монетизация", re: /revenue|выручк|monetiz|монетиз|growth|\barpu\b|pricing|ценообраз|продаж/i },
  { key: "research", label: "Продуктовые исследования", re: /user research|custdev|discovery|interview(?:s|ed) users|исследован|roadmap|роадмап|прототип|prototype/i },
  { key: "stakeholders", label: "Работа со стейкхолдерами", re: /stakeholder|стейкхолдер|cross-functional|кросс-функц|c-level|руководств|презентовал|presented/i },
  { key: "software", label: "Разработка ПО", re: /react|node\.?js|typescript|backend|frontend|\bapi\b|microservice|микросервис|deploy|релиз/i },
  { key: "customers", label: "Работа с клиентами", re: /customer success|support|поддержк|\bnps\b|csat|клиентск/i },
  { key: "operations", label: "Операции и процессы", re: /process improvement|оптимизир|operations|операцион|sla|логистик|supply/i },
];

const LEAD_TITLE = /(?<![\p{L}])(team\s*lead|tech\s*lead|lead|head|manager|director|chief|руководител\p{L}*|тимлид|лид|начальник|директор|менеджер)(?![\p{L}])/iu;
const TEAM_EVIDENCE = /(?<![\p{L}])(managed (?:a |the )?team|led (?:a |the )?team|team of \d+|managing \d+|direct reports?|hired (?:and|&) (?:mentored|trained)|mentored \d+|руководил\p{L}* (?:команд|отдел|групп)|управлял\p{L}* (?:команд|отдел|групп)|команд\p{L}* из \d+|в подчинении|нанимал\p{L}*)/iu;

export function deriveStrengths(facts: FactIn[], skills: string[]): Strength[] {
  const work = facts.filter((f) => ["employment", "project", "achievement"].includes(f.kind));
  const skillText = skills.join(" ");
  const out: (Strength & { score: number })[] = [];

  for (const t of THEMES) {
    const hits = work.filter((f) => t.re.test(`${f.title} ${f.details} ${f.metrics} ${f.tech}`));
    const inSkills = t.re.test(skillText);
    if (!hits.length && !inSkills) continue;
    // Only cite a result that is itself about this theme.
    const withMetric = hits.find((f) => f.metrics && t.re.test(f.metrics));
    out.push({
      key: t.key,
      label: t.label,
      evidence: [...new Set(hits.map((f) => (f.org ? `${f.title} · ${f.org}` : f.title)))].slice(0, 2),
      metric: withMetric?.metrics ?? "",
      score: hits.length * 2 + (withMetric ? 3 : 0) + (inSkills ? 1 : 0),
    });
  }

  // «Руководство командой» needs a management title or management written in the role itself. Ownership "led"
  // («Самостоятельно» — the decisions were mine) is about autonomy, not about managing people.
  const led = work.filter((f) => LEAD_TITLE.test(f.title) || TEAM_EVIDENCE.test(`${f.details} ${f.metrics}`));
  if (led.length) {
    const team = Math.max(0, ...led.map((f) => f.teamSize ?? 0));
    out.push({ key: "leadership", label: "Руководство командой", evidence: led.map((f) => (f.org ? `${f.title} · ${f.org}` : f.title)).slice(0, 2), metric: team ? `Команда до ${team} человек` : "", ...(team ? { teamSize: team } : {}), score: led.length * 2 + (team ? 2 : 0) });
  }

  return out.filter((x) => x.evidence.length || x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 6).map(({ score: _score, ...s }) => (void _score, s));
}
