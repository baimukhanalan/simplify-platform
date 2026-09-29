"use client";
// Section editors of the Career Profile (Skills, Constraints) that render only while their «Изменить» is open: the page
// sends their data, not a hidden pre-rendered form (see ./editors.tsx for facts and stories).
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { addSkill, removeSkill, updateConstraints } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Check } from "./bits";
import { CitizenshipField } from "./citizenship-field";

/** Renders its children only while the nearest enclosing <details> is open (Editable's «Изменить»). */
export function WhenOpen({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const details = ref.current?.closest("details");
    if (!details) return;
    const sync = () => setOpen(details.open);
    sync();
    details.addEventListener("toggle", sync);
    return () => details.removeEventListener("toggle", sync);
  }, []);
  return <><span ref={ref} hidden />{open ? children : null}</>;
}

export function SkillsEditor({ skills, fromFacts }: { skills: string[]; fromFacts: string[] }) {
  return (
    <WhenOpen>
      <div className="flex flex-col gap-4">
        {skills.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Навыки">
            {skills.map((s) => (
              <li key={s}>
                <form action={removeSkill} className="inline-flex items-center gap-0.5 rounded-full border border-line bg-white/80 py-0.5 pl-3 pr-0.5 text-[13.5px] text-head">
                  {s}
                  <input type="hidden" name="skill" value={s} />
                  <button type="submit" aria-label={`Удалить навык ${s}`} className="grid size-10 place-items-center rounded-full text-ink-3 transition-colors hover:bg-rose-soft hover:text-rose focus-visible:outline-2 focus-visible:outline-green">
                    <X className="size-3.5" strokeWidth={1.8} aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addSkill} className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="add-skill">Новый навык</label>
          <input id="add-skill" name="skill" required className="field sm:max-w-sm" placeholder="Например: dbt, Looker (через запятую)" />
          <SubmitButton variant="glass" pendingText="Добавляем…"><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить</SubmitButton>
        </form>
        {fromFacts.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <div className="label">Есть в опыте</div>
            <div className="flex flex-wrap gap-2">
              {fromFacts.map((t) => (
                <form key={t} action={addSkill}>
                  <input type="hidden" name="skill" value={t} />
                  <button type="submit" className="inline-flex min-h-10 items-center gap-1 rounded-full border border-dashed border-green/35 px-3 text-[13px] text-green transition-colors hover:bg-green-soft focus-visible:outline-2 focus-visible:outline-green">
                    <Plus className="size-3" strokeWidth={2} aria-hidden />{t}
                  </button>
                </form>
              ))}
            </div>
          </div>
        )}
      </div>
    </WhenOpen>
  );
}

/** Everything the Constraints form shows, prepared on the server (labels, defaults, which work-auth boxes are ticked). */
export type ConstraintsDraft = {
  citizenship: string; citizenshipOptions: [string, string][];
  remotePref: string; remoteOptions: [string, string][]; workFormat: string | null; // workFormat set = it lives in the goal
  minSalary: number | ""; minSalaryHint: string;
  noticePeriod: string; noticeOptions: [string, string][];
  authOptions: [string, string][]; authChecked: string[]; authHidden: string[];
  needsSponsorship: boolean; relocation: boolean;
};

export function ConstraintsEditor({ d }: { d: ConstraintsDraft }) {
  return (
    <WhenOpen>
      <ActionForm action={updateConstraints} closeDetailsOnSuccess className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <CitizenshipField defaultValue={d.citizenship} options={d.citizenshipOptions} />
          {d.workFormat != null ? (
            <div className="flex flex-col gap-1.5">
              <span className="label">Формат работы</span>
              <input type="hidden" name="remotePref" value={d.remotePref} />
              <p className="text-[14px] text-head">{d.workFormat}</p>
              <Link href="/app/goal" className="inline-flex min-h-10 w-fit items-center text-[12.5px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-green">Меняется в цели →</Link>
            </div>
          ) : (
            <Field label="Формат работы">
              <select name="remotePref" defaultValue={d.remotePref} className="field">
                {d.remoteOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </Field>
          )}
          <Field label="Минимальная зарплата, USD / год" hint={d.minSalaryHint}>
            {/* The goal may be stored in KZT/EUR: prefilled converted to USD, since the action saves this field as USD. */}
            <input name="minSalary" type="number" min={0} step={1000} inputMode="numeric" defaultValue={d.minSalary} className="field" placeholder="70000" />
          </Field>
          <Field label="Выход на работу">
            <select name="noticePeriod" defaultValue={d.noticePeriod} className="field">
              {d.noticeOptions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-2">Право на работу (кроме гражданства)</legend>
          <div className="flex flex-wrap gap-2">
            {d.authOptions.map(([c, l]) => (
              <label key={c} className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-white/70 px-3.5 text-[13.5px] text-ink-2 transition-colors has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
                <input type="checkbox" name="workAuth" value={c} defaultChecked={d.authChecked.includes(c)} className="sr-only" />{l}
              </label>
            ))}
          </div>
          {d.authHidden.map((c) => <input key={c} type="hidden" name="workAuth" value={c} />)}
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-2">
          <Check name="needsSponsorship" defaultChecked={d.needsSponsorship} label="Нужна рабочая виза (спонсорство)" hint="Для стран, где нет права на работу." />
          <Check name="relocation" defaultChecked={d.relocation} label="Переезд возможен" />
        </div>
        <div><FormSubmit pendingText="Сохраняем…">Сохранить</FormSubmit></div>
      </ActionForm>
    </WhenOpen>
  );
}
