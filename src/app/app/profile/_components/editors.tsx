"use client";
// Profile editors that exist only while their disclosure is open. The page ships each fact / story as a few plain fields
// (below); the form itself is rendered in the browser when the user presses «Изменить» — not pre-rendered, hidden, for
// every row (that used to be most of the Career Profile's HTML and RSC payload).
import { useState, type ReactNode } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, Field, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { deleteFact, deleteStory, saveFact, saveStory } from "@/lib/actions/profile";
import { STORY_TAGS, STORY_TAG_RU } from "@/lib/ru";
import { ActionForm, FormSubmit } from "./action-form";
import { FACT_KIND_OPTIONS } from "./kinds";

/** What a fact editor needs (tech already parsed). */
export type FactDraft = { id: string; kind: string; title: string; org: string; startDate: string; endDate: string; details: string; metrics: string; tech: string[]; teamSize: number | null; ownership: string };
/** What a story editor needs (tags already parsed). */
export type StoryDraft = { id: string; title: string; factId: string | null; situation: string; task: string; action: string; result: string; metric: string; tags: string[] };
export type FactOption = { id: string; title: string; org: string };

/** The same pill disclosure as ./bits Disclosure; its body mounts on open and unmounts on close (ActionForm closes it after a save). */
function LazyDisclosure({ summary, tone, className, children }: { summary: ReactNode; tone: "glass" | "ghost" | "dark"; className?: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={cx("group/d open:w-full", className)} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary
        className={cx(
          "inline-flex h-10 cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-head transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden",
          tone === "glass" && "glass !rounded-full hover:bg-white",
          tone === "ghost" && "hover:bg-white/60",
          tone === "dark" && "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]",
        )}
      >
        {summary}
        <ChevronDown className="size-3.5 transition-transform group-open/d:rotate-180" strokeWidth={1.7} aria-hidden />
      </summary>
      <div className="mt-3 animate-fade">{open ? children() : null}</div>
    </details>
  );
}

export function EditFact({ fact }: { fact: FactDraft }) {
  return (
    <LazyDisclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />Изменить</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
          {fact.details && <p className="mb-4 line-clamp-6 whitespace-pre-line text-[13.5px] text-ink-3">{fact.details}</p>}
          <ActionForm action={saveFact} closeDetailsOnSuccess className="flex flex-col gap-4">
            <input type="hidden" name="id" value={fact.id} />
            <FactFields fact={fact} />
            <div><FormSubmit pendingText="Сохраняем…">Сохранить</FormSubmit></div>
          </ActionForm>
          <form action={deleteFact} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <input type="hidden" name="id" value={fact.id} />
            <SubmitButton size="sm" variant="ghost" className="!h-10 !text-rose" pendingText="Удаляем…"><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />Удалить</SubmitButton>
          </form>
        </div>
      )}
    </LazyDisclosure>
  );
}

export function AddFact({ className }: { className?: string }) {
  return (
    <LazyDisclosure tone="glass" className={className} summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
          <ActionForm action={saveFact} resetOnSuccess closeDetailsOnSuccess className="flex flex-col gap-4">
            <FactFields />
            <div><FormSubmit pendingText="Сохраняем…">Добавить</FormSubmit></div>
          </ActionForm>
        </div>
      )}
    </LazyDisclosure>
  );
}

