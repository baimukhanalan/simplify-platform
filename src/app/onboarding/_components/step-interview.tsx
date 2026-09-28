"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { MessageSquareQuote, BookOpenCheck, ChevronDown } from "lucide-react";
import { saveMiniInterview, saveStory, type FormState } from "@/lib/actions/onboarding";
import { Chip, cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { ContinueBar, FormAlert } from "./shared";

type Fact = { id: string; kind: string; title: string; org: string; startDate: string; endDate: string; details: string; metrics: string; teamSize: number | null; ownership: string; verified: boolean };
type Item = { fact: Fact; questions: { q: string; a: string }[]; answered: boolean; stories: string[] };

const OWNERSHIP = [
  { v: "led", label: "Руководил(а)", hint: "принимал(а) решения" },
  { v: "contributed", label: "Участвовал(а)", hint: "вклад в командную работу" },
  { v: "executed", label: "Исполнял(а)", hint: "выполнял(а) задачи" },
];
const TAGS = [
  { v: "impact", label: "Impact" }, { v: "leadership", label: "Leadership" }, { v: "conflict", label: "Conflict" },
  { v: "failure", label: "Failure" }, { v: "initiative", label: "Initiative" }, { v: "teamwork", label: "Teamwork" },
];

export function StepInterview({ items }: { items: Item[] }) {
  const answered = items.filter((i) => i.answered).length;
  return (
    <div className="flex flex-col gap-5">
      {items.length ? (
        <>
          <div className="flex items-center gap-2 text-[13px] text-ink-3"><MessageSquareQuote className="size-4 text-teal" aria-hidden />Отвечено {answered} из {items.length}. Можно коротко — 1–2 предложения. Всё, что вы напишете, считается вашими словами, не выдумкой AI.</div>
          {items.map((it, i) => <InterviewCard key={it.fact.id} item={it} index={i} />)}
        </>
      ) : (
        <div className="glass flex flex-col items-start gap-3 p-6">
          <div className="h-serif text-[22px]">Нет позиций для интервью</div>
          <p className="text-[14px] text-ink-3">Добавьте опыт работы или проект на шаге Truth Layer — и вернитесь сюда.</p>
          <Link href="/onboarding?step=2" className="text-[14px] text-head underline decoration-line underline-offset-4 hover:decoration-teal">К фактам</Link>
        </div>
      )}
      <ContinueBar step={3} note={answered === 0 && items.length ? "Можно пропустить — но без метрик CV будет слабее" : undefined} />
    </div>
  );
}

function InterviewCard({ item, index }: { item: Item; index: number }) {
  const { fact } = item;
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveMiniInterview, undefined);
  const [open, setOpen] = useState(index === 0 || !item.answered);
  const id = useId();
  const done = item.answered || state?.ok;

  return (
    <article aria-labelledby={`${id}-t`} className="glass-strong overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${id}-b`} className="flex w-full items-start justify-between gap-4 p-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green sm:p-6">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span id={`${id}-t`} className="text-[16px] font-medium text-head">{fact.title}</span>
            {done ? <Chip tone="green" dot>Отвечено</Chip> : <Chip tone="amber">Нужны ответы</Chip>}
            {item.stories.length > 0 && <Chip tone="teal">STAR · {item.stories.length}</Chip>}
          </span>
          <span className="text-[13px] text-ink-3">{[fact.org, [fact.startDate, fact.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")}</span>
        </span>
        <ChevronDown className={cx("mt-1 size-4 shrink-0 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>

      <div id={`${id}-b`} hidden={!open} className="flex flex-col gap-5 border-t border-line px-5 pb-6 pt-5 sm:px-6">
        <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
          <input type="hidden" name="factId" value={fact.id} />
          {item.questions.map((q, i) => (
            <div key={q.q} className="flex flex-col gap-1.5">
              <input type="hidden" name="q" value={q.q} />
              <label htmlFor={`${id}-a${i}`} className="text-[14px] text-head">{q.q}</label>
              <textarea id={`${id}-a${i}`} name="a" defaultValue={q.a} rows={2} maxLength={3000} className="field resize-y !text-[14px]" />
            </div>
          ))}

          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <label className="flex flex-col gap-1.5">
              <span className="label">Измеримый результат</span>
              <input name="metrics" defaultValue={fact.metrics} maxLength={300} placeholder="Например: конверсия 18% → 26%" className="field" />
              <span className="text-[12px] text-ink-3">Было → стало, в цифрах. Только реальные значения.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label">Команда, чел.</span>
              <input name="teamSize" inputMode="numeric" pattern="[0-9]*" defaultValue={fact.teamSize ?? ""} maxLength={5} className="field num" />
            </label>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1.5">Ваша роль</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {OWNERSHIP.map((o) => (
                <label key={o.v} className="flex cursor-pointer flex-col rounded-2xl border border-line bg-white/60 px-3.5 py-2.5 transition-colors has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
                  <span className="flex items-center gap-2 text-[14px] text-head"><input type="radio" name="ownership" value={o.v} defaultChecked={fact.ownership === o.v} className="accent-[#1a6e48]" />{o.label}</span>
                  <span className="pl-5 text-[12px] text-ink-3">{o.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Сохранить ответы
            </button>
            <FormAlert error={state?.error} message={state?.message} />
          </div>
        </form>

        {done && <StoryForm fact={fact} questions={item.questions} />}
      </div>
    </article>
  );
}

function StoryForm({ fact, questions }: { fact: Fact; questions: { q: string; a: string }[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveStory, undefined);
  const [open, setOpen] = useState(false);
  const id = useId();
  const hard = questions.find((q) => /сложную проблему/.test(q.q))?.a ?? "";
  const what = questions[0]?.a ?? "";
  const pre = {
    title: fact.title,
    situation: fact.org ? `${fact.title} в ${fact.org}. ${fact.details.split("\n")[0] ?? ""}`.trim() : fact.details.split("\n")[0] ?? "",
    task: what,
    action: hard,
    result: fact.metrics,
  };

  if (state?.ok) return <FormAlert message={state.message} />;
  return (
    <div className="rounded-2xl border border-teal/15 bg-teal/5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${id}-s`} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green">
        <span className="inline-flex items-center gap-2"><BookOpenCheck className="size-4 text-teal" aria-hidden />Превратить в STAR-историю для интервью</span>
        <ChevronDown className={cx("size-4 text-ink-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <form id={`${id}-s`} hidden={!open} action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3 px-4 pb-4">
        <p className="text-[12.5px] text-ink-3">Черновик собран из ваших ответов. Проверьте и поправьте — Interview Copilot будет подсказывать только подтверждённые истории.</p>
        <input type="hidden" name="factId" value={fact.id} />
        <label className="flex flex-col gap-1.5"><span className="label">Название</span><input name="title" defaultValue={pre.title} maxLength={160} className="field" /></label>
        {(["situation", "task", "action", "result"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1.5">
            <span className="label">{{ situation: "S · Ситуация", task: "T · Задача", action: "A · Действия", result: "R · Результат" }[k]}</span>
            <textarea name={k} defaultValue={pre[k]} rows={2} className="field resize-y !text-[14px]" />
          </label>
        ))}
        <fieldset>
          <legend className="label mb-2">Темы</legend>
          <div className="flex flex-wrap gap-1.5">
            {TAGS.map((t) => (
              <label key={t.v} className="cursor-pointer rounded-full border border-line bg-white/70 px-3 py-1 text-[12.5px] text-ink-2 transition-colors has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:checked]:text-green has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
                <input type="checkbox" name="tags" value={t.v} className="sr-only" />{t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="submit" disabled={pending} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-green px-4 text-[13.5px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
            {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Сохранить историю
          </button>
          <FormAlert error={state?.error} />
        </div>
      </form>
    </div>
  );
}
