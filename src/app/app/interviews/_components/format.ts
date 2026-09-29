import { almatyDayDiff, assessmentDeadline, plural } from "../../../_components/ru";
import type { T } from "@/lib/i18n/translator";

export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Дата не назначена";

const DAYS = ["день", "дня", "дней"] as const;

/** "3 дня" with a non-breaking space, so the number never wraps away from its unit. */
export const daysWord = (n: number) => `${n} ${plural(n, DAYS)}`;

/** Relative day by Almaty calendar days: «сегодня», «завтра», «через 3 дня», «2 дня назад». */
export function relDays(d: Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const days = almatyDayDiff(d, now);
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === -1) return "вчера";
  if (days === 2) return "послезавтра";
  if (days === -2) return "позавчера";
  return days > 0 ? `через ${daysWord(days)}` : `${daysWord(-days)} назад`;
}

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export const nowMs = () => Date.now();

/** An assessment deadline: «ср, 30 сентября, до 23:59» — the shared wording (assessmentDeadline). */
export const deadlineText = (d: Date | null | undefined) => assessmentDeadline(d);

// ── Localized variants (take the `t` from getT() / useT(); the page must have «interviewsPage» in scope) ──

/** «29 сент., 15:05» · «Sep 29, 15:05»; no date → «Дата не назначена» in the current language. */
export const fmtDateT = (t: T, d: Date | null | undefined) =>
  d ? `${t.date(d, "dayMonthShort")}, ${t.time(d)}` : t("interviewsPage.format.noDate");

/** «3 дня» · «3 күн» · «3 days». */
export const daysWordT = (t: T, n: number) => t("interviewsPage.format.days", { n });

/** Relative day by Almaty calendar days, in the current language (same rules as relDays). */
export function relDaysT(t: T, d: Date | null | undefined, now = Date.now()) {
  if (!d) return "";
  const days = almatyDayDiff(d, now);
  if (days === 0) return t("interviewsPage.format.today");
  if (days === 1) return t("interviewsPage.format.tomorrow");
  if (days === -1) return t("interviewsPage.format.yesterday");
  if (days === 2) return t("interviewsPage.format.dayAfterTomorrow");
  if (days === -2) return t("interviewsPage.format.dayBeforeYesterday");
  return days > 0 ? t("interviewsPage.format.inDays", { n: days }) : t("interviewsPage.format.daysAgo", { n: -days });
}

/** An assessment deadline: «ср, 30 сентября, до 23:59» · «Wed, September 30, by 23:59»; no date → «не указан». */
export function deadlineTextT(t: T, d: Date | null | undefined, withTime = true) {
  if (!d) return t("interviewsPage.format.deadlineNone");
  const date = t.date(d, "weekdayDayMonth").replace(/\.,/, ",");
  return withTime ? t("interviewsPage.format.deadline", { date, time: t.time(d) }) : date;
}

/** Round name: «Рекрутер» · «Рекрутер» · «Recruiter»; unknown rounds are shown as stored. */
export function roundName(t: T, round: string) {
  return (ROUND_KEYS as readonly string[]).includes(round) ? t(`interviewsPage.rounds.${round as (typeof ROUND_KEYS)[number]}`) : round;
}
const ROUND_KEYS = ["assessment", "recruiter", "hiring_manager", "technical", "final", "offer"] as const;

/** Interview status label (lib/rounds IV_STATUS_LABEL), localized; «expired» = an assessment past its deadline. */
export function ivStatusName(t: T, status: string) {
  return (STATUS_KEYS as readonly string[]).includes(status) ? t(`interviewsPage.status.${status as (typeof STATUS_KEYS)[number]}`) : status;
}
const STATUS_KEYS = ["upcoming", "done", "passed", "failed", "cancelled", "expired"] as const;