function FactFields({ fact }: { fact?: FactDraft }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Тип">
        <select name="kind" defaultValue={fact?.kind ?? "employment"} className="field">
          {FACT_KIND_OPTIONS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
      </Field>
      <Field label="Название *"><input name="title" required minLength={2} defaultValue={fact?.title} className="field" placeholder="Data Analyst / бакалавриат / сертификат" /></Field>
      <Field label="Организация"><input name="org" defaultValue={fact?.org} className="field" placeholder="Компания или вуз" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Начало"><input name="startDate" defaultValue={fact?.startDate} className="field" placeholder="март 2023" /></Field>
        <Field label="Конец"><input name="endDate" defaultValue={fact?.endDate} className="field" placeholder="по настоящее время" /></Field>
      </div>
      <Field label="Задачи и вклад" className="sm:col-span-2"><textarea name="details" rows={3} defaultValue={fact?.details} className="field resize-y" /></Field>
      <Field label="Результат в цифрах" hint="Было → стало. Нет цифры — оставь пустым."><input name="metrics" defaultValue={fact?.metrics} className="field" placeholder="отток −9%" /></Field>
      <Field label="Технологии" hint="Через запятую"><input name="tech" defaultValue={fact?.tech.join(", ")} className="field" placeholder="SQL, Python" /></Field>
      <Field label="Размер команды"><input name="teamSize" type="number" min={1} inputMode="numeric" defaultValue={fact?.teamSize ?? ""} className="field" /></Field>
      <Field label="Твоя роль">
        <select name="ownership" defaultValue={fact?.ownership ?? ""} className="field">
          <option value="">Не указано</option>
          <option value="led">Самостоятельно: вести и принимать решения</option>
          <option value="contributed">Участие: важная часть команды</option>
          <option value="executed">Исполнение: выполнять задачи</option>
        </select>
      </Field>
    </div>
  );
}

export function EditStory({ story, facts }: { story: StoryDraft; facts: FactOption[] }) {
  return (
    <LazyDisclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />Редактировать</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4">
          <StoryForm story={story} facts={facts} />
          <form action={deleteStory} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="id" value={story.id} />
            <SubmitButton size="sm" variant="ghost" className="!h-10 !text-rose" pendingText="Удаляем…"><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />Удалить историю</SubmitButton>
          </form>
        </div>
      )}
    </LazyDisclosure>
  );
}

export function AddStory({ facts }: { facts: FactOption[] }) {
  return (
    <LazyDisclosure tone="dark" summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить STAR-историю</>}>
      {() => <Card strong><StoryForm facts={facts} /></Card>}
    </LazyDisclosure>
  );
}

function StoryForm({ story, facts }: { story?: StoryDraft; facts: FactOption[] }) {
  const tags = story?.tags ?? [];
  return (
    <ActionForm action={saveStory} resetOnSuccess={!story} closeDetailsOnSuccess className="flex flex-col gap-3">
      {story && <input type="hidden" name="id" value={story.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название *"><input name="title" required defaultValue={story?.title} className="field" placeholder="A/B-тест онбординга" /></Field>
        <Field label="Связанный факт">
          <select name="factId" defaultValue={story?.factId ?? ""} className="field">
            <option value="">Без привязки</option>
            {facts.map((f) => <option key={f.id} value={f.id}>{f.title}{f.org ? ` · ${f.org}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Ситуация (S) *"><textarea name="situation" required rows={2} defaultValue={story?.situation} className="field resize-y" /></Field>
        <Field label="Задача (T) *"><textarea name="task" required rows={2} defaultValue={story?.task} className="field resize-y" /></Field>
        <Field label="Действие (A) *" hint="Твой вклад: решения, действия, инструменты"><textarea name="action" required rows={3} defaultValue={story?.action} className="field resize-y" /></Field>
        <Field label="Результат (R) *"><textarea name="result" required rows={3} defaultValue={story?.result} className="field resize-y" /></Field>
        <Field label="Метрика" className="sm:col-span-2"><input name="metric" defaultValue={story?.metric} className="field" placeholder="активация 18% → 26%" /></Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">Темы вопросов</legend>
        <div className="flex flex-wrap gap-2">
          {STORY_TAGS.map((key) => (
            <label key={key} className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-white/70 px-3 font-mono text-[11px] uppercase tracking-[.06em] text-ink-2 transition-colors has-[:checked]:border-teal/30 has-[:checked]:bg-teal/10 has-[:checked]:text-teal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
              <input type="checkbox" name="tags" value={key} defaultChecked={tags.includes(key)} className="sr-only" />
              {STORY_TAG_RU[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <div><FormSubmit pendingText="Сохраняем…">{story ? "Сохранить историю" : "Добавить историю"}</FormSubmit></div>
    </ActionForm>
  );
}
