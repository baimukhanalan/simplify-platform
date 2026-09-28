// Agent permissions ("Agent" screen). Stored as JSON in User.autonomy; missing keys fall back to defaults.

export type Autonomy = {
  findJobs: boolean; // discover new vacancies
  personalizeCv: boolean; // build application packages
  submitApplications: boolean; // submit without asking
  answerStandard: boolean; // answer standard screening questions (years, notice, relocation…)
  changeSalary: boolean; // may deviate from the salary expectation in answers
  outsideCountries: boolean; // may apply outside selected countries
  belowSalaryFloor: boolean; // may apply to roles paying below the minimum
  sensitive: "ask" | "decline"; // sensitive questions: always ask, or answer "prefer not to say"
  autoApplyMinMatch: number | null; // auto-submit only above this Match (null = any qualified role)
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

export function readAutonomy(raw: string | null | undefined): Autonomy {
  let parsed: Partial<Autonomy> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Partial<Autonomy>) : {};
  } catch {
    parsed = {};
  }
  const a = { ...AUTONOMY_DEFAULTS, ...parsed };
  if (a.sensitive !== "ask" && a.sensitive !== "decline") a.sensitive = "ask";
  if (a.autoApplyMinMatch != null) a.autoApplyMinMatch = Math.max(50, Math.min(100, Math.round(Number(a.autoApplyMinMatch) || 85)));
  return a;
}

export const AUTONOMY_LABELS: { key: Exclude<keyof Autonomy, "sensitive" | "autoApplyMinMatch">; label: string; hint: string }[] = [
  { key: "findJobs", label: "Find jobs", hint: "Искать новые вакансии каждый день" },
  { key: "personalizeCv", label: "Personalize CV", hint: "Адаптировать CV и cover letter под каждую вакансию" },
  { key: "submitApplications", label: "Submit applications", hint: "Отправлять заявки без отдельного подтверждения" },
  { key: "answerStandard", label: "Answer standard questions", hint: "Опыт, notice period, relocation, мотивация" },
  { key: "changeSalary", label: "Change salary expectation", hint: "Отклоняться от вашей зарплатной вилки в ответах" },
  { key: "outsideCountries", label: "Apply outside selected countries", hint: "Подаваться за пределами выбранных стран" },
  { key: "belowSalaryFloor", label: "Apply below salary floor", hint: "Подаваться на вакансии ниже минимальной зарплаты" },
];
