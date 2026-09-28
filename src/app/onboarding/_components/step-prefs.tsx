"use client";
import { useId, useState, type ReactNode } from "react";
import { savePreferences, type FormState } from "@/lib/actions/onboarding";
import { cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { BackLink, FieldErr, FormAlert } from "./shared";

type Prefs = {
  citizenship: string; workAuth: string[]; needsSponsorship: boolean; relocation: boolean; englishLevel: string; remotePref: string;
  salaryExpectation: number; city: string; noticePeriod: string; linkedin: string; github: string; portfolio: string;
};

const CITIZENSHIP: [string, string][] = [
  ["KZ", "Казахстан"], ["UZ", "Узбекистан"], ["KG", "Кыргызстан"], ["TJ", "Таджикистан"], ["TM", "Туркменистан"], ["RU", "Россия"], ["BY", "Беларусь"],
  ["UA", "Украина"], ["AM", "Армения"], ["GE", "Грузия"], ["AZ", "Азербайджан"], ["MN", "Монголия"], ["TR", "Турция"], ["DE", "Германия"], ["PL", "Польша"],
  ["GB", "Великобритания"], ["US", "США"], ["CA", "Канада"], ["AE", "ОАЭ"],
];
const AUTH: [string, string][] = [
  ["KZ", "Казахстан"], ["UZ", "Узбекистан"], ["KG", "Кыргызстан"], ["RU", "Россия"], ["AM", "Армения"], ["GE", "Грузия"], ["AZ", "Азербайджан"],
  ["EU", "Евросоюз"], ["GB", "Великобритания"], ["US", "США"], ["CA", "Канада"], ["AE", "ОАЭ"],
];
const ENGLISH = [["A1", "Beginner"], ["A2", "Elementary"], ["B1", "Intermediate"], ["B2", "Upper-Int."], ["C1", "Advanced"], ["C2", "Proficient"]];
const REMOTE = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "Onsite"], ["any", "Любой"]];

