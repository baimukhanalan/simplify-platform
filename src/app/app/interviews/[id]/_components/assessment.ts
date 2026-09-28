// Assessment Room: test format, topics, preparation plan and practice questions (pure).

export type AssessmentTopic = { key: string; label: string; short: string; weight: number; have: boolean };
export type PracticeQ = { topic: string; q: string; a: string };

const PLATFORMS = ["TestGorilla", "HackerRank", "Codility", "CodeSignal", "SHL", "Pymetrics", "Criteria", "Maki", "Mettl", "Alooba", "Glider"];

const TOPIC_OF: [RegExp, string, string, string][] = [
  [/sql|postgres|mysql|bigquery|clickhouse|snowflake/i, "sql", "SQL", "SQL"],
  [/python|pandas|numpy|\br\b/i, "python", "Python", "Python"],
  [/excel|google sheets|spreadsheet/i, "excel", "Excel / Spreadsheets", "Excel"],
  [/a\/b|experiment|statistic/i, "stats", "Statistics & A/B", "Statistics"],
  [/tableau|power bi|looker|metabase|visuali/i, "viz", "Data visualization", "Visualization"],
  [/google analytics|amplitude|mixpanel/i, "analytics", "Product analytics", "Analytics"],
];

export const PRACTICE: Record<string, PracticeQ[]> = {
  sql: [
    { topic: "SQL", q: "Таблица orders(user_id, amount, created_at). Выручка по месяцам за 2025 год.", a: "SELECT date_trunc('month', created_at) AS m, SUM(amount) FROM orders WHERE created_at >= '2025-01-01' AND created_at < '2026-01-01' GROUP BY 1 ORDER BY 1;" },
    { topic: "SQL", q: "Найдите пользователей, у которых больше 3 заказов.", a: "SELECT user_id FROM orders GROUP BY user_id HAVING COUNT(*) > 3; — HAVING фильтрует после агрегации, WHERE — до." },
    { topic: "SQL", q: "Второй по величине заказ каждого пользователя.", a: "ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY amount DESC) AS rn, затем WHERE rn = 2. Учтите ничьи: DENSE_RANK." },
  ],
  analytics: [
    { topic: "Analytics", q: "Конверсия в покупку упала с 4% до 3% за неделю. Ваши первые три шага?", a: "1) Проверить данные и трекинг (релизы, баги). 2) Сегментировать: платформа, канал, страна, новый/старый. 3) Найти шаг воронки с падением и сопоставить с изменениями продукта/маркетинга." },
    { topic: "Analytics", q: "Как посчитать retention D7?", a: "Когорта = пользователи с первым действием в день X. D7 = доля когорты, активная на 7-й день. Считать по когортам, сравнивать одинаковые дни." },
  ],
  logic: [
    { topic: "Logic", q: "Ряд: 2, 6, 12, 20, 30, … Следующее число?", a: "42 — разности растут на 2 (4, 6, 8, 10, 12); или n·(n+1)." },
    { topic: "Logic", q: "Цена выросла на 20%, затем упала на 20%. Итог относительно исходной?", a: "−4%: 1.2 × 0.8 = 0.96." },
    { topic: "Numerical", q: "Из 800 посетителей 5% оформили заказ, средний чек $40. Выручка?", a: "800 × 0.05 = 40 заказов × $40 = $1 600." },
  ],
  excel: [
    { topic: "Excel", q: "Подтянуть цену товара из другого листа по артикулу.", a: "XLOOKUP(A2; Prices!A:A; Prices!B:B) или INDEX/MATCH; VLOOKUP — только если ключ в первом столбце." },
    { topic: "Excel", q: "Сумма продаж по региону «North» за март.", a: "SUMIFS(Sales; Region; \"North\"; Date; \">=\"&DATE(2026;3;1); Date; \"<\"&DATE(2026;4;1))." },
  ],
  python: [
    { topic: "Python", q: "pandas: средний чек по стране из df(country, amount).", a: "df.groupby('country')['amount'].mean().sort_values(ascending=False)" },
    { topic: "Python", q: "Удалить дубликаты по user_id, оставив последнюю запись.", a: "df.sort_values('created_at').drop_duplicates('user_id', keep='last')" },
  ],
  stats: [
    { topic: "Statistics", q: "p-value = 0.03 при α = 0.05. Что это значит?", a: "Если бы эффекта не было, такой или более сильный результат встречался бы в 3% случаев. Отвергаем H0 — но это не «вероятность, что гипотеза верна»." },
    { topic: "Statistics", q: "Почему нельзя останавливать A/B-тест, как только стало значимо?", a: "Peeking раздувает ошибку I рода. Размер выборки фиксируют заранее или используют sequential-методы." },
  ],
  viz: [
    { topic: "Visualization", q: "Какой график для доли каналов в выручке по месяцам?", a: "Stacked bar (100%) по месяцам; pie — только для одного периода и 3–5 категорий." },
  ],
};

