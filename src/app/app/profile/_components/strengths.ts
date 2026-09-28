// Career strengths: themes that recur across the user's own experience, results and skills.
// Derived only from what is in the profile — each strength points at the positions it comes from.

type FactIn = { kind: string; title: string; org: string; details: string; metrics: string; tech: string; ownership: string; teamSize: number | null };
export type Strength = { label: string; evidence: string[]; metric: string };

const THEMES: { label: string; re: RegExp }[] = [
  { label: "Продуктовая аналитика", re: /product analytics|amplitude|mixpanel|funnel|воронк|retention|удержан|activation|активац|conversion|конверси/i },
  { label: "Сегментация клиентов", re: /segment|сегмент|cohort|когорт|rfm|ltv|clv|персонализ/i },
  { label: "Эксперименты и A/B-тесты", re: /a\/b|ab[- ]?test|experiment|эксперимент|hypothes|гипотез/i },
  { label: "Визуализация данных и дашборды", re: /tableau|power bi|looker|metabase|dashboard|дашборд|отчётност|reporting/i },
  { label: "SQL и моделирование данных", re: /\bsql\b|postgres|clickhouse|bigquery|snowflake|\bdbt\b|etl|data model|витрин/i },
  { label: "Автоматизация", re: /automat|автоматиз|airflow|script|скрипт|pipeline|пайплайн/i },
  { label: "Машинное обучение", re: /machine learning|\bml\b|scikit|pytorch|tensorflow|прогноз|forecast|model(?:ing|s)?\b/i },
  { label: "Рост и монетизация", re: /revenue|выручк|monetiz|монетиз|growth|\barpu\b|pricing|ценообраз|продаж/i },
  { label: "Продуктовые исследования", re: /user research|custdev|discovery|interview(?:s|ed) users|исследован|roadmap|роадмап|прототип|prototype/i },
  { label: "Работа со стейкхолдерами", re: /stakeholder|стейкхолдер|cross-functional|кросс-функц|c-level|руководств|презентовал|presented/i },
  { label: "Разработка ПО", re: /react|node\.?js|typescript|backend|frontend|\bapi\b|microservice|микросервис|deploy|релиз/i },
  { label: "Работа с клиентами", re: /customer success|support|поддержк|\bnps\b|csat|клиентск/i },
  { label: "Операции и процессы", re: /process improvement|оптимизир|operations|операцион|sla|логистик|supply/i },
];

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
      label: t.label,
      evidence: [...new Set(hits.map((f) => (f.org ? `${f.title} · ${f.org}` : f.title)))].slice(0, 2),
      metric: withMetric?.metrics ?? "",
      score: hits.length * 2 + (withMetric ? 3 : 0) + (inSkills ? 1 : 0),
    });
  }

  const led = work.filter((f) => f.ownership === "led" || ((f.teamSize ?? 0) >= 3 && /lead|head|руковод|лид/i.test(f.title)));
  if (led.length) {
    const team = Math.max(0, ...led.map((f) => f.teamSize ?? 0));
    out.push({ label: "Руководство командой", evidence: led.map((f) => (f.org ? `${f.title} · ${f.org}` : f.title)).slice(0, 2), metric: team ? `Команда до ${team} человек` : "", score: led.length * 2 + (team ? 2 : 0) });
  }

  return out.filter((x) => x.evidence.length || x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 6).map(({ label, evidence, metric }) => ({ label, evidence, metric }));
}
