import { ArrowRight, CalendarClock, CircleDollarSign, Mail, Route } from "lucide-react";
import { ButtonLink, Card, Chip, Field, Label, Ring } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createNextRound, type Debrief } from "@/lib/actions/interview";
import { IV_STATUS_LABEL, IV_STATUS_TONE, ROUND_LABEL, nextRound } from "@/lib/rounds";
import { CopyButton } from "../../_components/copy-button";
import { DebriefForm } from "./debrief-form";

type Props = { iv: { id: string; round: string; status: string; company: string; upcoming: boolean }; debrief: Partial<Debrief>; debug?: boolean };

const verdict = (p: number) => (p >= 80 ? "Сильное интервью" : p >= 65 ? "Хорошо, есть что усилить" : p >= 50 ? "Средне — есть что подготовить" : "Тяжёлый раунд — разбери, что пошло не так");

export function DebriefTab({ iv, debrief, debug }: Props) {
  const has = Boolean(debrief.savedAt || debrief.questions?.length);
  const next = nextRound(iv.round);

  // Before the call: the debrief is secondary — a short note with the form collapsed.
  if (!has && iv.upcoming)
    return (
      <Card className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
          <div className="flex flex-col gap-1">
            <Label>{iv.round === "assessment" ? "После теста" : "После звонка"}</Label>
            <p className="text-[14.5px] text-ink-2">
              {iv.round === "assessment"
                ? `Тест ${iv.company} ещё впереди. Когда сдашь его, вернись сюда и запиши, какие были задания — это поможет на следующих этапах.`
                : `Интервью с ${iv.company} ещё впереди. Сразу после звонка вернись сюда — разбор, план подготовки и письмо с благодарностью появятся за минуту.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/interviews/${iv.id}`} size="sm" scroll={false} className="!h-10">К подготовке<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden /></ButtonLink>
        </div>
        <details className="group border-t border-line pt-4">
          <summary className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded text-[13.5px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">{iv.round === "assessment" ? "Тест уже позади? Заполнить разбор" : "Интервью уже прошло? Заполнить разбор"}</summary>
          <div className="mt-4"><DebriefForm id={iv.id} /></div>
        </details>
      </Card>
    );

  if (!has)
    return (
      <Card strong className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>Разбор интервью</Label>
          <h2 className="h-serif text-[clamp(30px,3.6vw,44px)]">Как прошло?</h2>
          <p className="max-w-xl text-[14.5px] text-ink-2">
            Расскажи своими словами, пока детали свежие. Агент превратит рассказ в разбор, план подготовки и письмо с благодарностью.
          </p>
        </div>
        <DebriefForm id={iv.id} />
      </Card>
    );

  const perf = debrief.performance;
  const structured = typeof perf === "number";
  const answerBy = debrief.answerBy ? new Date(debrief.answerBy).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" }) : null;

  return (
    <div className="flex flex-col gap-5">
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {structured ? <Ring value={perf} size={128} stroke={9} label="из 100" className="shrink-0" /> : null}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>Разбор интервью · {ROUND_LABEL[iv.round] ?? iv.round}</Label>
              <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
              {debrief.structuredBy === "claude" && <Chip tone="green">Claude</Chip>}
              {debug && <Chip>by: {debrief.structuredBy ?? "—"}</Chip>}
            </div>
            <h2 className="h-serif text-[clamp(28px,3.4vw,42px)]">{structured ? <>Оценка <span className="num">{perf}</span>/100</> : "Разбор сохранён"}</h2>
            <p className="text-[15px] text-ink-2">{structured ? verdict(perf) : debrief.selfRating ? `Самооценка ${debrief.selfRating}/5` : ""}</p>
          </div>
        </div>

        {structured && (
          <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
            {[
              { k: "Сильные стороны", items: debrief.strong ?? [], dot: "bg-green", empty: "Не прозвучало — это нормально." },
              { k: "Слабые места", items: debrief.weak ?? [], dot: "bg-amber", empty: "Слабых мест не названо." },
              { k: "Что подготовить дальше", items: debrief.nextPrep ?? [], dot: "bg-teal", empty: "—" },
            ].map((col) => (
              <div key={col.k} className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
                <Label>{col.k}</Label>
                {col.items.length ? (
                  <ul className="flex flex-col gap-2">
                    {col.items.map((x) => <li key={x} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2"><span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${col.dot}`} />{x}</li>)}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-ink-3">{col.empty}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="flex gap-3">
            <Route className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[10px]">Следующий этап</dt><dd className="mt-1 text-[14px] text-head">{debrief.nextSteps || "Не назвали"}</dd></div>
          </div>
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[10px]">Ответ обещали</dt><dd className="mt-1 text-[14px] text-head">{answerBy ?? "Срок не назвали"}</dd></div>
          </div>
          <div className="flex gap-3">
            <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[10px]">Зарплата</dt><dd className="mt-1 text-[14px] text-head">{debrief.salaryDiscussed ? debrief.salaryNote || "Обсуждали" : "Не обсуждали"}</dd></div>
          </div>
        </dl>

        {debrief.questions && debrief.questions.length > 0 && (
          <div className="border-t border-line pt-5">
            <Label className="mb-2.5">Какие вопросы были · попадут в следующие Interview Room</Label>
            <ul className="flex flex-wrap gap-1.5">
              {debrief.questions.map((q) => <li key={q} className="rounded-full border border-line bg-white/65 px-3 py-1 text-[13px] text-ink-2">{q}</li>)}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4">
          <Label>Что дальше</Label>
          {debrief.nextSuggestion && <p className="text-[15px] leading-relaxed text-ink-2">{debrief.nextSuggestion}</p>}
          {iv.status === "passed" && next && (
            <form action={createNextRound} className="flex flex-col gap-3 rounded-2xl border border-green/20 bg-green-soft/50 p-4">
              <input type="hidden" name="id" value={iv.id} />
              <Field label={`Дата раунда «${ROUND_LABEL[next].toLowerCase()}»`} hint="Если ещё не назначили — оставь пустым">
                <input type="datetime-local" name="scheduledAt" className="field" />
              </Field>
              <div><SubmitButton pendingText="Создаём комнату…">Создать раунд «{ROUND_LABEL[next].toLowerCase()}»<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></SubmitButton></div>
            </form>
          )}
          {iv.status === "passed" && !next && iv.round === "final" && (
            <ButtonLink href="/app/offers" className="self-start">Открыть Offer Desk<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></ButtonLink>
          )}
          {iv.status !== "passed" && debrief.nextPrep && debrief.nextPrep.length > 0 && (
            <ButtonLink href={`/app/interviews/${iv.id}?tab=mock`} variant="glass" size="sm" className="!h-10 self-start">Потренировать слабые места в пробном интервью</ButtonLink>
          )}
        </Card>

        {debrief.followUpEmail && (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Mail className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>Письмо после интервью</Label></span>
              <CopyButton text={debrief.followUpEmail} label="Копировать" />
            </div>
            <pre tabIndex={0} aria-label="Текст письма с благодарностью" className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{debrief.followUpEmail}</pre>
            <p className="text-[12px] text-ink-3">Отправь со своей почты в течение 24 часов.</p>
          </Card>
        )}
      </div>

      <details className="glass group p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-[14.5px] font-medium text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          Пересказать заново
          <span aria-hidden className="text-ink-4 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-5">
          <DebriefForm id={iv.id} initialTranscript={debrief.transcript ?? (debrief.questions ?? []).join(". ")} initialOutcome={debrief.outcome ?? "done"} />
        </div>
      </details>
    </div>
  );
}
