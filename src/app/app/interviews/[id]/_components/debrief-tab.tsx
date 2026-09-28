import { ArrowRight, Mail, Route } from "lucide-react";
import { ButtonLink, Card, Chip, Field, Label } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createNextRound, type Debrief } from "@/lib/actions/interview";
import { IV_STATUS_LABEL, IV_STATUS_TONE, ROUND_LABEL, nextRound } from "@/lib/rounds";
import { CopyButton } from "../../_components/copy-button";
import { DebriefForm } from "./debrief-form";

export function DebriefTab({ iv, debrief }: { iv: { id: string; round: string; status: string }; debrief: Partial<Debrief> }) {
  const has = Boolean(debrief.savedAt || debrief.questions?.length);
  const next = nextRound(iv.round);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <DebriefForm id={iv.id} initial={debrief} />

      <div className="flex flex-col gap-4">
        {!has ? (
          <Card>
            <Label className="mb-2">Зачем Debrief</Label>
            <ul className="flex flex-col gap-2 text-[14px] text-ink-2">
              <li>· Thank-you письмо в течение 24 часов</li>
              <li>· Вопросы попадают в следующий Interview Pack</li>
              <li>· Агент понимает, какой раунд следующий, и двигает pipeline</li>
            </ul>
            <p className="mt-3 text-[12.5px] text-ink-3">Заполните сразу после звонка, пока детали свежие — 2 минуты.</p>
          </Card>
        ) : (
          <>
            <Card>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Label>Результат</Label>
                <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"}>{IV_STATUS_LABEL[iv.status] ?? iv.status}</Chip>
                {debrief.selfRating ? <Chip>Самооценка {debrief.selfRating}/5</Chip> : debrief.score ? <Chip>Оценка {debrief.score}</Chip> : null}
              </div>
              {debrief.nextSuggestion ? (
                <p className="flex gap-2 text-[14px] text-ink-2"><Route className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} />{debrief.nextSuggestion}</p>
              ) : debrief.nextSteps ? (
                <p className="text-[14px] text-ink-2">Следующие шаги: {debrief.nextSteps}</p>
              ) : null}

              {iv.status === "passed" && next && (
                <form action={createNextRound} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                  <input type="hidden" name="id" value={iv.id} />
                  <Field label={`Дата раунда ${ROUND_LABEL[next]}`} hint="Если ещё не назначили — оставьте пустым">
                    <input type="datetime-local" name="scheduledAt" className="field" />
                  </Field>
                  <SubmitButton pendingText="Создаём…">Создать раунд {ROUND_LABEL[next]}<ArrowRight className="size-4" strokeWidth={1.7} /></SubmitButton>
                </form>
              )}
              {iv.status === "passed" && !next && iv.round === "final" && (
                <ButtonLink href="/app/offers" className="mt-4">Открыть Offer Desk<ArrowRight className="size-4" strokeWidth={1.7} /></ButtonLink>
              )}
            </Card>
            {debrief.followUpEmail && (
              <Card>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Mail className="size-4 text-teal" strokeWidth={1.7} /><Label>Thank-you письмо</Label></span>
                  <Chip tone={debrief.followUpBy === "claude" ? "green" : "teal"}>{debrief.followUpBy === "claude" ? "Claude" : "engine"}</Chip>
                </div>
                <p className="mb-3 whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 text-[13.5px] leading-relaxed text-ink-2">{debrief.followUpEmail}</p>
                <CopyButton text={debrief.followUpEmail} label="Копировать письмо" />
                <p className="mt-2 text-[12px] text-ink-4">Simplify не отправляет письма рекрутерам за вас — отправьте со своей почты.</p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
