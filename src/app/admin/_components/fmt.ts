import { APP_TZ } from "@/lib/time";

const dateFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: APP_TZ, day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: APP_TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const shortFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", month: "short", year: "numeric" });

export const fmtDate = (d: Date | null | undefined) => (d ? dateFmt.format(d).replace(/\s?г\.$/, "") : "—");
export const fmtDateTime = (d: Date | null | undefined) => (d ? dateTimeFmt.format(d) : "—");
/** A bucket key ("2026-09-29" or "2026-09") as a short label. Keys are Almaty calendar dates, formatted as UTC. */
export const fmtKey = (k: string) => (k.length === 7 ? monthFmt.format(new Date(`${k}-01T00:00:00Z`)) : shortFmt.format(new Date(`${k}T00:00:00Z`)));

/** «5 мин назад», «3 ч назад», «2 дн. назад». */
export function ago(d: Date | null | undefined, now = Date.now()) {
  if (!d) return "никогда";
  const m = Math.max(0, Math.round((now - d.getTime()) / 60000));
  return m < 1 ? "только что" : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`;
}

export const fmtPct = (v: number) => `${v >= 10 || v === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")}%`;

export const PLAN_LABEL: Record<string, string> = { local: "Local", international: "International" };
export const CAMPAIGN_STATUS: Record<string, string> = { draft: "черновик", active: "активна", paused: "пауза", hired: "HIRED", expired: "завершена" };
export const PAYMENT_STATUS: Record<string, string> = { pending: "ожидает", paid: "оплачен", failed: "ошибка", expired: "истёк" };
/** Payment gateways by their internal key (the settle path), named neutrally for the owner. */
export const PROVIDER_LABEL: Record<string, string> = { kaspi: "Kaspi Pay", kaspi_mock: "Kaspi Pay · внутр. шлюз", test: "Внутренний шлюз" };
export const REFUND_REASON: Record<string, string> = { duplicate_charge: "двойное списание", campaign_already_active: "кампания уже шла", account_deleted: "аккаунт удалён" };

/** Request time (a module-level helper keeps the render pure for the linter; server pages render once per request). */
export const clock = () => Date.now();
