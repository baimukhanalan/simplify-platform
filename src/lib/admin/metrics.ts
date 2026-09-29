// Admin analytics — pure helpers (no DB): periods, Almaty day/week buckets, medians, the signup→HIRED funnel.
import { APP_TZ } from "../time";
import { campaignDay as appCampaignDay } from "../campaign-day";

export const DAY = 86400000;

/** Cookie holding the admin's user search: the query (it may be an e-mail) never goes into a URL. */
export const ADMIN_SEARCH_COOKIE = "adm_uq";

/* ——— Periods ——— */

export const PERIODS = [
  { key: "7", label: "7 дней", days: 7 },
  { key: "30", label: "30 дней", days: 30 },
  { key: "90", label: "90 дней", days: 90 },
  { key: "all", label: "Всё время", days: null },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function parsePeriod(v: unknown, fallback: PeriodKey = "30"): PeriodKey {
  const s = Array.isArray(v) ? v[0] : v;
  return PERIODS.some((p) => p.key === s) ? (s as PeriodKey) : fallback;
}

/** Start of the period: 00:00 Almaty of the first day (today counts as day 1). null = all time. */
export function periodStart(p: PeriodKey, now = new Date()): Date | null {
  const days = PERIODS.find((x) => x.key === p)!.days;
  if (days == null) return null;
  const today = dayStartMs(now.getTime());
  return new Date(today - (days - 1) * DAY);
}

/* ——— Almaty calendar buckets (offset cached per UTC hour: one Intl call per hour of data, not per row) ——— */

const offFmt = new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const offCache = new Map<number, number>();
function tzOffset(t: number) {
  const h = Math.floor(t / 3600000);
  let off = offCache.get(h);
  if (off == null) {
    const p = Object.fromEntries(offFmt.formatToParts(new Date(h * 3600000)).map((x) => [x.type, x.value]));
    off = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - h * 3600000;
    if (offCache.size > 200_000) offCache.clear();
    offCache.set(h, off);
  }
  return off;
}

/** 00:00 Almaty of the day containing t (absolute ms). */
export function dayStartMs(t: number) {
  const off = tzOffset(t);
  return Math.floor((t + off) / DAY) * DAY - off;
}

/** "2026-09-29" — the Almaty calendar day of t. */
export function dayKey(t: number) {
  const off = tzOffset(t);
  return new Date(Math.floor((t + off) / DAY) * DAY).toISOString().slice(0, 10);
}

/** The Monday (Almaty) of t's week, as "YYYY-MM-DD". */
export function weekKey(t: number) {
  const off = tzOffset(t);
  const local = Math.floor((t + off) / DAY) * DAY;
  const dow = (new Date(local).getUTCDay() + 6) % 7; // Mon = 0
  return new Date(local - dow * DAY).toISOString().slice(0, 10);
}

/** "2026-09" — the Almaty month of t. */
export const monthKey = (t: number) => dayKey(t).slice(0, 7);

export type Granularity = "day" | "week" | "month";

/** Bucket keys covering [from, to], oldest first (walks Almaty days; capped at `max` keys). */
export function bucketKeys(from: number, to: number, g: Granularity, max = 400): string[] {
  const keyOf = keyFn(g);
  const out: string[] = [];
  for (let t = dayStartMs(from) + DAY / 2; t <= to + DAY / 2 && out.length <= max; t += DAY) {
    const k = keyOf(Math.min(t, to));
    if (out[out.length - 1] !== k) out.push(k);
  }
  return out.slice(-max);
}

/** Granularity for a period: daily up to 120 days, weekly up to ~2 years, monthly beyond. */
export function granularityFor(fromMs: number, toMs: number): Granularity {
  const days = (toMs - fromMs) / DAY;
  return days <= 120 ? "day" : days <= 730 ? "week" : "month";
}

export const keyFn = (g: Granularity) => (g === "day" ? dayKey : g === "week" ? weekKey : monthKey);

/* ——— Stats ——— */

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

/** «ab•••@mail.kz» — never the full address on screen by default. */
export function maskEmail(e: string) {
  const at = e.lastIndexOf("@");
  if (at < 1) return "•••";
  const local = e.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length - 1) || 1)}•••${e.slice(at)}`;
}

/* ——— Funnel ——— */

export const FUNNEL_STEPS = [
  { key: "signup", label: "Регистрация", short: "Регистрация" },
  { key: "onboarded", label: "Онбординг: профиль и цель", short: "Онбординг" },
  { key: "paid", label: "Оплата кампании", short: "Оплата" },
  { key: "applied", label: "Первая заявка отправлена", short: "Заявка" },
  { key: "replied", label: "Первый ответ работодателя", short: "Ответ" },
  { key: "interview", label: "Первое интервью", short: "Интервью" },
  { key: "offer", label: "Оффер", short: "Оффер" },
  { key: "hired", label: "HIRED", short: "HIRED" },
] as const;
export type StepKey = (typeof FUNNEL_STEPS)[number]["key"];
/** When each step was first reached (ms). A missing key = not reached (or reached without a timestamp, see reachedIndex). */
export type StepTimes = Partial<Record<StepKey, number>> & { signup: number };

/**
 * The furthest step reached. Steps are monotone: a user with an offer has, by definition, applied and got a reply even
 * if one of those rows is missing (an offer typed in by hand, a HIRED mark without an Offer row).
 */
export function reachedIndex(t: StepTimes) {
  for (let i = FUNNEL_STEPS.length - 1; i >= 0; i--) if (t[FUNNEL_STEPS[i].key] != null) return i;
  return 0;
}
export const stageOf = (t: StepTimes): StepKey => FUNNEL_STEPS[reachedIndex(t)].key;
export const stageLabel = (k: StepKey) => FUNNEL_STEPS.find((s) => s.key === k)?.short ?? k;

export type FunnelRow = { key: StepKey; label: string; count: number; pctStep: number; pctTotal: number; dropped: number; medianDays: number | null; timed: number };

export function buildFunnel(users: Iterable<StepTimes>): FunnelRow[] {
  const counts = FUNNEL_STEPS.map(() => 0);
  const gaps: number[][] = FUNNEL_STEPS.map(() => []);
  for (const u of users) {
    const r = reachedIndex(u);
    for (let i = 0; i <= r; i++) counts[i]++;
    for (let i = 1; i <= r; i++) {
      const a = u[FUNNEL_STEPS[i - 1].key], b = u[FUNNEL_STEPS[i].key];
      if (a != null && b != null) gaps[i].push(Math.max(0, b - a) / DAY);
    }
  }
  const total = counts[0];
  return FUNNEL_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    count: counts[i],
    pctStep: i === 0 ? (total ? 100 : 0) : pct(counts[i], counts[i - 1]),
    pctTotal: pct(counts[i], total),
    dropped: i === 0 ? 0 : counts[i - 1] - counts[i],
    medianDays: i === 0 ? null : median(gaps[i]),
    timed: gaps[i].length,
  }));
}

/** The step transition that loses the most people (by share), among steps with a meaningful base. */
export function worstDrop(rows: FunnelRow[], minBase = 5) {
  let worst: { from: FunnelRow; to: FunnelRow; lossPct: number } | null = null;
  for (let i = 1; i < rows.length; i++) {
    const base = rows[i - 1].count;
    if (base < minBase) continue;
    const loss = 100 - rows[i].pctStep;
    if (!worst || loss > worst.lossPct) worst = { from: rows[i - 1], to: rows[i], lossPct: loss };
  }
  return worst;
}

export type CohortRow = { week: string; signups: number; reached: number[] };

/** Signup-week cohorts, newest first: for each week, how many users reached each funnel step. */
export function buildCohorts(users: Iterable<StepTimes>, maxWeeks = 12): CohortRow[] {
  const by = new Map<string, number[]>();
  for (const u of users) {
    const w = weekKey(u.signup);
    let row = by.get(w);
    if (!row) by.set(w, (row = FUNNEL_STEPS.map(() => 0)));
    const r = reachedIndex(u);
    for (let i = 0; i <= r; i++) row[i]++;
  }
  return [...by.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, maxWeeks)
    .map(([week, reached]) => ({ week, signups: reached[0], reached }));
}

/* ——— Campaign day ——— */

/** «день X из Y» of a started campaign — the app's formula (src/lib/campaign-day.ts: day 1 is the start day); null before the start. */
export function campaignDay(c: { startedAt: Date | null; endsAt: Date | null; bonusDays?: number }, now = Date.now(), planDays = 60) {
  if (!c.startedAt) return null;
  return appCampaignDay(c, now, planDays);
}

/** Bonus days split by origin: the interview guarantee adds GUARANTEE_DAYS once (guaranteeStatus "extended"); the rest are referral rewards. */
export function bonusBreakdown(c: { bonusDays: number; guaranteeStatus: string }, guaranteeDays = 30) {
  const guarantee = c.guaranteeStatus === "extended" ? Math.min(guaranteeDays, Math.max(0, c.bonusDays)) : 0;
  return { total: c.bonusDays, guarantee, referral: Math.max(0, c.bonusDays - guarantee) };
}
