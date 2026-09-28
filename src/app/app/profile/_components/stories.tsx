import type { Fact, Story } from "@prisma/client";
import { Mic, Pencil, Plus, Trash2, TrendingUp } from "lucide-react";
import { Card, Chip, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { j } from "@/lib/db";
import { saveStory, deleteStory, type StoryTag } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Disclosure } from "./bits";

const TAGS: { key: StoryTag; label: string }[] = [
  { key: "conflict", label: "Conflict" },
  { key: "failure", label: "Failure" },
  { key: "leadership", label: "Leadership" },
  { key: "impact", label: "Impact" },
  { key: "pressure", label: "Pressure" },
  { key: "initiative", label: "Initiative" },
  { key: "data", label: "Data" },
  { key: "customer", label: "Customer" },
];

export function Stories({ stories, facts }: { stories: (Story & { fact: Fact | null })[]; facts: Pick<Fact, "id" | "title" | "org">[] }) {
  const covered = new Set(stories.flatMap((s) => j<string[]>(s.tags, [])));
  const missing = TAGS.filter((t) => !covered.has(t.key));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-teal/15 bg-teal/5 px-4 py-3 text-[13.5px] text-ink-2">
        <Mic className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
        <p>
          <span className="font-medium text-head">Материал для интервью.</span> Из этих историй агент собирает подсказки и готовит тебя к behavioral-вопросам.
          {missing.length > 0 && <> Не покрыты темы: {missing.map((t) => t.label).join(", ")}.</>}
        </p>
      </div>

      {stories.length === 0 && (
        <Card className="text-center text-[14px] text-ink-3">Историй пока нет. Агент подготовит их из твоего опыта перед первым интервью — или начни с самого измеримого результата.</Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {stories.map((s, i) => {
          const tags: string[] = j(s.tags, []);
          return (
            <Card key={s.id} className="flex animate-rise flex-col gap-3" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => <Chip key={t} tone="teal">{t}</Chip>)}
              </div>
              <h3 className="h-serif text-[19px]">{s.title}</h3>
              {s.fact && <div className="label !normal-case !tracking-normal !text-[12px]">Основано на факте: {s.fact.title}{s.fact.org ? ` · ${s.fact.org}` : ""}</div>}
              <dl className="grid gap-2 text-[13.5px]">
                {([["S", s.situation], ["T", s.task], ["A", s.action], ["R", s.result]] as const).map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[22px_1fr] gap-2">
                    <dt className="num text-teal">{k}</dt>
                    <dd className="text-ink-2">{v}</dd>
                  </div>
                ))}
              </dl>
              {s.metric && (
                <div className="flex items-center gap-2 text-[13.5px] text-green">
                  <TrendingUp className="size-4" strokeWidth={1.7} aria-hidden />{s.metric}
                </div>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Disclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />Редактировать</>}>
                  <div className="rounded-2xl border border-line bg-white/55 p-4">
                    <StoryForm story={s} facts={facts} />
                    <form action={deleteStory} className="mt-4 border-t border-line pt-4">
                      <input type="hidden" name="id" value={s.id} />
                      <SubmitButton size="sm" variant="ghost" className="!text-rose" pendingText="Удаляем…"><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />Удалить историю</SubmitButton>
                    </form>
                  </div>
                </Disclosure>
              </div>
            </Card>
          );
        })}
      </div>

      <Disclosure tone="dark" summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить STAR-историю</>}>
        <Card strong><StoryForm facts={facts} /></Card>
      </Disclosure>
    </div>
  );
}

function StoryForm({ story, facts }: { story?: Story; facts: Pick<Fact, "id" | "title" | "org">[] }) {
  const tags: string[] = j(story?.tags, []);
  return (
    <ActionForm action={saveStory} resetOnSuccess={!story} closeDetailsOnSuccess className="flex flex-col gap-3">
      {story && <input type="hidden" name="id" value={story.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название *"><input name="title" required defaultValue={story?.title} className="field" placeholder="Onboarding A/B test" /></Field>
        <Field label="Связанный факт">
          <select name="factId" defaultValue={story?.factId ?? ""} className="field">
            <option value="">Без привязки</option>
            {facts.map((f) => <option key={f.id} value={f.id}>{f.title}{f.org ? ` · ${f.org}` : ""}</option>)}
          </select>
        </Field>
        <Field label="Situation *"><textarea name="situation" required rows={2} defaultValue={story?.situation} className="field resize-y" /></Field>
        <Field label="Task *"><textarea name="task" required rows={2} defaultValue={story?.task} className="field resize-y" /></Field>
        <Field label="Action *" hint="Что сделали именно вы"><textarea name="action" required rows={3} defaultValue={story?.action} className="field resize-y" /></Field>
        <Field label="Result *"><textarea name="result" required rows={3} defaultValue={story?.result} className="field resize-y" /></Field>
        <Field label="Метрика" className="sm:col-span-2"><input name="metric" defaultValue={story?.metric} className="field" placeholder="activation 18% → 26%" /></Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">Темы вопросов</legend>
        <div className="flex flex-wrap gap-2">
          {TAGS.map((t) => (
            <label key={t.key} className="cursor-pointer rounded-full border border-line bg-white/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[.06em] text-ink-2 transition-colors has-[:checked]:border-teal/30 has-[:checked]:bg-teal/10 has-[:checked]:text-teal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
              <input type="checkbox" name="tags" value={t.key} defaultChecked={tags.includes(t.key)} className="sr-only" />
              {t.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div><FormSubmit pendingText="Сохраняем…">{story ? "Сохранить историю" : "Добавить историю"}</FormSubmit></div>
    </ActionForm>
  );
}
