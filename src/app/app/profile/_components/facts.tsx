import type { Fact } from "@prisma/client";
import { Award, Briefcase, FolderGit2, GraduationCap, Languages, Pencil, Plus, ShieldCheck, Trash2, TrendingUp, Trophy, Users, Wrench } from "lucide-react";
import { Chip, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { j } from "@/lib/db";
import { saveFact, deleteFact } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Disclosure } from "./bits";

export const KINDS = [
  { key: "employment", label: "Опыт работы", icon: Briefcase },
  { key: "education", label: "Образование", icon: GraduationCap },
  { key: "project", label: "Проекты", icon: FolderGit2 },
  { key: "certification", label: "Сертификаты", icon: Award },
  { key: "achievement", label: "Достижения", icon: Trophy },
  { key: "authorization", label: "Право на работу", icon: ShieldCheck },
  { key: "language", label: "Языки", icon: Languages },
  { key: "skill", label: "Навыки", icon: Wrench },
] as const;

const OWNERSHIP: Record<string, string> = { led: "Вёл(а) сам(а)", contributed: "Участвовал(а)", executed: "Исполнял(а)" };

const ORDER = ["employment", "project", "education", "certification", "achievement", "language", "authorization", "skill"];

/** Experience as a calm list; each position has its editor behind "Изменить". */
export function Experience({ facts }: { facts: Fact[] }) {
  const sorted = [...facts].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  return (
    <section id="experience" aria-labelledby="experience-h" className="glass scroll-mt-24 p-5 sm:p-6">
      <div className="mb-2 flex flex-col gap-1">
        <h2 id="experience-h" className="h-serif text-[clamp(21px,2.2vw,26px)]">Опыт</h2>
        <p className="text-[13.5px] text-ink-3">Работа, проекты, образование и сертификаты — из них агент собирает CV под каждую вакансию.</p>
      </div>
      {sorted.length === 0 ? (
        <p className="py-4 text-[14px] text-ink-3">Пока пусто. Загрузи CV ниже или добавь позицию вручную.</p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map((f) => <li key={f.id} className="py-4"><FactRow fact={f} /></li>)}
        </ul>
      )}
      <Disclosure tone="glass" className="mt-3" summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить</>}>
        <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
          <ActionForm action={saveFact} resetOnSuccess closeDetailsOnSuccess className="flex flex-col gap-4">
            <FactFields />
            <div><FormSubmit pendingText="Сохраняем…">Добавить</FormSubmit></div>
          </ActionForm>
        </div>
      </Disclosure>
    </section>
  );
}

function FactRow({ fact: f }: { fact: Fact }) {
  const Icon = KINDS.find((k) => k.key === f.kind)?.icon ?? Briefcase;
  const dates = [f.startDate, f.endDate].filter(Boolean).join(" — ");
  const tech: string[] = j(f.tech, []);
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal"><Icon className="size-4" strokeWidth={1.7} aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="text-[15.5px] font-medium text-head">{f.title}</div>
          {(f.org || dates) && <div className="text-[13px] text-ink-3">{[f.org, dates].filter(Boolean).join(" · ")}</div>}
        </div>
        {f.metrics && (
          <div className="flex w-fit items-start gap-2 rounded-xl bg-green-soft/70 px-3 py-1.5 text-[13.5px] text-green">
            <TrendingUp className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} aria-hidden /><span>{f.metrics}</span>
          </div>
        )}
        {(tech.length > 0 || f.teamSize != null || f.ownership) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {f.ownership && <Chip>{OWNERSHIP[f.ownership] ?? f.ownership}</Chip>}
            {f.teamSize != null && <Chip><Users className="size-3" strokeWidth={2} aria-hidden />Команда {f.teamSize}</Chip>}
            {tech.slice(0, 8).map((t) => <Chip key={t}>{t}</Chip>)}
          </div>
        )}
        <Disclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />Изменить</>}>
          <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
            {f.details && <p className="mb-4 line-clamp-6 whitespace-pre-line text-[13.5px] text-ink-3">{f.details}</p>}
            <ActionForm action={saveFact} closeDetailsOnSuccess className="flex flex-col gap-4">
              <input type="hidden" name="id" value={f.id} />
              <FactFields fact={f} />
              <div><FormSubmit pendingText="Сохраняем…">Сохранить</FormSubmit></div>
            </ActionForm>
            <form action={deleteFact} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <input type="hidden" name="id" value={f.id} />
              <SubmitButton size="sm" variant="ghost" className="!text-rose" pendingText="Удаляем…"><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />Удалить</SubmitButton>
            </form>
          </div>
        </Disclosure>
      </div>
    </div>
  );
}

export function FactFields({ fact }: { fact?: Fact }) {
  const tech: string[] = j(fact?.tech, []);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Тип">
        <select name="kind" defaultValue={fact?.kind ?? "employment"} className="field">
          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Название *"><input name="title" required minLength={2} defaultValue={fact?.title} className="field" placeholder="Data Analyst / BSc / Сертификат" /></Field>
      <Field label="Организация"><input name="org" defaultValue={fact?.org} className="field" placeholder="Компания или вуз" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Начало"><input name="startDate" defaultValue={fact?.startDate} className="field" placeholder="Mar 2023" /></Field>
        <Field label="Конец"><input name="endDate" defaultValue={fact?.endDate} className="field" placeholder="Present" /></Field>
      </div>
      <Field label="Что ты делал(а)" className="sm:col-span-2"><textarea name="details" rows={3} defaultValue={fact?.details} className="field resize-y" /></Field>
      <Field label="Результат в цифрах" hint="Было → стало. Нет цифры — оставь пустым."><input name="metrics" defaultValue={fact?.metrics} className="field" placeholder="churn −9%" /></Field>
      <Field label="Технологии" hint="Через запятую"><input name="tech" defaultValue={tech.join(", ")} className="field" placeholder="SQL, Python" /></Field>
      <Field label="Размер команды"><input name="teamSize" type="number" min={1} inputMode="numeric" defaultValue={fact?.teamSize ?? ""} className="field" /></Field>
      <Field label="Твоя роль">
        <select name="ownership" defaultValue={fact?.ownership ?? ""} className="field">
          <option value="">Не указано</option>
          <option value="led">Вёл(а) и принимал(а) решения</option>
          <option value="contributed">Важная часть команды</option>
          <option value="executed">Выполнял(а) задачи</option>
        </select>
      </Field>
    </div>
  );
}