export function StepPrefs({ initial, euCountries }: { initial: Prefs; euCountries: string[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(savePreferences, undefined);
  const [salary, setSalary] = useState(initial.salaryExpectation ? String(initial.salaryExpectation) : "");
  const id = useId();
  const f = state?.fields ?? {};
  const hasEU = euCountries.every((c) => initial.workAuth.includes(c));
  const listed = new Set(AUTH.map(([c]) => c));
  const extras = initial.workAuth.filter((c) => !listed.has(c) && !(hasEU && euCountries.includes(c)));
  const monthly = Number(salary.replace(/\D/g, "")) / 12;

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Section title="Гражданство и право на работу" hint="Определяет, куда агент может подаваться без визы.">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label">Гражданство</span>
            <select name="citizenship" defaultValue={initial.citizenship} className="field" aria-invalid={Boolean(f.citizenship)} aria-describedby={f.citizenship ? `${id}-cit` : undefined}>
              {CITIZENSHIP.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
            </select>
            <FieldErr id={`${id}-cit`}>{f.citizenship}</FieldErr>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Город</span>
            <input name="city" defaultValue={initial.city} maxLength={80} autoComplete="address-level2" placeholder="Алматы" className="field" />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-2">Есть легальное право работать (кроме гражданства)</legend>
          <div className="flex flex-wrap gap-2">
            {AUTH.map(([c, l]) => (
              <ChipCheck key={c} name="workAuth" value={c} defaultChecked={c === "EU" ? hasEU : initial.workAuth.includes(c)}>{l}</ChipCheck>
            ))}
          </div>
          {extras.map((c) => <input key={c} type="hidden" name="workAuth" value={c} />)}
          <span className="text-[12px] text-ink-3">ВНЖ, рабочая виза, Blue Card, green card. Не отмечайте то, чего нет — агент проверяет это в каждой заявке.</span>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle name="needsSponsorship" defaultChecked={initial.needsSponsorship} title="Нужно спонсорство визы" hint="Для стран, где нет права на работу" />
          <Toggle name="relocation" defaultChecked={initial.relocation} title="Готов(а) к переезду" hint="Иначе onsite за рубежом блокируется" />
        </div>
      </Section>

      <Section title="Язык и формат">
        <fieldset>
          <legend className="label mb-2">Английский</legend>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {ENGLISH.map(([v, l]) => (
              <label key={v} className="flex cursor-pointer flex-col items-center rounded-2xl border border-line bg-white/60 px-2 py-2 transition-colors has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="radio" name="englishLevel" value={v} defaultChecked={initial.englishLevel === v} className="sr-only" />
                <span className="num text-[15px]">{v}</span>
                <span className="text-[10.5px] opacity-70">{l}</span>
              </label>
            ))}
          </div>
          <FieldErr id={`${id}-en`}>{f.englishLevel}</FieldErr>
        </fieldset>
        <fieldset>
          <legend className="label mb-2">Предпочтительный формат</legend>
          <div className="flex flex-wrap gap-2">
            {REMOTE.map(([v, l]) => (
              <label key={v} className="cursor-pointer rounded-full border border-line bg-white/60 px-4 py-2 text-[13.5px] text-ink-2 transition-colors has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="radio" name="remotePref" value={v} defaultChecked={initial.remotePref === v} className="sr-only" />{l}
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section title="Зарплата и доступность">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label">Ожидание, USD в год</span>
            <input name="salaryExpectation" value={salary} onChange={(e) => setSalary(e.target.value.replace(/[^\d]/g, "").slice(0, 7))} inputMode="numeric" placeholder="36000" className="field num" aria-invalid={Boolean(f.salaryExpectation)} aria-describedby={`${id}-sal`} />
            <span id={`${id}-sal`} className="text-[12px] text-ink-3">{f.salaryExpectation ? <span className="text-rose">{f.salaryExpectation}</span> : monthly > 0 ? `≈ $${Math.round(monthly).toLocaleString("en-US")} в месяц до налогов` : "Используется в ответах на вопросы о зарплате"}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Когда можете выйти</span>
            <select name="noticePeriod" defaultValue={initial.noticePeriod} className="field">
              {["Immediately", "1 week", "2 weeks", "1 month", "2 months"].map((v) => <option key={v} value={v}>{{ Immediately: "Сразу", "1 week": "Через 1 неделю", "2 weeks": "Через 2 недели", "1 month": "Через месяц", "2 months": "Через 2 месяца" }[v]}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Ссылки" hint="Многие ATS требуют LinkedIn в форме заявки.">
        <div className="grid gap-4 sm:grid-cols-3">
          {(["linkedin", "github", "portfolio"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1.5">
              <span className="label">{{ linkedin: "LinkedIn", github: "GitHub", portfolio: "Портфолио" }[k]}</span>
              <input name={k} defaultValue={initial[k]} inputMode="url" autoComplete="url" maxLength={200} placeholder={{ linkedin: "linkedin.com/in/…", github: "github.com/…", portfolio: "https://…" }[k]} className="field" aria-invalid={Boolean(f[k])} aria-describedby={f[k] ? `${id}-${k}` : undefined} />
              <FieldErr id={`${id}-${k}`}>{f[k]}</FieldErr>
            </label>
          ))}
        </div>
      </Section>

      <FormAlert error={state?.error} />
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <BackLink step={4} />
        <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[14.5px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
          {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Сохранить и дальше →
        </button>
      </div>
    </form>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-5 p-5 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-medium text-head">{title}</h2>
        {hint && <p className="text-[13px] text-ink-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function ChipCheck({ name, value, defaultChecked, children, type = "checkbox" }: { name: string; value: string; defaultChecked?: boolean; children: ReactNode; type?: "checkbox" | "radio" }) {
  return (
    <label className="cursor-pointer rounded-full border border-line bg-white/60 px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-teal/40 has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:checked]:text-green has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
      <input type={type} name={name} value={value} defaultChecked={defaultChecked} className="sr-only" />{children}
    </label>
  );
}

export function Toggle({ name, defaultChecked, title, hint }: { name: string; defaultChecked?: boolean; title: string; hint?: string }) {
  return (
    <label className={cx("flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line bg-white/60 px-4 py-3 transition-colors has-[:checked]:border-green/30 has-[:checked]:bg-green-soft/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green")}>
      <span className="flex flex-col">
        <span className="text-[14px] text-head">{title}</span>
        {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} className="peer absolute inset-0 z-10 cursor-pointer opacity-0" />
        <span className="absolute inset-0 rounded-full bg-head/15 transition-colors peer-checked:bg-green" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-300 peer-checked:translate-x-5" />
      </span>
    </label>
  );
}
