"use client";
import { useId, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { saveGoal, type FormState } from "@/lib/actions/onboarding";
import { marketRange } from "@/lib/engine/market";
import { classifyRole, SENIORITY, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { goalTitle } from "../../app/readiness/_components/model";
import { BackLink, FieldErr, FormAlert } from "./shared";

type Goal = { primaryRole: string; seniority: string; minSalary: number; countries: string[]; workModes: string[]; relocation: boolean; industries: string[] };

export const REGION_CHIPS: [string, string][] = [
  ["EU", "Europe"], ["US", "US"], ["UK", "UK"], ["CA", "Canada"], ["WORLD", "Remote worldwide"], ["KZ", "Kazakhstan"], ["CIS", "СНГ"], ["MENA", "ОАЭ / MENA"],
];
const MODES: [string, string][] = [["remote", "Remote"], ["hybrid", "Hybrid"], ["onsite", "Onsite"]];

export function StepGoal({ initial, note, years, suggestedSeniority, roleSuggestions }: { initial: Goal; note?: string; years: number; suggestedSeniority: string; roleSuggestions: string[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveGoal, undefined);
  const [role, setRole] = useState(initial.primaryRole);
  const [seniority, setSeniority] = useState(initial.seniority);
  const [countries, setCountries] = useState<string[]>(initial.countries.length ? initial.countries : ["WORLD"]);
  const [salary, setSalary] = useState(initial.minSalary ? String(initial.minSalary) : "");
  const id = useId();
  const f = state?.fields ?? {};
  const range = marketRange(classifyRole(role), seniority, countries);
  const sal = Number(salary || 0);
  const toggleCountry = (k: string) => setCountries((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const where = countries.map((c) => REGION_CHIPS.find(([k]) => k === c)?.[1] ?? c).join(", ");

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {/* Live read-out of the goal */}
      <section aria-live="polite" className="glass-strong flex flex-col gap-2 p-5 sm:p-7">
        <span className="label">Моя цель</span>
        <div className="h-serif text-[clamp(28px,4vw,42px)]">{role.trim() ? goalTitle(role.trim(), countries) : <span className="text-ink-4">Роль не указана</span>}</div>
        <div className="font-mono text-[11.5px] uppercase tracking-[.06em] text-teal">
          {[SENIORITY_LABEL[seniority], where, sal ? `от $${sal.toLocaleString("en-US")}` : ""].filter(Boolean).join(" · ")}
        </div>
        {note && <p className="mt-1 flex items-start gap-2 text-[13px] text-ink-3"><Sparkles className="mt-0.5 size-3.5 shrink-0 text-green" aria-hidden />{note}</p>}
      </section>

      <section className="glass flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-role`} className="label">Роль</label>
          <input id={`${id}-role`} name="primaryRole" value={role} onChange={(e) => setRole(e.target.value)} maxLength={100} autoComplete="off" placeholder="Например, Data Analyst" className="field" aria-invalid={Boolean(f.primaryRole)} aria-describedby={f.primaryRole ? `${id}-role-err` : undefined} />
          <FieldErr id={`${id}-role-err`}>{f.primaryRole}</FieldErr>
          {roleSuggestions.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-ink-3">Подходит по навыкам:</span>
              {roleSuggestions.map((r) => (
                <button key={r} type="button" onClick={() => setRole(r)} aria-pressed={role === r} className={cx("inline-flex min-h-10 items-center rounded-full border px-3.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-green", role === r ? "border-green/40 bg-green-soft text-green" : "border-line bg-white/60 text-ink-2 hover:border-teal/40")}>{r}</button>
              ))}
            </div>
          )}
        </div>

        <fieldset>
          <legend className="label mb-2">Уровень</legend>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {SENIORITY.map((v) => (
              <label key={v} className="relative flex cursor-pointer flex-col items-center rounded-2xl border border-line bg-white/60 px-2 py-2.5 text-[13.5px] transition-colors has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="radio" name="seniority" value={v} checked={seniority === v} onChange={() => setSeniority(v)} className="sr-only" />
                {SENIORITY_LABEL[v]}
                {v === suggestedSeniority && years > 0 && <span className="absolute -top-2 rounded-full bg-green px-1.5 py-px font-mono text-[8.5px] uppercase tracking-wide text-white">по опыту</span>}
              </label>
            ))}
          </div>
          <FieldErr id={`${id}-sen`}>{f.seniority}</FieldErr>
        </fieldset>

        <fieldset aria-describedby={f.countries ? `${id}-c-err` : undefined}>
          <legend className="label mb-2">Где</legend>
          <div className="flex flex-wrap gap-2">
            {REGION_CHIPS.map(([k, l]) => (
              <Chip key={k}><input type="checkbox" name="countries" value={k} checked={countries.includes(k)} onChange={() => toggleCountry(k)} className="sr-only" />{l}</Chip>
            ))}
          </div>
          <FieldErr id={`${id}-c-err`}>{f.countries}</FieldErr>
        </fieldset>

        <fieldset aria-describedby={f.workModes ? `${id}-m-err` : undefined}>
          <legend className="label mb-2">Формат</legend>
          <div className="flex flex-wrap gap-2">
            {MODES.map(([v, l]) => <Chip key={v}><input type="checkbox" name="workModes" value={v} defaultChecked={initial.workModes.includes(v)} className="sr-only" />{l}</Chip>)}
          </div>
          <FieldErr id={`${id}-m-err`}>{f.workModes}</FieldErr>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-sal`} className="label">Минимальная зарплата, USD в год</label>
            <input id={`${id}-sal`} name="minSalary" value={salary} onChange={(e) => setSalary(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder={String(range.mid)} className="field num" aria-describedby={`${id}-mkt`} />
            <span id={`${id}-mkt`} className="text-[12px] text-ink-3">
              Рынок для цели: <span className="num">${Math.round(range.low / 1000)}k–${Math.round(range.high / 1000)}k</span>
              {sal > range.high && <span className="text-amber"> · выше рынка — вакансий будет мало</span>}
              {sal > 0 && sal <= range.mid && <span className="text-green"> · реалистично</span>}
            </span>
          </div>
          <Toggle name="relocation" defaultChecked={initial.relocation} title="Готов(а) к переезду" hint="Иначе onsite за рубежом не рассматриваем" />
        </div>
        {initial.industries.map((x) => <input key={x} type="hidden" name="industries" value={x} />)}
      </section>

      <FormAlert error={state?.error} />
      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <BackLink step={3} />
        <button type="submit" disabled={pending} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
          {pending && <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Всё верно — дальше
        </button>
      </div>
    </form>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-white/60 px-3.5 text-[13.5px] text-ink-2 transition-colors hover:border-teal/40 has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
      {children}
    </label>
  );
}

export function Toggle({ name, defaultChecked, title, hint }: { name: string; defaultChecked?: boolean; title: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 self-start rounded-2xl border border-line bg-white/60 px-4 py-3 transition-colors has-[:checked]:border-green/30 has-[:checked]:bg-green-soft/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green sm:mt-5">
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
