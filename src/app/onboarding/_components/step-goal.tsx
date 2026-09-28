"use client";
import { useId, useState, type ReactNode } from "react";
import { Bot, Crosshair, Layers } from "lucide-react";
import { saveGoal, type FormState } from "@/lib/actions/onboarding";
import { marketRange } from "@/lib/engine/market";
import { classifyRole, SENIORITY, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { BackLink, FieldErr, FormAlert } from "./shared";
import { ChipCheck } from "./step-prefs";

type Goal = { primaryRole: string; extraRoles: string[]; seniority: string; minSalary: number; countries: string[]; workModes: string[]; industries: string[]; dreamCompanies: string[]; mode: string };

const MODES = [
  { v: "autonomous", icon: Bot, title: "Autonomous", text: "Агент сам балансирует объём и качество, учится на ответах. Рекомендуем." },
  { v: "target", icon: Crosshair, title: "Target", text: "Фокус на компаниях мечты: меньше заявок, глубже персонализация." },
  { v: "mass", icon: Layers, title: "Mass", text: "Максимум релевантных заявок, приоритет массового найма и скорости." },
];

export function StepGoal({ initial, years, suggestedSeniority, roleSuggestions, regions, roleLabels }: { initial: Goal; years: number; suggestedSeniority: string; roleSuggestions: string[]; regions: { key: string; label: string }[]; roleLabels: string[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveGoal, undefined);
  const [role, setRole] = useState(initial.primaryRole);
  const [seniority, setSeniority] = useState(initial.seniority);
  const [countries, setCountries] = useState<string[]>(initial.countries.length ? initial.countries : ["KZ", "CIS"]);
  const [salary, setSalary] = useState(initial.minSalary ? String(initial.minSalary) : "");
  const id = useId();
  const f = state?.fields ?? {};
  const range = marketRange(classifyRole(role), seniority, countries);
  const sal = Number(salary || 0);
  const toggleCountry = (k: string) => setCountries((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Section title="Роль">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-role`} className="label">Основная роль</label>
          <input id={`${id}-role`} name="primaryRole" value={role} onChange={(e) => setRole(e.target.value)} list={`${id}-roles`} maxLength={100} autoComplete="off" placeholder="Например, Data Analyst" className="field" aria-invalid={Boolean(f.primaryRole)} aria-describedby={f.primaryRole ? `${id}-role-err` : undefined} />
          <datalist id={`${id}-roles`}>{roleLabels.map((r) => <option key={r} value={r} />)}</datalist>
          <FieldErr id={`${id}-role-err`}>{f.primaryRole}</FieldErr>
          {roleSuggestions.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink-3">По вашим навыкам:</span>
              {roleSuggestions.map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r} className={cx("rounded-full border px-3 py-1 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-green", role === r ? "border-green/40 bg-green-soft text-green" : "border-line bg-white/60 text-ink-2 hover:border-teal/40")}>{r}</button>
              ))}
            </div>
          )}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label">Дополнительные роли <span className="normal-case tracking-normal text-ink-4">(через запятую, до 4)</span></span>
          <input name="extraRoles" defaultValue={initial.extraRoles.join(", ")} maxLength={300} placeholder="Product Analyst, BI Analyst" className="field" />
        </label>
        <fieldset>
          <legend className="label mb-2">Уровень</legend>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {SENIORITY.map((v) => (
              <label key={v} className="relative flex cursor-pointer flex-col items-center rounded-2xl border border-line bg-white/60 px-2 py-2.5 text-[13.5px] transition-colors has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="radio" name="seniority" value={v} checked={seniority === v} onChange={() => setSeniority(v)} className="sr-only" />
                {SENIORITY_LABEL[v]}
                {v === suggestedSeniority && <span className="absolute -top-2 rounded-full bg-green px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide text-white">по опыту</span>}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-ink-3">У вас {years} г. опыта — реалистичный уровень: {SENIORITY_LABEL[suggestedSeniority]}. Цель выше — возможна, но Readiness покажет риски.</p>
          <FieldErr id={`${id}-sen`}>{f.seniority}</FieldErr>
        </fieldset>
      </Section>

      <Section title="География и формат">
        <fieldset aria-describedby={f.countries ? `${id}-c-err` : undefined}>
          <legend className="label mb-2">Регионы</legend>
          <div className="flex flex-wrap gap-2">
            {regions.map((r) => (
              <label key={r.key} className="cursor-pointer rounded-full border border-line bg-white/60 px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:border-teal/40 has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:checked]:text-green has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="checkbox" name="countries" value={r.key} checked={countries.includes(r.key)} onChange={() => toggleCountry(r.key)} className="sr-only" />{r.label}
              </label>
            ))}
          </div>
          <FieldErr id={`${id}-c-err`}>{f.countries}</FieldErr>
        </fieldset>
        <fieldset aria-describedby={f.workModes ? `${id}-m-err` : undefined}>
          <legend className="label mb-2">Форматы работы</legend>
          <div className="flex flex-wrap gap-2">
            {[["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "Onsite"]].map(([v, l]) => <ChipCheck key={v} name="workModes" value={v} defaultChecked={initial.workModes.includes(v)}>{l}</ChipCheck>)}
          </div>
          <FieldErr id={`${id}-m-err`}>{f.workModes}</FieldErr>
        </fieldset>
      </Section>

      <Section title="Деньги и компании">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label">Минимум, USD в год</span>
            <input name="minSalary" value={salary} onChange={(e) => setSalary(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder={String(range.mid)} className="field num" aria-describedby={`${id}-mkt`} />
            <span id={`${id}-mkt`} className="text-[12px] text-ink-3">
              Рынок (оценка): <span className="num">${Math.round(range.low / 1000)}k–${Math.round(range.high / 1000)}k</span>
              {sal > range.high && <span className="text-amber"> · выше рынка — отсечёт много вакансий</span>}
              {sal > 0 && sal <= range.mid && <span className="text-green"> · реалистично</span>}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Индустрии <span className="normal-case tracking-normal text-ink-4">(необязательно)</span></span>
            <input name="industries" defaultValue={initial.industries.join(", ")} maxLength={300} placeholder="Fintech, SaaS, E-commerce" className="field" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label">Компании мечты <span className="normal-case tracking-normal text-ink-4">(через запятую)</span></span>
          <input name="dreamCompanies" defaultValue={initial.dreamCompanies.join(", ")} maxLength={500} placeholder="Kaspi, Wise, Revolut" className="field" />
        </label>
      </Section>

      <Section title="Режим кампании">
        <fieldset>
          <legend className="sr-only">Режим</legend>
          <div className="grid gap-2 md:grid-cols-3">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <label key={m.v} className="flex cursor-pointer flex-col gap-2 rounded-2xl border border-line bg-white/60 p-4 transition-colors has-[:checked]:border-green/40 has-[:checked]:bg-green-soft/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
                  <span className="flex items-center gap-2 text-[14.5px] font-medium text-head">
                    <input type="radio" name="mode" value={m.v} defaultChecked={initial.mode === m.v} className="accent-[#1a6e48]" />
                    <Icon className="size-4 text-teal" strokeWidth={1.7} aria-hidden />{m.title}
                  </span>
                  <span className="text-[12.5px] leading-relaxed text-ink-3">{m.text}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </Section>

      <FormAlert error={state?.error} />
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <BackLink step={5} />
        <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[14.5px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
          {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Проверить реалистичность →
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-5 p-5 sm:p-6">
      <h2 className="text-[16px] font-medium text-head">{title}</h2>
      {children}
    </section>
  );
}
