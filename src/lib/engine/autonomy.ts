// Agent permissions ("Agent" screen). Stored as JSON in User.autonomy; missing keys fall back to defaults.
import { isSimulation } from "../mode";

export type Autonomy = {
  findJobs: boolean; // discover new vacancies
  personalizeCv: boolean; // build application packages
  submitApplications: boolean; // auto-apply: submit roles with Match ≥ autoApplyMinMatch without asking (Apply/Auto roles go regardless)
  answerStandard: boolean; // answer standard screening questions (years, notice, relocation…)
  changeSalary: boolean; // may deviate from the salary expectation in answers
  outsideCountries: boolean; // may apply outside selected countries
  belowSalaryFloor: boolean; // may apply to roles paying below the minimum
  sensitive: "ask" | "decline"; // sensitive questions: always ask, or answer «Предпочитаю не указывать» (SENSITIVE_DECLINE)
  autoApplyMinMatch: number; // auto-apply threshold, 50..100 (always set; off/on is submitApplications)
};

export const AUTONOMY_DEFAULTS: Autonomy = {
  findJobs: true,
  personalizeCv: true,
  submitApplications: true,
  answerStandard: true,
  changeSalary: false,
  outsideCountries: false,
  belowSalaryFloor: false,
  sensitive: "ask",
  autoApplyMinMatch: 85,
};

/**
 * The user's own stored settings (defaults filled in), without the simulation's standing values. Writers use this so the
 * simulation overlay (SIMULATION_AUTONOMY) is never persisted as if the user had chosen it.
 */
export function readStoredAutonomy(raw: string | null | undefined): Autonomy {
  let parsed: Partial<Autonomy> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Partial<Autonomy>) : {};
  } catch {
    parsed = {};
  }
  const a = { ...AUTONOMY_DEFAULTS, ...parsed };
  if (a.sensitive !== "ask" && a.sensitive !== "decline") a.sensitive = "ask";
  a.autoApplyMinMatch = normalizeThreshold(a.autoApplyMinMatch);
  return a;
}

export function readAutonomy(raw: string | null | undefined): Autonomy {
  const a = readStoredAutonomy(raw);
  // Simulation mode: the agent does everything end to end — these standing values always hold (SIMULATION_AUTONOMY).
  return isSimulation() ? { ...a, ...SIMULATION_AUTONOMY } : a;
}

/**
 * Simulation mode's standing autonomy (src/lib/mode.ts): auto-apply to every qualified role (Match ≥ 70, the «подошла»
 * bar), standard questions answered, sensitive ones declined («Предпочитаю не указывать»). Nothing waits for the user.
 */
export const SIMULATION_AUTONOMY = { submitApplications: true, autoApplyMinMatch: 70, sensitive: "decline", answerStandard: true } as const satisfies Partial<Autonomy>;

/** Stored threshold → 50..100. Legacy null / garbage falls back to the default (85). */
export function normalizeThreshold(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return AUTONOMY_DEFAULTS.autoApplyMinMatch;
  return Math.max(50, Math.min(100, Math.round(n)));
}

/**
 * The one rule for "may the agent submit this role on its own?" (runTick, approvals, decisions all use it).
 * Apply/Auto are the user's explicit per-role go-ahead; otherwise auto-apply must be on and the role above the threshold.
 * Campaign.autoSubmit (the Privacy consent) is checked separately by the caller and gates every agent submission.
 */
export function agentMaySubmit(opp: { decision: string; match: number }, a: Pick<Autonomy, "submitApplications" | "autoApplyMinMatch">) {
  if (opp.decision === "skip") return false;
  if (opp.decision === "apply" || opp.decision === "auto") return true;
  return a.submitApplications && opp.match >= a.autoApplyMinMatch;
}

// submitApplications + autoApplyMinMatch are one control ("Auto-apply above N%"), rendered separately from these switches.
export const AUTONOMY_LABELS: { key: Exclude<keyof Autonomy, "sensitive" | "autoApplyMinMatch" | "submitApplications">; label: string; hint: string }[] = [
  { key: "findJobs", label: "Искать вакансии", hint: "Искать новые вакансии каждый день" },
  { key: "personalizeCv", label: "Адаптировать CV", hint: "Адаптировать CV и сопроводительное письмо под каждую вакансию" },
  { key: "answerStandard", label: "Отвечать на стандартные вопросы", hint: "Опыт, срок выхода на работу, переезд, мотивация" },
  { key: "changeSalary", label: "Менять ожидания по зарплате", hint: "Отклоняться от твоей зарплатной вилки в ответах" },
  { key: "outsideCountries", label: "Подавать вне выбранных стран", hint: "Подавать заявки за пределами выбранных стран" },
  { key: "belowSalaryFloor", label: "Подавать ниже минимальной зарплаты", hint: "Подавать заявки на вакансии ниже минимальной зарплаты" },
];

/** The answer the agent gives an employer to a sensitive question when Autonomy.sensitive = "decline" (employer-facing, English). */
export const SENSITIVE_DECLINE = "I prefer not to answer";
/** Earlier wording of the same answer, still stored on older approvals. */
export const SENSITIVE_DECLINE_LEGACY = "I don't wish to answer";
/** The same choice as the user sees it everywhere in the Russian UI. */
export const SENSITIVE_DECLINE_RU = "Предпочитаю не указывать";

/** A stored (English, employer-facing) screening answer as the Russian UI shows it: Yes → «Да», the opt-out → «Предпочитаю не указывать». */
export function answerRu(answer: string) {
  const a = answer.trim();
  if (a === SENSITIVE_DECLINE || a === SENSITIVE_DECLINE_LEGACY || /^(decline to self-identify|prefer not to (say|answer)|i prefer not to (say|answer))$/i.test(a)) return SENSITIVE_DECLINE_RU;
  if (/^yes$/i.test(a)) return "Да";
  if (/^no$/i.test(a)) return "Нет";
  return answer;
}

/** The only switches the Agent form shows in simulation (the rest are standing rules or hidden there). */
export const SIMULATION_FORM_FIELDS = ["findJobs", "personalizeCv"] as const;

/**
 * The Agent form applied to the stored settings. In simulation the form shows only SIMULATION_FORM_FIELDS: every other
 * field keeps the user's stored value (never replaced by the simulation's standing values or by absent inputs).
 */
export function mergeAutonomyForm(before: Autonomy, form: Pick<FormData, "get">, simulation: boolean): Autonomy | { error: string } {
  if (simulation) {
    const kept: Autonomy = { ...before };
    for (const k of SIMULATION_FORM_FIELDS) kept[k] = form.get(k) === "on";
    return kept;
  }
  const next: Autonomy = { ...AUTONOMY_DEFAULTS };
  for (const { key } of AUTONOMY_LABELS) next[key] = form.get(key) === "on";

  const sensitive = String(form.get("sensitive") ?? "");
  if (sensitive !== "ask" && sensitive !== "decline") return { error: "Выбери, как агент отвечает на чувствительные вопросы." };
  next.sensitive = sensitive;

  // One control, two fields (the same ones the Opportunities switch writes): the switch is submitApplications,
  // the slider is the threshold. The threshold is always kept, so turning auto-apply back on restores it.
  next.submitApplications = form.get("submitApplications") === "on";
  const raw = String(form.get("autoApplyMinMatch") ?? "").trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 50 || n > 100) return { error: "Порог Match должен быть от 50 до 100%." };
  next.autoApplyMinMatch = Math.round(n);
  return next;
}
