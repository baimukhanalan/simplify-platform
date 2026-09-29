// Technical questions: stepwise method cards (coaching in the interface language) for common analytics / SQL / product
// questions. Pure and local — matching is a handful of regex tests (<1ms), so the card appears instantly.
// The card text is «interviewPractice.methods.<id>.{title,steps,formula?,mention?}» (lists: one item per line).

export type MethodId = "retention" | "churn" | "funnel" | "metricDrop" | "ab" | "sample" | "pvalue" | "joins" | "topn" | "dedup" | "groupby" | "ltv" | "cac" | "cohort" | "success" | "sizing" | "median" | "causal" | "quality" | "dashboard" | "prioritize";
export type Method = { id: MethodId };

const M: [RegExp, MethodId][] = [
  [/retention|retained|удержани/i, "retention"],
  [/churn|отток/i, "churn"],
  [/conversion|funnel|воронк|конверси/i, "funnel"],
  [/^(?=.*(drop|declin|fell|decreas|went down|упал|снизил|просел))(?=.*(dau|mau|active|users|revenue|metric|traffic|orders|conversion|sales|метрик|выручк|пользовател))/i, "metricDrop"],
  [/a\/b|ab test|experiment|split test|эксперимент/i, "ab"],
  [/sample size|power analysis|mde|размер выборки/i, "sample"],
  [/p-?value|significan|statistical|значим/i, "pvalue"],
  [/left join|inner join|outer join|join/i, "joins"],
  [/top \d|top-n|top n|rank|highest|second (highest|largest)|window function|оконн/i, "topn"],
  [/duplicate|dedup|дубл/i, "dedup"],
  [/group by|having|aggregat/i, "groupby"],
  [/ltv|lifetime value|clv/i, "ltv"],
  [/\bcac\b|acquisition cost/i, "cac"],
  [/cohort|когорт/i, "cohort"],
  [/success|measure (the )?(impact|success)|which metric|what metric|north star|kpi|метрик.* успех/i, "success"],
  [/estimate|how many|market size|sizing|оцените|сколько/i, "sizing"],
  [/mean|median|average|outlier|среднее|медиан/i, "median"],
  [/correlation|causation|causal|корреляц/i, "causal"],
  [/correct|accurate|validate|sanity|data quality|качество данных|проверяете/i, "quality"],
  [/dashboard|visuali[sz]|дашборд/i, "dashboard"],
  [/prioriti[sz]|rice|backlog|приоритиз/i, "prioritize"],
];

export function matchMethod(q: string): Method | null {
  for (const [re, id] of M) if (re.test(q)) return { id };
  return null;
}
