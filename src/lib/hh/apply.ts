import "server-only";
import { startOfToday } from "../time";
import { applyToVacancy, getVacancy, hhEnabled, hhIntegration, HhAuthError, HhError, HH_MESSAGE_MAX, patchHhMeta, readHhMeta, type ApplyFailure } from "./client";

/**
 * hh apply adapter for submit() (src/lib/engine/agent.ts). The caller already enforced consent, autonomy, the daily
 * limit and open questions; this only decides whether hh's API can send THIS application as the user — with their own
 * resume and the package's cover letter — or whether the user has to do it on hh.kz themselves (handoff).
 * Never fabricates test/questionnaire answers.
 */
export type HhSubmitOutcome =
  | { kind: "sent"; method: "hh-api"; negotiationId: string | null; already?: boolean }
  | { kind: "handoff"; reason: string; url: string; detail?: string }
  /** Nothing is sent now; the role stays prepared and the next cycle tries again (rate limit / hh daily limit). */
  | { kind: "later"; reason: string; detail?: string }
  /** The vacancy is gone at hh. */
  | { kind: "closed"; reason: string };

/** Plain text for hh's message field: no Markdown, collapsed blank lines, cut at a word boundary under hh's limit. */
export function hhCoverLetter(text: string, max = HH_MESSAGE_MAX) {
  let t = (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim();
  if (t.length > max) {
    const cut = t.slice(0, max - 1);
    t = `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 200)).trimEnd()}…`;
  }
  return t;
}

const FAIL_RU: Record<ApplyFailure, string> = {
  already_applied: "уже есть отклик",
  test_required: "работодатель требует пройти тест или ответить на вопросы на hh.kz — агент не отвечает за тебя",
  letter_required: "нужно сопроводительное письмо, а в пакете его нет",
  resume_not_visible: "выбранное резюме скрыто или не опубликовано на hh.kz — открой его для работодателей или выбери другое",
  limit_exceeded: "на hh.kz исчерпан дневной лимит откликов",
  vacancy_closed: "вакансия закрыта",
  external_apply: "работодатель принимает отклики только на своём сайте",
  not_allowed: "hh.kz не разрешает отклик на эту вакансию с твоего резюме",
  captcha: "hh.kz попросил подтвердить действие вручную",
  auth: "доступ к hh.kz истёк — переподключи аккаунт в «Агент» → hh.kz",
  rate_limited: "hh.kz временно ограничил частоту запросов",
  bad_request: "hh.kz отклонил запрос",
  unknown: "hh.kz вернул ошибку",
};

export const hhVacancyId = (externalId: string) => externalId.replace(/^hh-/, "");

/** An http(s) link, or null: a handoff URL from hh's API (employer-controlled response_url) is rendered as a link. */
export const safeHttpUrl = (raw: string | null | undefined) => {
  const t = (raw ?? "").trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    return new URL(t).toString();
  } catch {
    return null;
  }
};

export async function submitViaHh(userId: string, job: { externalId: string; url: string }, coverLetter: string): Promise<HhSubmitOutcome> {
  const url = safeHttpUrl(job.url) ?? `https://hh.kz/vacancy/${encodeURIComponent(hhVacancyId(job.externalId))}`;
  // Only http(s) links ever become a handoff (never javascript:, data: …); anything else falls back to the vacancy page.
  const handoff = (why: string, detail?: string, to: string | null | undefined = url): HhSubmitOutcome => ({ kind: "handoff", reason: `Отправь отклик на hh.kz сам: ${why}.`, url: safeHttpUrl(to) ?? url, detail });
  if (!hhEnabled()) return handoff("интеграция hh.kz ещё не включена на сервере");
  const row = await hhIntegration(userId);
  if (!row || !row.accessToken) return handoff("аккаунт hh.kz не подключён (подключи в «Агент» → hh.kz — и агент будет откликаться сам)");
  const meta = readHhMeta(row.meta);
  if (meta.status === "reconnect") return handoff(FAIL_RU.auth);
  if (!row.resumeId) return handoff("не выбрано резюме hh.kz (выбери в «Агент» → hh.kz)");
  // hh's daily negotiation limit was hit today: don't hammer the API, keep the role for tomorrow.
  const today = startOfToday().toISOString().slice(0, 10);
  if (meta.limitDay === today) return { kind: "later", reason: FAIL_RU.limit_exceeded };

  const vacancyId = hhVacancyId(job.externalId);
  let vacancy;
  try {
    vacancy = await getVacancy(vacancyId, userId);
  } catch (e) {
    if (e instanceof HhAuthError) return handoff(FAIL_RU.auth);
    if (e instanceof HhError && e.status === 404) return { kind: "closed", reason: FAIL_RU.vacancy_closed };
    if (e instanceof HhError && e.status === 429) return { kind: "later", reason: FAIL_RU.rate_limited };
    throw e;
  }
  if (vacancy.archived) return { kind: "closed", reason: FAIL_RU.vacancy_closed };
  if (vacancy.response_url) return handoff(FAIL_RU.external_apply, undefined, vacancy.response_url);
  if (vacancy.has_test && vacancy.test?.required !== false) return handoff(FAIL_RU.test_required);
  const message = hhCoverLetter(coverLetter);
  if (vacancy.response_letter_required && !message) return handoff(FAIL_RU.letter_required);

  const r = await applyToVacancy(userId, { vacancyId, resumeId: row.resumeId, message: message || undefined });
  if (r.ok) return { kind: "sent", method: "hh-api", negotiationId: r.negotiationId };
  switch (r.reason) {
    case "already_applied":
      return { kind: "sent", method: "hh-api", negotiationId: null, already: true };
    case "limit_exceeded":
      await patchHhMeta(userId, { limitDay: today });
      return { kind: "later", reason: FAIL_RU.limit_exceeded, detail: r.detail };
    case "rate_limited":
      return { kind: "later", reason: FAIL_RU.rate_limited, detail: r.detail };
    case "vacancy_closed":
      return { kind: "closed", reason: FAIL_RU.vacancy_closed };
    case "external_apply":
      return handoff(FAIL_RU.external_apply, r.detail, vacancy.response_url || url);
    default:
      return handoff(FAIL_RU[r.reason], r.detail);
  }
}
