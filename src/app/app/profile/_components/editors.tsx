"use client";
// Profile editors that exist only while their disclosure is open. The page ships each fact / story as a few plain fields
// (below); the form itself is rendered in the browser when the user presses «Изменить» — not pre-rendered, hidden, for
// every row (that used to be most of the Career Profile's HTML and RSC payload).
import { useState, type ReactNode } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Card, Field, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { deleteFact, deleteStory, saveFact, saveStory } from "@/lib/actions/profile";
import { STORY_TAGS } from "@/lib/ru";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  return (
    <LazyDisclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />{t("profilePage.edit")}</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
          {fact.details && <p className="mb-4 line-clamp-6 whitespace-pre-line text-[13.5px] text-ink-3">{fact.details}</p>}
          <ActionForm action={saveFact} closeDetailsOnSuccess className="flex flex-col gap-4">
            <input type="hidden" name="id" value={fact.id} />
            <FactFields fact={fact} />
            <div><FormSubmit pendingText={t("profilePage.saving")}>{t("profilePage.save")}</FormSubmit></div>
          </ActionForm>
          <form action={deleteFact} className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <input type="hidden" name="id" value={fact.id} />
            <SubmitButton size="sm" variant="ghost" className="!h-10 !text-rose" pendingText={t("profilePage.deleting")}><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />{t("profilePage.delete")}</SubmitButton>
          </form>
        </div>
      )}
    </LazyDisclosure>
  );
}

export function AddFact({ className }: { className?: string }) {
  const t = useT();
  return (
    <LazyDisclosure tone="glass" className={className} summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />{t("profilePage.add")}</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4 sm:p-5">
          <ActionForm action={saveFact} resetOnSuccess closeDetailsOnSuccess className="flex flex-col gap-4">
            <FactFields />
            <div><FormSubmit pendingText={t("profilePage.saving")}>{t("profilePage.add")}</FormSubmit></div>
          </ActionForm>
        </div>
      )}
    </LazyDisclosure>
  );
}

function FactFields({ fact }: { fact?: FactDraft }) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("profilePage.fact.kind")}>
        <select name="kind" defaultValue={fact?.kind ?? "employment"} className="field">
          {FACT_KIND_OPTIONS.map((k) => <option key={k.key} value={k.key}>{t(`profilePage.kinds.${k.key}`)}</option>)}
        </select>
      </Field>
      <Field label={t("profilePage.fact.title")}><input name="title" required minLength={2} defaultValue={fact?.title} className="field" placeholder={t("profilePage.fact.titlePlaceholder")} /></Field>
      <Field label={t("profilePage.fact.org")}><input name="org" defaultValue={fact?.org} className="field" placeholder={t("profilePage.fact.orgPlaceholder")} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("profilePage.fact.start")}><input name="startDate" defaultValue={fact?.startDate} className="field" placeholder={t("profilePage.fact.startPlaceholder")} /></Field>
        <Field label={t("profilePage.fact.end")}><input name="endDate" defaultValue={fact?.endDate} className="field" placeholder={t("profilePage.fact.endPlaceholder")} /></Field>
      </div>
      <Field label={t("profilePage.fact.details")} className="sm:col-span-2"><textarea name="details" rows={3} defaultValue={fact?.details} className="field resize-y" /></Field>
      <Field label={t("profilePage.fact.metrics")} hint={t("profilePage.fact.metricsHint")}><input name="metrics" defaultValue={fact?.metrics} className="field" placeholder={t("profilePage.fact.metricsPlaceholder")} /></Field>
      <Field label={t("profilePage.fact.tech")} hint={t("profilePage.fact.techHint")}><input name="tech" defaultValue={fact?.tech.join(", ")} className="field" placeholder="SQL, Python" /></Field>
      <Field label={t("profilePage.fact.teamSize")}><input name="teamSize" type="number" min={1} inputMode="numeric" defaultValue={fact?.teamSize ?? ""} className="field" /></Field>
      <Field label={t("profilePage.fact.ownership")}>
        <select name="ownership" defaultValue={fact?.ownership ?? ""} className="field">
          <option value="">{t("profilePage.notSpecified")}</option>
          <option value="led">{t("profilePage.ownership.ledLong")}</option>
          <option value="contributed">{t("profilePage.ownership.contributedLong")}</option>
          <option value="executed">{t("profilePage.ownership.executedLong")}</option>
        </select>
      </Field>
    </div>
  );
}

