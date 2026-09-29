// Tiny Russian text helpers shared by the UI. Pure: safe on server and client.
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";

type Forms = readonly [one: string, few: string, many: string];

/** Plural form for n: plural(5, ["вакансия", "вакансии", "вакансий"]) → "вакансий". */
export function plural(n: number, forms: Forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

/** Number plus its word: count(3, ["заявка", "заявки", "заявок"]) → "3 заявки". */
export const count = (n: number, forms: Forms) => `${n} ${plural(n, forms)}`;

/**
 * Short date "28 сент." — and a sentence-safe variant that never ends in a double period
 * when the caller puts a full stop after it ("…отправлена 28 сент.").
 */
export function shortDate(d: Date | null | undefined) {
  if (!d) return "—";
  return d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short" });
}

const almatyKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Almaty" });

/**
 * Calendar-day distance in Asia/Almaty: +1 for any time tomorrow, −1 for any time yesterday — never a rounded
 * 24-hour count (30 Sep 10:00 seen on 29 Sep 20:00 is «завтра», not «послезавтра»).
 */
export function almatyDayDiff(d: Date, now: number | Date = Date.now()) {
  const a = Date.parse(almatyKey(d));
  const b = Date.parse(almatyKey(now instanceof Date ? now : new Date(now)));
  return Math.round((a - b) / 86400000);
}

/**
 * An assessment deadline, one wording on every screen: «ср, 30 сентября, до 23:59» (Almaty time). `withTime: false`
 * drops the time for a deadline known only by its day («ср, 30 сентября»).
 */
export function assessmentDeadline(d: Date | null | undefined, withTime = true) {
  if (!d) return "не указан";
  const wd = d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", weekday: "short" }).replace(/\.$/, "");
  const dm = d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" });
  const hm = d.toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
  return withTime ? `${wd}, ${dm}, до ${hm}` : `${wd}, ${dm}`;
}

/** Ends a sentence: adds a period unless the text already ends with one. */
export const endSentence = (s: string) => (/[.!?…]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/** Exception-queue copy, one wording everywhere: questions wait for an answer, handoffs wait to be sent. */
export const questionsWaiting = (n: number) => `${n} ${plural(n, ["вопрос ждёт", "вопроса ждут", "вопросов ждут"])} твоего ответа`;
export const handoffsWaiting = (n: number) => `${n} ${plural(n, ["заявка ждёт", "заявки ждут", "заявок ждут"])} отправки`;

/** Region keys (salary model / goal) in Russian, one naming everywhere: Европа, США, Казахстан, «Удалённо». */
export const REGION_RU: Record<string, string> = {
  KZ: "Казахстан", CIS: "СНГ", EU: "Европа", UK: "Великобритания", US: "США", CA: "Канада", MENA: "Ближний Восток", WORLD: "Удалённо", REMOTE: "Удалённо",
};
export const regionRu = (k: string) => REGION_RU[k.toUpperCase()] ?? k;
export const regionsRu = (ks: string[]) => [...new Set(ks.map(regionRu))].join(", ");

/** Work format, one naming everywhere. */
export const WORK_MODE_RU: Record<string, string> = { remote: "Удалённо", hybrid: "Гибрид", onsite: "В офисе", any: "Любой формат" };

/** Campaign mode (Goal). */
export const CAMPAIGN_MODE_RU: Record<string, string> = { autonomous: "Автономный", target: "Точечный — компании мечты", mass: "Массовый найм" };

/** Application status in Russian — chips, inbox, timelines. Unknown keys fall back to the key itself. */
export const STATUS_RU: Record<string, string> = {
  found: "Найдена", qualified: "Подходит", prepared: "Пакет готов", submitted: "Отправлено", pending: "Ждём ответа",
  assessment: "Тестовое задание", recruiter: "Скрининг с рекрутером", hiring_manager: "Интервью с менеджером", technical: "Техническое интервью",
  final: "Финальное интервью", offer: "Оффер", hired: "Работа найдена", rejected: "Отказ", skipped: "Пропущено", blocked: "Недоступно",
};
export const statusRu = (s: string) => STATUS_RU[s] ?? s;

/** Years of experience: "1 год", "2 года", "5 лет", "2,5 года" (same wording as the engine). */
export { fmtYearsRu as yearsRu } from "@/lib/ru";
import { placeRu as placeRuLib } from "@/lib/ru";

/**
 * Industry names for the Russian UI (stored values stay English). Chip/list labels are capitalised («Финтех»);
 * industryRu(x, true) gives the in-sentence form («работает в сфере финтех»). Industry terms (SaaS, EdTech, AI / ML…) stay as written.
 */
export const INDUSTRY_RU: Record<string, string> = {
  fintech: "Финтех", banking: "Банкинг", telecom: "Телеком", consulting: "Консалтинг", govtech: "Госсектор", government: "Госсектор",
  logistics: "Логистика", media: "Медиа", retail: "Ритейл", gaming: "Игры", games: "Игры", finance: "Финансы", education: "Образование", healthcare: "Здравоохранение",
};
export function industryRu(industry: string, inSentence = false) {
  const ru = INDUSTRY_RU[industry.trim().toLowerCase()];
  if (!ru) return industry;
  return inSentence ? ru.toLowerCase() : ru;
}
export const industriesRu = (xs: string[]) => xs.map((x) => industryRu(x)).join(", ");

const FORMAT_LC: Record<string, string> = { remote: "удалённо", hybrid: "гибрид", onsite: "офис" };

/**
 * The one place format for cards, Today and briefs: localized place plus the work format in lower case, never said
 * twice — ("Warsaw, Poland", "hybrid") → «Варшава, Польша · гибрид», ("Remote — Europe", "remote") → «Удалённо — Европа»,
 * ("", "remote") → «Удалённо».
 */
export function placeWithFormat(place: string | null | undefined, format: string | null | undefined) {
  const f = FORMAT_LC[(format ?? "").toLowerCase()] ?? "";
  // "Warsaw, Poland (Hybrid)": the format in brackets is said once, after the dot.
  const raw = placeRuLib((place ?? "").trim());
  const p = f ? raw.replace(/\s*\((?:удалённо|гибрид|офис)\)\s*$/i, "").trim() : raw;
  if (!f) return p;
  if (!p) return f.charAt(0).toUpperCase() + f.slice(1);
  return p.toLowerCase().includes(f) ? p : `${p} · ${f}`;
}

/** What a market figure is read for: «Middle · Европа, Удалённо» (Career marketBasis / benchmarkOffer().basis). */
export function marketBasisRu(b: { level: string; regions: string[] }) {
  const regions = regionsRu(b.regions);
  return [SENIORITY_LABEL[b.level] ?? b.level, regions].filter(Boolean).join(" · ");
}
