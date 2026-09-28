// Tiny Russian text helpers shared by the UI. Pure: safe on server and client.

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
export const WORK_MODE_RU: Record<string, string> = { remote: "Удалённо", hybrid: "Гибрид", onsite: "Офис", any: "Любой формат" };

/** Campaign mode (Goal). */
export const CAMPAIGN_MODE_RU: Record<string, string> = { autonomous: "Автономный", target: "Точечный — компании мечты", mass: "Массовый найм" };

/** Application status in Russian — chips, inbox, timelines. Unknown keys fall back to the key itself. */
export const STATUS_RU: Record<string, string> = {
  found: "Найдена", qualified: "Подходит", prepared: "Пакет готов", submitted: "Отправлено", pending: "Ждём ответа",
  assessment: "Тестовое задание", recruiter: "Скрининг с рекрутером", hiring_manager: "Интервью с менеджером", technical: "Техническое интервью",
  final: "Финальное интервью", offer: "Оффер", hired: "HIRED", rejected: "Отказ", skipped: "Пропущено", blocked: "Недоступно",
};
export const statusRu = (s: string) => STATUS_RU[s] ?? s;
