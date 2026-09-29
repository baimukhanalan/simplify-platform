"use client";
import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, CalendarClock, Link2Off } from "lucide-react";
import { ingestPastedEmail, type IngestState } from "@/lib/actions/ops";
import { INBOX_CLASS } from "@/lib/ops";
import { statusRu } from "../../../_components/ru";
import { Chip, cx } from "@/components/ui";

/** What the letter means for the application, in words (the engine's own effect lines name internal statuses). */
const EFFECT: Record<string, string> = {
  confirmation: "работодатель подтвердил, что получил заявку",
  rejection: "работодатель отказал — агент учтёт это при выборе следующих вакансий",
  assessment: "приглашение на тестовое задание — агент готовит Interview Room",
  interview: "приглашение на интервью — агент готовит Interview Room",
  offer: "это оффер — он появится в Offer Desk",
};

/** Manual input for employer mail (live mode only, until a mailbox is connected): Inbox Intelligence classifies it. */
export function PasteEmail() {
  const [state, action, pending] = useActionState<IngestState, FormData>(ingestPastedEmail, {});
  const r = state.result;
  const meta = r ? INBOX_CLASS[r.classification] ?? INBOX_CLASS.unknown : null;

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-3" aria-describedby={state.error ? "paste-error" : undefined}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label">От кого</span>
            <input name="from" type="text" inputMode="email" autoComplete="off" placeholder="talent@company.com" defaultValue={state.fields?.from} className="field !text-[14px]" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label">Тема</span>
            <input name="subject" type="text" autoComplete="off" placeholder="Тема письма от работодателя" defaultValue={state.fields?.subject} className="field !text-[14px]" />
          </label>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="label">Текст письма</span>
          <textarea name="body" required rows={6} placeholder="Вставь письмо работодателя целиком" defaultValue={state.fields?.body} aria-invalid={state.error ? true : undefined} className="field resize-y !text-[14px] leading-relaxed" />
        </label>
        {state.error && <p id="paste-error" role="alert" className="text-[13px] text-rose">{state.error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green disabled:opacity-60">
            {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
            {pending ? "Классифицируем…" : "Распознать письмо"}
          </button>
          <span className="text-[12px] text-ink-3">Письмо появится в ответах и, если найдена заявка, изменит её статус.</span>
        </div>
      </form>

      <div aria-live="polite">
        {r && meta && (
          <div className="flex animate-rise flex-col gap-3 rounded-2xl border border-stroke bg-white/75 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label !text-[11px]">Результат</span>
              <Chip tone={meta.tone} dot>{meta.label}</Chip>
              <span className="num text-[13px] text-ink-2">уверенность {Math.round(r.confidence * 100)}%</span>
            </div>
            {r.opportunityId ? (
              <div className="flex flex-col gap-1.5 text-[14px]">
                <Link href={`/app/opportunities/${r.opportunityId}`} className="text-head hover:underline">{r.company} <span className="text-ink-3">· {r.title}</span></Link>
                {r.updated && r.before !== r.after ? (
                  <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
                    <span className="text-ink-3">Статус заявки:</span>
                    <Chip>{statusRu(r.before ?? "")}</Chip>
                    <ArrowRight className="size-3.5 text-green" aria-label="→" />
                    <Chip tone="green">{statusRu(r.after ?? "")}</Chip>
                  </div>
                ) : (
                  <p className="text-[13px] text-ink-3">Статус не изменился{r.after ? ` (остаётся «${statusRu(r.after)}»)` : ""}: {EFFECT[r.classification] ?? "письмо сохранено"}.</p>
                )}
              </div>
            ) : (
              <p className="flex items-start gap-2 text-[13.5px] text-amber"><Link2Off className="mt-0.5 size-4 shrink-0" aria-hidden />Не удалось связать с заявкой: в адресе и тексте нет компании из твоих заявок. Письмо сохранено, статусы в Applications не менялись.</p>
            )}
            {r.deadline && (
              <p className={cx("flex items-center gap-2 text-[13px] text-ink-2")}><CalendarClock className="size-4 text-teal" aria-hidden />Дедлайн: {new Date(r.deadline).toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" })}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
