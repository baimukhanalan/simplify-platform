import { ROLE_FAMILIES, SENIORITY, SENIORITY_LABEL, seniorityFromYears, type Seniority } from "@/lib/engine/taxonomy";

/** The five components shown in Career Mode (careerScore keys → UI labels). */
export const BREAKDOWN: { key: "skillStrength" | "experience" | "marketDemand" | "compensationPosition" | "interviewReadiness"; label: string }[] = [
  { key: "skillStrength", label: "Skills" },
  { key: "experience", label: "Experience" },
  { key: "marketDemand", label: "Market Demand" },
  { key: "compensationPosition", label: "Compensation" },
  { key: "interviewReadiness", label: "Interview Readiness" },
];

/** The skill that typically unlocks the next level in each role family. */
const UNLOCK: Record<string, string> = {
  data_analyst: "experimentation analytics (A/B testing)",
  product_analyst: "causal inference и дизайн экспериментов",
  data_scientist: "MLOps и вывод моделей в production",
  data_engineer: "data modeling и streaming (Kafka)",
  software_engineer: "system design",
  qa: "test automation (Playwright)",
  product_manager: "product analytics и pricing",
  designer: "design systems и research ops",
  marketing: "lifecycle и marketing analytics",
  sales: "enterprise sales и forecasting",
  support: "customer success и retention metrics",
  operations: "автоматизацию процессов (SQL, no-code)",
  annotation: "AI evaluation и QA для моделей",
  other: "ключевой hard skill вашей роли",
};

const SENIORITY_WORD: [RegExp, Seniority][] = [
  [/\bintern|стаж[её]р/i, "intern"],
  [/\bjunior|\bjr\b|младш/i, "junior"],
  [/\bmiddle|\bmid\b/i, "middle"],
  [/\bsenior|\bsr\b|старш|ведущ/i, "senior"],
  [/\blead\b|\bhead\b|principal|staff|руковод/i, "lead"],
];

/** Current level: explicit word in the current title wins, else inferred from years of experience. */
export function currentSeniority(title: string, years: number): Seniority {
  for (const [re, s] of SENIORITY_WORD) if (re.test(title)) return s;
  return seniorityFromYears(years);
}

/** "Senior Data Analyst" — the next title up from the current level in the same role family. */
export function nextMilestone(family: string, level: Seniority) {
  const label = ROLE_FAMILIES[family]?.label ?? "Specialist";
  const famLabel = family === "other" ? "Specialist" : label;
  const i = SENIORITY.indexOf(level);
  if (i >= SENIORITY.length - 1) return { title: `Head of ${famLabel.replace(/ (Analyst|Engineer|Scientist|Manager|Designer)$/, "")}`, level: "Head" };
  const next = SENIORITY[i + 1];
  return { title: `${SENIORITY_LABEL[next]} ${famLabel}`, level: SENIORITY_LABEL[next] };
}

/** One recommendation line from the weakest of the five components. */
export function recommendation(opts: {
  components: Record<string, number>;
  family: string;
  skills: string[];
  nextLevel: string;
  mockCount: number;
}): { key: string; text: string; href: string; cta: string } {
  const weakest = BREAKDOWN.reduce((a, b) => ((opts.components[b.key] ?? 100) < (opts.components[a.key] ?? 100) ? b : a));
  const fam = ROLE_FAMILIES[opts.family] ?? ROLE_FAMILIES.other;
  const have = new Set(opts.skills.map((s) => s.toLowerCase()));
  const missing = fam.skills.find((s) => !have.has(s.toLowerCase()));
  switch (weakest.key) {
    case "skillStrength":
      return missing
        ? { key: weakest.key, text: `Добавьте ${missing} — это главный пробел для ${fam.label}-ролей уровня ${opts.nextLevel}.`, href: "/app/profile", cta: "Career Profile" }
        : { key: weakest.key, text: `Освойте ${UNLOCK[opts.family] ?? UNLOCK.other} — это открывает ${opts.nextLevel}-роли.`, href: "/app/profile", cta: "Career Profile" };
    case "experience":
      return { key: weakest.key, text: `Фиксируйте измеримые результаты каждый квартал — опыт с цифрами быстрее всего ведёт к ${opts.nextLevel}-уровню.`, href: "/app/profile", cta: "Career Profile" };
    case "marketDemand":
      return { key: weakest.key, text: `Спрос на ${fam.label} сейчас узкий — добавьте в Goal смежные роли или регионы.`, href: "/app/goal", cta: "Goal" };
    case "compensationPosition":
      return { key: weakest.key, text: "Ваша компенсация ниже рыночной оценки — это аргумент для пересмотра зарплаты или следующей кампании.", href: "#better-roles", cta: "Роли дороже" };
    default:
      return {
        key: weakest.key,
        text: opts.mockCount ? `Ещё пара mock-интервью подтянет Interview Readiness — сейчас это самый слабый компонент.` : "Пройдите первое mock-интервью — Interview Readiness сейчас самый слабый компонент.",
        href: "/app/readiness",
        cta: "Readiness",
      };
  }
}
