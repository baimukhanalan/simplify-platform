import { ROLE_FAMILIES, SENIORITY, SENIORITY_LABEL, seniorityFromYears, type Seniority } from "@/lib/engine/taxonomy";

/** The five components shown in Career Mode (careerScore keys → UI labels). */
export const BREAKDOWN: { key: "skillStrength" | "experience" | "marketDemand" | "compensationPosition" | "interviewReadiness"; label: string }[] = [
  { key: "skillStrength", label: "Навыки" },
  { key: "experience", label: "Стаж в профессии" },
  { key: "marketDemand", label: "Спрос на рынке" },
  { key: "compensationPosition", label: "Компенсация" },
  { key: "interviewReadiness", label: "Готовность к интервью" },
];

/** The skill that typically unlocks the next level in each role family. */
const UNLOCK: Record<string, string> = {
  data_analyst: "аналитику экспериментов (A/B-тесты)",
  product_analyst: "причинно-следственный анализ и дизайн экспериментов",
  data_scientist: "MLOps и вывод моделей в прод",
  data_engineer: "моделирование данных и потоковую обработку (Kafka)",
  software_engineer: "проектирование систем",
  qa: "автоматизацию тестирования (Playwright)",
  product_manager: "продуктовую аналитику и ценообразование",
  designer: "дизайн-системы и организацию исследований",
  marketing: "удержание клиентов и маркетинговую аналитику",
  sales: "корпоративные продажи и прогнозирование",
  support: "работу с клиентами и метрики удержания",
  operations: "автоматизацию процессов (SQL и инструменты без кода)",
  annotation: "оценку качества AI-моделей",
  other: "ключевой профессиональный навык твоей роли",
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

/** A job title we can put a level in front of: "Data Analyst", "QA Engineer" — not "Other" or "Sales / SDR". */
const TITLE_LIKE = /\b(analyst|engineer|scientist|manager|designer|developer|specialist|marketer|consultant|accountant|coordinator)\b/i;

/** The role noun without level words: "Junior Data Analyst" → "Data Analyst". */
export function baseRole(title: string): string {
  let t = title;
  for (const [re] of SENIORITY_WORD) t = t.replace(new RegExp(re.source, "gi"), " ");
  return t.replace(/\s+/g, " ").replace(/^[\s,·–-]+|[\s,·–-]+$/g, "").trim();
}

/**
 * "Senior Data Analyst" — the next title up from the current level. Built from the user's own role (goal / current title),
 * falling back to the family label only when it reads like a title. Null when there is nothing sensible to show.
 */
export function nextMilestone(family: string, level: Seniority, roleTitle = ""): { title: string; level: string } | null {
  const own = baseRole(roleTitle);
  const famLabel = ROLE_FAMILIES[family]?.label ?? "";
  const base = own && TITLE_LIKE.test(own) ? own : family !== "other" && TITLE_LIKE.test(famLabel) ? famLabel : own;
  if (!base) return null;
  const i = SENIORITY.indexOf(level);
  if (i >= SENIORITY.length - 1) {
    const area = base.replace(/ (Analyst|Engineer|Scientist|Manager|Designer|Developer|Specialist)$/i, "");
    return { title: area && area !== base ? `Head of ${area}` : `Lead ${base}`, level: "Head" };
  }
  const next = SENIORITY[i + 1];
  return { title: `${SENIORITY_LABEL[next]} ${base}`, level: SENIORITY_LABEL[next] };
}

/** One recommendation line from the weakest of the five components. */
export function recommendation(opts: {
  components: Record<string, number>;
  family: string;
  skills: string[];
  nextLevel: string | null;
  mockCount: number;
}): { key: string; text: string; href: string; cta: string } {
  const weakest = BREAKDOWN.reduce((a, b) => ((opts.components[b.key] ?? 100) < (opts.components[a.key] ?? 100) ? b : a));
  const fam = ROLE_FAMILIES[opts.family] ?? ROLE_FAMILIES.other;
  const known = opts.family !== "other" && Boolean(ROLE_FAMILIES[opts.family]);
  const toLevel = opts.nextLevel ? `${opts.nextLevel}-уровню` : "следующему уровню";
  const have = new Set(opts.skills.map((s) => s.toLowerCase()));
  const missing = fam.skills.find((s) => !have.has(s.toLowerCase()));
  switch (weakest.key) {
    case "skillStrength":
      return missing && known
        ? { key: weakest.key, text: `Добавь ${missing} — это главный пробел для ролей «${fam.label}»${opts.nextLevel ? ` уровня ${opts.nextLevel}` : ""}.`, href: "/app/profile", cta: "Career Profile" }
        : { key: weakest.key, text: `Освой ${UNLOCK[opts.family] ?? UNLOCK.other} — это путь к ${toLevel}.`, href: "/app/profile", cta: "Career Profile" };
    case "experience":
      return { key: weakest.key, text: `Фиксируй измеримые результаты каждый квартал — опыт с цифрами быстрее всего ведёт к ${toLevel}.`, href: "/app/profile", cta: "Career Profile" };
    case "marketDemand":
      return { key: weakest.key, text: known ? `Спрос на ${fam.label} сейчас узкий — добавь в цель смежные роли или регионы.` : "Спрос по твоей роли сейчас узкий — добавь в цель смежные роли или регионы.", href: "/app/goal", cta: "Цель" };
    case "compensationPosition":
      return { key: weakest.key, text: "Твоя компенсация ниже рыночной оценки — это аргумент для пересмотра зарплаты или следующей кампании.", href: "#better-roles", cta: "Роли дороже" };
    default:
      return {
        key: weakest.key,
        text: opts.mockCount ? "Ещё пара пробных интервью подтянет готовность к интервью — сейчас это самый слабый компонент." : "Пройди первое пробное интервью — готовность к интервью сейчас самый слабый компонент.",
        href: "/app/readiness",
        cta: "Readiness",
      };
  }
}