export type AssessmentInfo = {
  platform: string | null;
  kind: string;
  durationMin: number;
  deadline: Date | null;
  hoursLeft: number | null;
  topics: AssessmentTopic[];
  difficulty: { level: 1 | 2 | 3; label: string; why: string };
  plan: { when: string; what: string }[];
  practice: PracticeQ[];
};

export function assessmentInfo(i: { technologies: string[]; skills: string[]; seniority: string; massHiring: boolean; emails: string[]; deadline: Date | null; now: number; roleFamily: string }): AssessmentInfo {
  const mail = i.emails.join("\n");
  const platform = PLATFORMS.find((p) => new RegExp(p, "i").test(mail)) ?? null;
  const dur = Number(mail.match(/(\d{2,3})\s*(?:-|\s)?(?:minute|min|минут)/i)?.[1]);
  const durationMin = dur >= 10 && dur <= 240 ? dur : 60;
  const have = new Set(i.skills.map((s) => s.toLowerCase()));

  const topics = new Map<string, AssessmentTopic>();
  for (const t of i.technologies) {
    const hit = TOPIC_OF.find(([re]) => re.test(t));
    if (hit && !topics.has(hit[1])) topics.set(hit[1], { key: hit[1], label: hit[2], short: hit[3], weight: 0, have: have.has(t.toLowerCase()) });
  }
  if (/analyst|data|product/.test(i.roleFamily) && !topics.has("analytics")) topics.set("analytics", { key: "analytics", label: "Analytics / case", short: "Analytics", weight: 0, have: true });
  const main = [...topics.values()].slice(0, 4);
  const list = [...main, { key: "logic", label: "Logic & numerical reasoning", short: "Logic", weight: 0, have: true }];
  list.forEach((t) => (t.weight = t.key === "logic" ? (main.length ? 20 : 100) : Math.round(80 / Math.max(1, main.length))));

  const gaps = list.filter((t) => !t.have).length;
  const senior = ["middle", "senior", "lead"].includes(i.seniority);
  const score = (senior ? 2 : 1) + (gaps ? 1 : 0) + (i.massHiring ? -1 : 0);
  const level = (Math.max(1, Math.min(3, score)) as 1 | 2 | 3);
  const difficulty = {
    level,
    label: ["", "Лёгкий", "Средний", "Сложный"][level],
    why: [
      senior ? "уровень роли выше junior" : "junior-уровень роли",
      gaps ? `${gaps} ${gaps === 1 ? "тема" : "темы"} вне вашего профиля` : "все темы есть в вашем профиле",
      i.massHiring ? "массовый найм — обычно стандартный тест" : "",
    ].filter(Boolean).join(" · "),
  };

  const hoursLeft = i.deadline ? Math.round((i.deadline.getTime() - i.now) / 3600000) : null;
  const first = main[0]?.label ?? "Ключевой навык";
  const weak = list.find((t) => !t.have)?.label;
  const plan =
    hoursLeft != null && hoursLeft <= 24
      ? [
          { when: "Сейчас · 30 мин", what: `Повторите шпаргалку по ${first}: синтаксис и 3 типовые задачи` },
          { when: "Затем · 20 мин", what: "Решите практические вопросы ниже на время" },
          { when: "Перед тестом", what: "Тихое место, стабильный интернет, калькулятор и черновик под рукой" },
        ]
      : [
          { when: "День 1", what: `${first}: 5–6 задач на время — агрегаты, JOIN, фильтры` },
          { when: "День 1", what: weak ? `Закройте пробел: ${weak} — базовые задачи и шпаргалка` : "Analytics: разбор 2 кейсов «почему упала метрика»" },
          { when: "День 2", what: "Logic & numerical: 15 минут задач на проценты и последовательности" },
          { when: "День 2", what: `Полная репетиция: ${durationMin} минут без пауз на практических вопросах ниже` },
          { when: "Перед тестом", what: "Прочтите правила платформы: можно ли возвращаться к вопросам, штраф за ошибки" },
        ];

  const practice = [...main.flatMap((t) => (PRACTICE[t.key] ?? []).slice(0, 2)).slice(0, 6), ...PRACTICE.logic.slice(0, 2)];
  const kind = `Online assessment · ${list.map((t) => t.short).join(" / ")}`;
  return { platform, kind, durationMin, deadline: i.deadline, hoursLeft, topics: list, difficulty, plan, practice };
}
