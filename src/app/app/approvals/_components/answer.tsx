"use client";
import { useTransition, type FormEvent } from "react";
import { Check, PenLine } from "lucide-react";
import { cx } from "@/components/ui";
import { count, plural } from "../../../_components/ru";
import { announce } from "../../opportunities/_components/announcer";
import { resolveWithSummary, type ResolveResult } from "../actions";

type Quick = { value: string; label: string };

const pill =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-all duration-200 disabled:opacity-60 active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green";

function summary(r: ResolveResult, company: string | null) {
  const at = company ? `${company}: ` : "";
  if (r.decision === "reject") return `${at}отклонено — агент пропустил эту вакансию.`;
  if (!r.ok) return null;
  const parts = [`Решено: ${count(r.resolved, ["вопрос", "вопроса", "вопросов"])}.`];
  if (r.sent) parts.push(`Агент отправил ${count(r.sent, ["заявку", "заявки", "заявок"])}.`);
  if (r.handoffs) parts.push(`${count(r.handoffs, ["пакет готов", "пакета готовы", "пакетов готовы"])} к отправке через форму компании.`);
  if (!r.sent && !r.handoffs) parts.push("Заявки пока не ушли — по вакансиям остались другие шаги.");
  return at + parts.join(" ");
}

/**
 * Answer controls for one approval: confirm the agent's proposal, a quick answer, reject, or type an answer.
 * Every path goes through one transition: all buttons are disabled while it runs (no double submit), and the result
 * — how many questions closed and how many applications went out — goes to the page toast (a polite live region),
 * because this card leaves the list after the refresh. `same` > 1 warns that the answer covers identical questions.
 */
export function ApprovalAnswer({ id, company, proposed, quick, same, fieldId }: { id: string; company: string | null; proposed: string; quick: Quick[]; same: number; fieldId: string }) {
  const [pending, start] = useTransition();
  const noteId = `${fieldId}-same`;

  const send = (fd: FormData) => {
    if (pending) return;
    start(async () => {
      try {
        const r = await resolveWithSummary(fd);
        const text = summary(r, company);
        if (text) announce(text, r.handoffs ? { href: "/app/approvals#kind-handoff", hrefLabel: "К отправке" } : r.sent ? { href: "/app/applications", hrefLabel: "Заявки" } : {});
        else announce("Этот вопрос уже решён — обнови страницу.", { tone: "error" });
      } catch {
        announce("Не удалось сохранить ответ. Попробуй ещё раз.", { tone: "error" });
      }
    });
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter));
  };
  const describedBy = same > 1 ? noteId : undefined;

  return (
    <div className="flex flex-col gap-3" aria-busy={pending || undefined}>
      {same > 1 && (
        <p id={noteId} className="text-[13px] text-teal">
          Ответ применится к {same} {plural(same, ["такому вопросу", "таким вопросам", "таким вопросам"])} — в каждой вакансии, где он задан.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {proposed && (
          <form onSubmit={onSubmit}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="approve" />
            <button disabled={pending} aria-describedby={describedBy} className={cx(pill, "bg-green text-white shadow-(--shadow-cta) hover:bg-[#15603e]")}>
              <Check className="size-4" aria-hidden />{pending ? "Сохраняем…" : "Подтвердить"}
            </button>
          </form>
        )}
        {quick.length > 0 && (
          <form onSubmit={onSubmit} className="flex flex-wrap gap-2" aria-label="Быстрые ответы">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="decision" value="edit" />
            {quick.map((q) => (
              <button key={q.value} name="answer" value={q.value} disabled={pending} aria-describedby={describedBy} className="inline-flex h-10 items-center rounded-full border border-line bg-white/70 px-4 text-[13px] text-head transition-colors hover:border-green hover:text-green focus-visible:outline-2 focus-visible:outline-green disabled:opacity-60">
                Ответить «{q.label}»
              </button>
            ))}
          </form>
        )}
        <form onSubmit={onSubmit} className="sm:ml-auto">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="reject" />
          <button disabled={pending} className={cx(pill, "text-rose hover:bg-rose-soft")}>Отклонить и пропустить вакансию</button>
        </form>
      </div>
      <details className="group rounded-2xl border border-stroke bg-white/50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-2.5 text-[13.5px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          <PenLine className="size-4 text-teal" aria-hidden />{proposed ? "Изменить и подтвердить" : "Написать ответ"}
        </summary>
        <form onSubmit={onSubmit} className="flex flex-col gap-2.5 border-t border-line p-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="decision" value="edit" />
          <label htmlFor={fieldId} className="label">Твой ответ</label>
          <textarea id={fieldId} name="answer" required minLength={1} maxLength={2000} rows={3} defaultValue={proposed} aria-describedby={describedBy} className="field resize-y text-[14px]" />
          <div>
            <button disabled={pending} className={cx(pill, "h-11 bg-cta px-5 text-[#fcfcfc] shadow-(--shadow-cta) hover:bg-[#2f2c2c]")}>
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
              {pending ? "Сохраняем…" : "Подтвердить этот ответ"}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
