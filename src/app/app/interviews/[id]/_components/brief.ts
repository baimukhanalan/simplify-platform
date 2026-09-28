import { z } from "zod";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { plural } from "../../../../_components/ru";
import { stripHtml } from "./util";

// «О компании» + «О роли». Pure: the deterministic engine builds it from the JD, company and
// industry; with an API key the Interview Room stores a Claude version (same schema) in `pack.brief`.

export const BriefSchema = z.object({
  company: z.object({
    what: z.string(),
    model: z.string(),
    products: z.array(z.string()),
    recent: z.array(z.string()),
  }),
  role: z.object({
    lookFor: z.array(z.string()),
    responsibilities: z.array(z.string()),
    requirements: z.array(z.string()),
    topics: z.array(z.string()),
  }),
});
export type Brief = z.infer<typeof BriefSchema>;
export type StoredBrief = Brief & { by?: "claude" | "engine"; at?: string };

export type BriefInput = {
  company: string;
  title: string;
  industry: string;
  roleFamily: string;
  seniority: string;
  minYears: number;
  description: string;
  requirements: string[];
  technologies: string[];
  round: string;
};

type IndustryProfile = { what: string; model: string; products: string[] };
const INDUSTRY: [RegExp, IndustryProfile][] = [
  [/e-?commerce|retail|marketplace/i, { what: "онлайн-торговля: каталог, корзина, доставка и повторные покупки", model: "Маржа или комиссия с заказа, плюс реклама для продавцов и платная доставка", products: ["Витрина и мобильное приложение", "Поиск и рекомендации", "Кабинет продавца / логистика"] }],
  [/fintech|bank|payment|finance/i, { what: "финансовые продукты: платежи, счета, кредиты", model: "Комиссия с транзакций, процентный доход, подписки на премиум-тарифы", products: ["Мобильный банк / кошелёк", "Платёжный шлюз для бизнеса", "Скоринг и антифрод"] }],
  [/edtech|education|learning/i, { what: "онлайн-обучение: курсы, практика и сертификаты", model: "Подписка B2C и лицензии для компаний и школ (B2B)", products: ["Платформа курсов", "Мобильное приложение для практики", "Кабинет для преподавателей / HR"] }],
  [/mobility|transport|ride|logistic/i, { what: "городская мобильность: поездки, шеринг, доставка", model: "Комиссия с поездки или заказа, B2B-контракты для корпоративных клиентов", products: ["Приложение для пассажиров", "Приложение для водителей / партнёров", "Динамическое ценообразование и диспетчеризация"] }],
  [/media|content|publishing|stream/i, { what: "цифровой контент и аудитория", model: "Реклама и подписки; монетизация через вовлечённость аудитории", products: ["Сайт и приложения с контентом", "Рекомендательная лента", "Рекламный кабинет"] }],
  [/security|cyber/i, { what: "кибербезопасность для компаний: защита данных, мониторинг угроз", model: "B2B SaaS-подписка по количеству пользователей / устройств, контракты с крупными компаниями", products: ["Платформа мониторинга угроз", "Защита рабочих мест и облака", "Отчётность для комплаенса"] }],
  [/health|medic|pharma/i, { what: "цифровое здравоохранение", model: "Оплата от клиник и страховых, подписки пациентов", products: ["Приложение для пациентов", "Инструменты для врачей", "Аналитика клинических данных"] }],
  [/saas|software|b2b|platform/i, { what: "B2B-софт для команд и бизнеса", model: "SaaS-подписка по тарифам и местам, допродажа функций для крупных клиентов", products: ["Веб-приложение", "Интеграции и API", "Аналитика и админ-панель"] }],
  [/game|gaming/i, { what: "игры и игровые сервисы", model: "Внутриигровые покупки, подписки и реклама", products: ["Мобильные / PC-игры", "Игровые события и обновления", "Монетизация и экономика игры"] }],
  [/travel|hotel|booking/i, { what: "путешествия и бронирования", model: "Комиссия с бронирования, реклама для партнёров", products: ["Поиск и бронирование", "Кабинет партнёра", "Программа лояльности"] }],
];

