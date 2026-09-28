"use client";
import { startTransition, useActionState, useId } from "react";
import { Card, Field, Label, cx } from "@/components/ui";
import { PendingButton, submitVia } from "../../_components/pending-button";
import { saveDebrief, type Debrief, type DebriefState } from "@/lib/actions/interview";

const OUTCOMES = [
  { v: "done", label: "Ждём ответа" },
  { v: "passed", label: "Прошёл дальше" },
  { v: "failed", label: "Не прошёл" },
] as const;

export function DebriefForm({ id, initial }: { id: string; initial: Partial<Debrief> }) {
  const [state, action, pending] = useActionState<DebriefState, FormData>(saveDebrief, undefined);
  const uid = useId();
  const saved = Boolean(initial.savedAt || initial.questions?.length);
  return (
    <Card strong>
      <Label className="mb-2">Debrief</Label>
      <h2 className="h-serif mb-5 text-[26px]">Как прошло интервью?</h2>
      <form onSubmit={submitVia(action, startTransition)} className="flex flex-col gap-4" aria-describedby={state?.error ? `${uid}-err` : undefined}>
        <input type="hidden" name="id" value={id} />
        <Field label="Какие вопросы задавали" hint="По одному на строку">
          <textarea name="questions" required rows={4} defaultValue={initial.questions?.join("\n") ?? ""} className="field resize-y" placeholder={"Walk me through your segmentation project\nSQL window functions"} />
        </Field>
        <Field label="Где было сложно">
          <textarea name="hard" rows={2} defaultValue={initial.hard ?? ""} className="field resize-y" placeholder="Например: вопрос о конфликте со стейкхолдером" />
        </Field>
        <Field label="Что сказал интервьюер">
          <textarea name="interviewerSaid" rows={2} defaultValue={initial.interviewerSaid ?? ""} className="field resize-y" placeholder="Обратная связь, сигналы, что важно команде" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Следующие шаги">
            <input name="nextSteps" defaultValue={initial.nextSteps ?? ""} className="field" placeholder="Техническое интервью" />
          </Field>
          <Field label="Когда обещали ответить">
            <input type="date" name="answerBy" defaultValue={initial.answerBy ?? ""} className="field" />
          </Field>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-2">Обсуждали зарплату?</legend>
          <div className="flex gap-2">
            {[{ v: "yes", l: "Да" }, { v: "no", l: "Нет" }].map((o) => (
              <label key={o.v} className="flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white/60 px-4 py-2 text-[14px] has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
                <input type="radio" name="salaryDiscussed" value={o.v} defaultChecked={(initial.salaryDiscussed ? "yes" : "no") === o.v} className="accent-green" />
                {o.l}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label mb-2">Самооценка</legend>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className="cursor-pointer">
                <input type="radio" name="selfRating" value={n} defaultChecked={initial.selfRating === n} className="peer sr-only" required />
                <span className="num grid size-11 place-items-center rounded-full border border-line bg-white/60 text-[15px] text-ink-2 transition peer-checked:border-transparent peer-checked:bg-cta peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-green hover:bg-white" aria-hidden>{n}</span>
                <span className="sr-only">{n} из 5</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label mb-2">Статус раунда</legend>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => (
              <label key={o.v} className={cx("flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white/60 px-4 py-2 text-[14px] has-[:checked]:bg-green-soft has-[:checked]:border-green/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green", o.v === "failed" && "has-[:checked]:!bg-rose-soft has-[:checked]:!border-rose/30")}>
                <input type="radio" name="outcome" value={o.v} required defaultChecked={initial.outcome === o.v} className="accent-green" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        {state?.error && <p id={`${uid}-err`} role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13.5px] text-rose">{state.error}</p>}
        {state?.ok && <p role="status" className="rounded-xl bg-green-soft px-3 py-2 text-[13.5px] text-green">Debrief сохранён. Письмо и следующий шаг — справа.</p>}
        <div>
          <PendingButton pending={pending} pendingText="Сохраняем и пишем письмо…">{saved ? "Обновить Debrief" : "Сохранить Debrief"}</PendingButton>
        </div>
      </form>
    </Card>
  );
}
