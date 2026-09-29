// Agent C — pure presentation helpers for the campaign operating screens (safe for server and client).
import { STATUS_LABEL, fmtMoney, fmtMoneyRange } from "./engine/taxonomy";
import { NBSP, fmtNum, fmtYearsRu, plural, count } from "./ru";

export { plural, count, fmtNum };

export type Tone = "neutral" | "green" | "teal" | "amber" | "rose" | "dark";

const DAY = 86400000;

/**
 * Relative time, one format everywhere: "только что", "12 мин. назад", "3 ч назад", "4 дн. назад", "через 3 дн.",
 * then a date ("28 сент.") from 30 days on. The number and its unit are joined by a non-breaking space.
 */
export function ago(date: Date | null | undefined, now: number = Date.now()) {
  if (!date) return "—";
  const diff = now - date.getTime();
  const future = diff < 0;
  const m = Math.round(Math.abs(diff) / 60000);
  const wrap = (s: string) => (future ? `через${NBSP}${s}` : `${s} назад`);
  if (m < 1) return future ? "сейчас" : "только что";
  if (m < 60) return wrap(`${m}${NBSP}мин.`);
  const h = Math.round(m / 60);
  if (h < 24) return wrap(`${h}${NBSP}ч`);
  const d = Math.round(h / 24);
  if (d < 30) return wrap(`${d}${NBSP}дн.`);
  return fmtDate(date);
}

/** Years of experience for Russian copy: "1 год", "2 года", "5 лет", "3,4 года" (decimal comma). */
export const fmtYears = (y: number) => fmtYearsRu(y);

/**
 * Years of experience as an employer reads them (English, CV summary / screening copy): whole years stay exact
 * ("3 years", "1 year"), a fraction rounds down with a plus ("3.4" → "3+ years"). Under one year → null.
 */
export function yearsForEmployer(y: number): string | null {
  if (!Number.isFinite(y) || y < 1) return null;
  const whole = Math.floor(y + 1e-9);
  const plus = y - whole >= 0.05 ? "+" : "";
  return `${whole}${plus} ${whole === 1 && !plus ? "year" : "years"}`;
}

export const fmtDate = (d: Date | null | undefined, withTime = false) =>
  d ? d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "—";

export const fmtDateTime = (d: Date | null | undefined) => fmtDate(d, true);

/** A point in time `n` days before now (request time on the server). */
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

export const daysSince = (d: Date | null | undefined, now: number = Date.now()) => (d ? Math.max(0, Math.floor((now - d.getTime()) / DAY)) : null);

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export const pctLabel = (a: number, b: number) => (b > 0 ? `${pct(a, b)}%` : "—");

/** A job's published salary in the one money style: «$60 000–$80 000», «$75 000». Null when none is published. */
export function salaryLabel(min: number | null, max: number | null, cur = "USD") {
  if (!min && !max) return null;
  if (min && max && min !== max) return fmtMoneyRange(min, max, cur);
  return fmtMoney((max || min)!, cur);
}

export const statusLabel = (s: string) => (s === "skipped" ? "Пропущено" : STATUS_LABEL[s] ?? s);

export function statusTone(s: string): Tone {
  if (["offer", "hired"].includes(s)) return "green";
  if (["assessment", "recruiter", "hiring_manager", "technical", "final"].includes(s)) return "teal";
  if (["submitted", "pending"].includes(s)) return "dark";
  if (s === "rejected") return "rose";
  if (s === "skipped") return "neutral";
  return "neutral";
}

export const ELIGIBILITY: Record<string, { label: string; tone: Tone; hint: string }> = {
  eligible: { label: "Проходишь", tone: "green", hint: "Формальных препятствий нет" },
  soft: { label: "Есть пробелы", tone: "amber", hint: "Можно подаваться, но есть пробелы" },
  blocked: { label: "Не проходишь", tone: "rose", hint: "Формально не проходишь — агент не подаёт" },
};

export const LANE: Record<string, { label: string; tone: Tone }> = {
  standard: { label: "Обычная", tone: "neutral" },
  target: { label: "Компания мечты", tone: "teal" },
  mass: { label: "Массовый найм", tone: "amber" },
};

export const REMOTE_LABEL: Record<string, string> = { remote: "Удалённо", hybrid: "Гибрид", onsite: "В офисе" };

export const SOURCE_LABEL: Record<string, string> = { hh: "hh.kz", demo: "Demo", greenhouse: "Greenhouse", lever: "Lever", remotive: "Remotive", arbeitnow: "Arbeitnow", seed: "Seed" };

export const INBOX_CLASS: Record<string, { label: string; tone: Tone; effect: string }> = {
  confirmation: { label: "Подтверждение", tone: "neutral", effect: "Submitted → Pending: заявку получили" },
  rejection: { label: "Отказ", tone: "rose", effect: "→ Rejected, сегмент учится на отказе" },
  assessment: { label: "Тест", tone: "amber", effect: "→ Assessment, создаётся Interview Room" },
  interview: { label: "Интервью", tone: "green", effect: "→ раунд интервью, создаётся Interview Room" },
  offer: { label: "Оффер", tone: "green", effect: "→ Offer, карточка в Offer Desk" },
  info: { label: "Инфо", tone: "teal", effect: "Статус не меняется" },
  unknown: { label: "Не распознано", tone: "neutral", effect: "Статус не меняется" },
};

export const APPROVAL_KIND: Record<string, { label: string; why: string }> = {
  sponsorship: {
    label: "Спонсорство визы",
    why: "Компания не указала, спонсирует ли визу. Ответ «да, нужна» может отсечь заявку, «нет» — неправда. Такое решение агент не принимает за тебя.",
  },
  legal: {
    label: "Юридические декларации",
    why: "Согласие на background check и другие юридические заявления имеют последствия — агент никогда не подписывает их сам.",
  },
  sensitive: {
    label: "Чувствительные данные",
    why: "Пол, инвалидность, статус ветерана, судимость — добровольные вопросы. Раскрывать их или нет, решаешь только ты.",
  },
  salary: {
    label: "Зарплатные ожидания",
    why: "Цифра в анкете становится якорем на переговорах. Агент предлагает вилку, но подтверждаешь ты.",
  },
  unknown_question: {
    label: "Нестандартный вопрос",
    why: "В форме вопрос, на который в твоём профиле нет готового ответа. Нужен твой ответ.",
  },
  handoff: {
    label: "Отправка через официальную форму",
    why: "Это живая вакансия: автоматическая отправка недоступна. Пакет готов — отправь его сам через форму работодателя и отметь здесь.",
  },
};

export const EVENT_LABEL: Record<string, string> = {
  discovery: "Discovery",
  prepared: "Application Package",
  submitted: "Отправлено",
  inbox: "Inbox Intelligence",
  interview_room: "Interview Room",
  tick: "Цикл агента",
  campaign_started: "Кампания",
  campaign_status: "Кампания",
  status_change: "Смена статуса",
  approval: "Подтверждение",
  hired: "Hired",
};

export const submitMethodLabel = (m: string) =>
  m === "user-handoff" ? "ты, через официальную форму" : m.startsWith("ats:demo") ? "симулированный ATS (demo)" : m.startsWith("ats:") ? `ATS ${m.slice(4)}` : m || "—";