const FAMILY_RESP: Record<string, string[]> = {
  data_analyst: ["Дашборды и регулярная отчётность для бизнеса", "Разовые исследования: почему метрика изменилась", "Качество данных и определения метрик"],
  product_analyst: ["Продуктовые метрики: воронки, удержание, конверсия", "Дизайн и разбор A/B-тестов", "Инсайты для плана развития продукта"],
  data_scientist: ["Модели и эксперименты от гипотезы до продакшена", "Оценка качества моделей и влияния на бизнес", "Работа с продуктом над постановкой задач"],
  data_engineer: ["Пайплайны и витрины данных", "Надёжность и стоимость инфраструктуры данных", "Модели данных для аналитиков"],
  software_engineer: ["Разработка фич от дизайна до релиза", "Ревью кода и его качество", "Надёжность и производительность сервиса"],
  product_manager: ["Приоритизация плана развития по влиянию", "Исследование задач пользователей и данных", "Запуски вместе с дизайном и разработкой"],
  marketing: ["Каналы привлечения и их экономика", "Эксперименты с креативами и лендингами", "Отчётность по воронке маркетинга"],
};

const FAMILY_TOPICS: Record<string, string[]> = {
  data_analyst: ["SQL: JOIN, агрегаты, оконные функции", "Разбор падения метрики", "Визуализация и сторителлинг"],
  product_analyst: ["Продуктовые метрики: удержание, активация, конверсия", "A/B-тесты: дизайн, размер выборки, интерпретация", "Кейс: как оценить успех фичи"],
  data_scientist: ["Кейс по машинному обучению: от задачи до метрики", "Статистика и валидация", "Объяснение модели бизнесу"],
  data_engineer: ["Моделирование данных", "Оркестрация и инкрементальные загрузки", "Качество данных"],
  software_engineer: ["Алгоритмы и структуры данных", "Проектирование систем", "Отладка и компромиссы в решениях"],
  product_manager: ["Продуктовое мышление", "Приоритизация", "Метрики успеха"],
};

const ROUND_FOCUS: Record<string, string[]> = {
  assessment: ["Скорость и точность под таймером"],
  recruiter: ["Мотивация и история карьеры", "Ожидания по зарплате и сроки выхода"],
  hiring_manager: ["Глубина твоего лучшего проекта", "Приоритизация и работа со стейкхолдерами"],
  technical: ["Задача вживую по ключевому навыку", "Как ты проверяешь корректность анализа"],
  final: ["Ценности и культура", "Долгосрочные цели и вопросы к лидерам"],
};

/** Whole-sentence Russian equivalents for common soft requirements. Unknown ones return null (never half-translated). */
const SOFT_RU: [RegExp, string][] = [
  [/communicat/i, "Ясно объясняет выводы и договаривается с коллегами"],
  [/stakeholder/i, "Работает со стейкхолдерами и их запросами"],
  [/english/i, "Рабочий английский"],
  [/attention to detail|detail[- ]oriented/i, "Внимательность к деталям"],
  [/team ?player|teamwork|collaborat/i, "Умеет работать в команде"],
  [/ownership|self-?starter|proactive|independen/i, "Самостоятельность и ответственность за результат"],
  [/problem[- ]solving|analytical (thinking|mindset|skills)/i, "Аналитическое мышление"],
  [/a\/b|experiment/i, "Опыт A/B-тестов и экспериментов"],
  [/statistic/i, "Уверенная статистика"],
  [/degree|bachelor|master/i, "Профильное образование"],
  [/fast[- ]paced|startup/i, "Готовность к быстрому темпу"],
];
const translateSoft = (r: string) => SOFT_RU.find(([re]) => re.test(r))?.[1] ?? null;

/** True when a line is mostly Latin script — i.e. quoted from an English JD. */
export const isEnglish = (s: string) => {
  const lat = (s.match(/[A-Za-z]/g) ?? []).length;
  const cyr = (s.match(/[А-Яа-яЁё]/g) ?? []).length;
  return lat > cyr * 2;
};

const clean = (l: string) => l.replace(/^[\s\-•*·–]+/, "").replace(/\s+/g, " ").trim();
const cap = (x: string) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x);
const uniq = (xs: string[]) => [...new Map(xs.filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];

/** Split the JD into sentences and bullet lines once. */
function parseJD(description: string) {
  const text = stripHtml(description);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const sentences = text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 12);
  return { lines, sentences };
}

