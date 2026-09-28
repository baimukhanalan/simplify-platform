// Agent C — pure presentation helpers for the campaign operating screens (safe for server and client).
import { STATUS_LABEL } from "./engine/taxonomy";

export type Tone = "neutral" | "green" | "teal" | "amber" | "rose" | "dark";

const DAY = 86400000;

/** "только что", "12 мин назад", "3 ч назад", "5 дн назад", then a date. */
export function ago(date: Date | null | undefined, now: number = Date.now()) {
  if (!date) return "—";
  const diff = now - date.getTime();
  const future = diff < 0;
  const m = Math.round(Math.abs(diff) / 60000);
  const wrap = (s: string) => (future ? `через ${s}` : `${s} назад`);
  if (m < 1) return "только что";
  if (m < 60) return wrap(`${m} мин`);
  const h = Math.round(m / 60);
  if (h < 24) return wrap(`${h} ч`);
  const d = Math.round(h / 24);
  if (d < 30) return wrap(`${d} дн`);
  return fmtDate(date);
}

export const fmtDate = (d: Date | null | undefined, withTime = false) =>
  d ? d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "—";

export const fmtDateTime = (d: Date | null | undefined) => fmtDate(d, true);

/** A point in time `n` days before now (request time on the server). */
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

export const daysSince = (d: Date | null | undefined, now: number = Date.now()) => (d ? Math.max(0, Math.floor((now - d.getTime()) / DAY)) : null);

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export const pctLabel = (a: number, b: number) => (b > 0 ? `${pct(a, b)}%` : "—");

export function salaryLabel(min: number | null, max: number | null, cur = "USD") {
  if (!min && !max) return null;
  const k = (n: number) => `${Math.round(n / 1000)}k`;
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : `${cur} `;
  if (min && max && min !== max) return `${sym}${k(min)}–${k(max)}`;
  return `${sym}${k((max || min)!)}`;
}

export const statusLabel = (s: string) => (s === "skipped" ? "Skipped" : STATUS_LABEL[s] ?? s);

export function statusTone(s: string): Tone {
  if (["offer", "hired"].includes(s)) return "green";
  if (["assessment", "recruiter", "hiring_manager", "technical", "final"].includes(s)) return "teal";
  if (["submitted", "pending"].includes(s)) return "dark";
  if (s === "rejected") return "rose";
  if (s === "skipped") return "neutral";
  return "neutral";
}

export const ELIGIBILITY: Record<string, { label: string; tone: Tone; hint: string }> = {
  eligible: { label: "Eligible", tone: "green", hint: "Формальных препятствий нет" },
  soft: { label: "Soft mismatch", tone: "amber", hint: "Можно подаваться, но есть пробелы" },
  blocked: { label: "Hard blocker", tone: "rose", hint: "Формально не проходите — агент не подаёт" },
};

export const LANE: Record<string, { label: string; tone: Tone }> = {
  standard: { label: "Standard", tone: "neutral" },
  target: { label: "Target", tone: "teal" },
  mass: { label: "Mass", tone: "amber" },
};

export const REMOTE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };

export const SOURCE_LABEL: Record<string, string> = { demo: "Demo", greenhouse: "Greenhouse", lever: "Lever", remotive: "Remotive", arbeitnow: "Arbeitnow", seed: "Seed" };

export const INBOX_CLASS: Record<string, { label: string; tone: Tone; effect: string }> = {
  confirmation: { label: "Confirmation", tone: "neutral", effect: "Submitted → Pending: заявку получили" },
  rejection: { label: "Rejection", tone: "rose", effect: "→ Rejected, сегмент учится на отказе" },
  assessment: { label: "Assessment", tone: "amber", effect: "→ Assessment, создаётся Interview Room" },
  interview: { label: "Interview", tone: "green", effect: "→ раунд интервью, создаётся Interview Room" },
  offer: { label: "Offer", tone: "green", effect: "→ Offer, карточка в Offer Desk" },
  info: { label: "Info", tone: "teal", effect: "Статус не меняется" },
  unknown: { label: "Unknown", tone: "neutral", effect: "Статус не меняется" },
};

export const APPROVAL_KIND: Record<string, { label: string; why: string }> = {
  sponsorship: {
    label: "Спонсорство визы",
    why: "Компания не указала, спонсирует ли визу. Ответ «да, нужна» может отсечь заявку, «нет» — неправда. Такое решение агент не принимает за вас.",
  },
  legal: {
    label: "Юридические декларации",
    why: "Согласие на background check и другие юридические заявления имеют последствия — агент никогда не подписывает их сам.",
  },
  sensitive: {
    label: "Чувствительные данные",
    why: "Пол, инвалидность, статус ветерана, судимость — добровольные вопросы. Раскрывать их или нет, решаете только вы.",
  },
  salary: {
    label: "Зарплатные ожидания",
    why: "Цифра в анкете становится якорем на переговорах. Агент предлагает вилку, но подтверждаете вы.",
  },
  unknown_question: {
    label: "Нестандартный вопрос",
    why: "В форме вопрос, на который нет подтверждённого ответа в вашем профиле. Агент не додумывает.",
  },
  truth: {
    label: "Truth Check",
    why: "В пакете есть утверждение, которое не подтверждается вашим Truth Layer. Нужна ваша проверка до отправки.",
  },
  handoff: {
    label: "Отправка через официальную форму",
    why: "Это живая вакансия: автоматическая отправка недоступна. Пакет готов — отправьте его сами через форму работодателя и отметьте здесь.",
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
  m === "user-handoff" ? "вы, через официальную форму" : m.startsWith("ats:demo") ? "симулированный ATS (demo)" : m.startsWith("ats:") ? `ATS ${m.slice(4)}` : m || "—";