export function EditStory({ story, facts }: { story: StoryDraft; facts: FactOption[] }) {
  const t = useT();
  return (
    <LazyDisclosure tone="ghost" summary={<><Pencil className="size-3.5" strokeWidth={1.7} aria-hidden />{t("profilePage.stories.edit")}</>}>
      {() => (
        <div className="rounded-2xl border border-line bg-white/55 p-4">
          <StoryForm story={story} facts={facts} />
          <form action={deleteStory} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="id" value={story.id} />
            <SubmitButton size="sm" variant="ghost" className="!h-10 !text-rose" pendingText={t("profilePage.deleting")}><Trash2 className="size-3.5" strokeWidth={1.7} aria-hidden />{t("profilePage.stories.delete")}</SubmitButton>
          </form>
        </div>
      )}
    </LazyDisclosure>
  );
}

export function AddStory({ facts }: { facts: FactOption[] }) {
  const t = useT();
  return (
    <LazyDisclosure tone="dark" summary={<><Plus className="size-4" strokeWidth={1.7} aria-hidden />{t("profilePage.stories.addStar")}</>}>
      {() => <Card strong><StoryForm facts={facts} /></Card>}
    </LazyDisclosure>
  );
}

function StoryForm({ story, facts }: { story?: StoryDraft; facts: FactOption[] }) {
  const t = useT();
  const tags = story?.tags ?? [];
  return (
    <ActionForm action={saveStory} resetOnSuccess={!story} closeDetailsOnSuccess className="flex flex-col gap-3">
      {story && <input type="hidden" name="id" value={story.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("profilePage.fact.title")}><input name="title" required defaultValue={story?.title} className="field" placeholder={t("profilePage.stories.titlePlaceholder")} /></Field>
        <Field label={t("profilePage.stories.linkedFact")}>
          <select name="factId" defaultValue={story?.factId ?? ""} className="field">
            <option value="">{t("profilePage.stories.noLink")}</option>
            {facts.map((f) => <option key={f.id} value={f.id}>{f.title}{f.org ? ` · ${f.org}` : ""}</option>)}
          </select>
        </Field>
        <Field label={t("profilePage.stories.situation")}><textarea name="situation" required rows={2} defaultValue={story?.situation} className="field resize-y" /></Field>
        <Field label={t("profilePage.stories.task")}><textarea name="task" required rows={2} defaultValue={story?.task} className="field resize-y" /></Field>
        <Field label={t("profilePage.stories.action")} hint={t("profilePage.stories.actionHint")}><textarea name="action" required rows={3} defaultValue={story?.action} className="field resize-y" /></Field>
        <Field label={t("profilePage.stories.result")}><textarea name="result" required rows={3} defaultValue={story?.result} className="field resize-y" /></Field>
        <Field label={t("profilePage.stories.metric")} className="sm:col-span-2"><input name="metric" defaultValue={story?.metric} className="field" placeholder={t("profilePage.stories.metricPlaceholder")} /></Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-2">{t("profilePage.stories.tagsLegend")}</legend>
        <div className="flex flex-wrap gap-2">
          {STORY_TAGS.map((key) => (
            <label key={key} className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-white/70 px-3 font-mono text-[11px] uppercase tracking-[.06em] text-ink-2 transition-colors has-[:checked]:border-teal/30 has-[:checked]:bg-teal/10 has-[:checked]:text-teal has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
              <input type="checkbox" name="tags" value={key} defaultChecked={tags.includes(key)} className="sr-only" />
              {t(`profilePage.tags.${key}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div><FormSubmit pendingText={t("profilePage.saving")}>{story ? t("profilePage.stories.saveStory") : t("profilePage.stories.addStory")}</FormSubmit></div>
    </ActionForm>
  );
}