export function buildBriefHeuristic(i: BriefInput): Brief {
  const { lines, sentences } = parseJD(i.description);
  const profile = INDUSTRY.find(([re]) => re.test(`${i.industry} ${i.description.slice(0, 400)}`))?.[1];
  const industry = i.industry || "технологии";

  // "About us" style sentences, excluding the generic "X is hiring a Y" opener.
  const about = sentences.filter((s) => /\b(we are|we're|our mission|we build|we help|helps|platform|founded|customers)\b/i.test(s) && !/is hiring/i.test(s)).slice(0, 2);
  const what = !about.length || profile
    ? `${i.company} работает в сфере ${industry}${profile ? ` — ${profile.what}` : ""}.`
    : about.join(" ");

  const productLines = sentences.filter((s) => /\b(product|app|platform|service|tool|api)\b/i.test(s) && !/is hiring|you('|’)ll|you will|join|requirement/i.test(s)).slice(0, 2);

  // Responsibilities: "You'll join a team and own A, B and C that …" → "Join a team" / "Own A, B and C that …".
  const youWill = sentences.filter((s) => /\b(you('|’)ll|you will|responsib|own|drive|build)\b/i.test(s) && !/is hiring/i.test(s));
  const fromJD = youWill.flatMap((s) =>
    s
      .replace(/^you('|’)ll\s+|^you will\s+/i, "")
      .replace(/\.$/, "")
      .split(/\s+and\s+(?=(own|build|drive|work|lead|partner|design|analy[sz]e|support)\b)/i)
      .filter((x) => x && !/^(own|build|drive|work|lead|partner|design|analy[sz]e|support)$/i.test(x))
      .map((x) => cap(clean(x))),
  );
  const reqSection = (re: RegExp) => {
    const start = lines.findIndex((l) => re.test(l) && /:\s*$/.test(l));
    if (start < 0) return [];
    const out: string[] = [];
    for (const l of lines.slice(start + 1)) {
      if (/:\s*$/.test(l) && !/^[-•*]/.test(l)) break;
      if (/^[-•*]/.test(l)) out.push(clean(l));
      else break;
    }
    return out;
  };
  const respSection = reqSection(/responsib|what you('|’)ll do|your role|you will/i);
  const responsibilities = uniq([...respSection, ...fromJD, ...(FAMILY_RESP[i.roleFamily] ?? [])]).slice(0, 5);

  const requirements = uniq([...i.requirements.map(clean), ...reqSection(/requirement|qualifications|what we look/i)]).slice(0, 8);
  const soft = requirements.filter((r) => !/hands-on experience with|^\d\+? years|experience required/i.test(r));
  const years = i.minYears > 0 ? `${i.minYears}+ ${plural(i.minYears, ["год", "года", "лет"])} практики` : "опыт не критичен — важны обучаемость и базовые навыки";
  const lookFor = uniq([
    `${SENIORITY_LABEL[i.seniority] ?? "Junior"}-уровень: ${years}`,
    i.technologies.length ? `Уверенно владеет ${i.technologies.slice(0, 4).join(", ")}` : "",
    // Only requirements we can translate whole; the rest stay verbatim (English) under «Ключевые требования».
    ...soft.map(translateSoft).filter((x): x is string => Boolean(x)),
  ]).slice(0, 4);

  const topics = uniq([...(ROUND_FOCUS[i.round] ?? []), ...(FAMILY_TOPICS[i.roleFamily] ?? []), ...i.technologies.slice(0, 3).map((t) => `${t}: типичные вопросы и твой рабочий пример`)]).slice(0, 6);

  return {
    company: {
      what,
      model: profile?.model ?? "Модель монетизации в вакансии не описана — уточни на звонке, как компания зарабатывает и кто платит.",
      products: uniq([...productLines, ...(profile?.products ?? [])]).slice(0, 4),
      recent: [
        `Запуски и релизы ${i.company} за последние 90 дней`,
        "Раунды инвестиций, выход на новые рынки, партнёрства",
        "Отзывы пользователей о продукте — одна деталь для ответа на вопрос «Почему мы?»",
      ],
    },
    role: { lookFor, responsibilities, requirements, topics },
  };
}
