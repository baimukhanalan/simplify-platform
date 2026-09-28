"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { ArrowRight, Bot, Check, Send, Undo2, X } from "lucide-react";
import { cx } from "@/components/ui";
import { decideOpportunity, type DecisionState } from "@/lib/actions/opportunities";

type Props = {
  id: string;
  company: string;
  decision: string; // "" | apply | auto | skip
  status: string;
  blocked: boolean;
  /** Pending sensitive questions for this role. */
  pending?: number;
  size?: "sm" | "md";
};

const pill =
  "inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-all duration-200 disabled:opacity-55 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]";

/**
 * Apply / Auto / Skip for one vacancy. Apply asks for an explicit confirmation first (it submits now);
 * Auto and Skip are one click because both are reversible. Result is announced in a polite live region.
 */
export function DecisionBar({ id, company, decision, status, blocked, pending = 0, size = "sm" }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, busy] = useActionState<DecisionState, FormData>(async (prev, fd) => {
    const r = await decideOpportunity(prev, fd);
    setConfirming(false);
    // The confirm panel unmounts with focus inside it — don't drop focus to <body>.
    requestAnimationFrame(() => { if (document.activeElement === document.body) applyRef.current?.focus(); });
    return r;
  }, {});
  const [intent, setIntent] = useState<string>("");
  const applyRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const h = size === "md" ? "h-11 px-5 text-[14.5px]" : "h-9 px-4 text-[13px]";

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const cancel = () => {
    setConfirming(false);
    requestAnimationFrame(() => applyRef.current?.focus());
  };

  // Always mounted so screen readers announce the result when it appears.
  const feedback = (
    <div aria-live="polite" className="contents">
      {(state.message || state.error) && (
        <p className={cx("flex items-start gap-1.5 text-[12.5px] leading-snug", state.error ? "text-rose" : "text-ink-2")}>
          {state.error ? <X className="mt-px size-3.5 shrink-0" aria-hidden /> : <Check className="mt-px size-3.5 shrink-0 text-green" aria-hidden />}
          <span>
            {state.error ?? state.message}
            {state.href && (
              <>
                {" "}
                <Link href={state.href} className="inline-flex items-center gap-1 whitespace-nowrap text-teal underline-offset-2 hover:text-head hover:underline">
                  {state.hrefLabel ?? "Открыть"}<ArrowRight className="size-3" aria-hidden />
                </Link>
              </>
            )}
          </span>
        </p>
      )}
    </div>
  );

  if (status === "skipped" || decision === "skip") {
    return (
      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="id" value={id} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-3">Пропущено{blocked ? " — hard blocker" : ""}</span>
          {!blocked && (
            <button name="decision" value="reset" disabled={busy} className={cx(pill, h, "glass !rounded-full text-head hover:bg-white")}>
              <Undo2 className="size-3.5" aria-hidden />{busy ? "Возвращаем…" : "Вернуть"}
            </button>
          )}
        </div>
        {feedback}
      </form>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-2" onSubmit={(e) => setIntent(((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "")}>
      <input type="hidden" name="id" value={id} />
      {confirming ? (
        <div
          className="flex flex-col gap-2.5 rounded-2xl border border-stroke bg-white/90 p-3"
          role="group"
          aria-label={`Подтверждение заявки в ${company}`}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } }}
        >
          <p className="text-[13px] leading-snug text-ink-2">
            Подать в <b className="font-medium text-head">{company}</b> сейчас? Агент соберёт персональное CV и cover letter и отправит заявку.
            Чувствительные вопросы всё равно придут вам на подтверждение.
          </p>
          <div className="flex flex-wrap gap-2">
            <button ref={confirmRef} name="decision" value="apply" disabled={busy} aria-busy={busy || undefined} className={cx(pill, h, "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]")}>
              {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
              {busy ? "Готовим и отправляем…" : "Да, подать"}
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={cx(pill, h, "text-head hover:bg-white/70")}>Отмена</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            ref={applyRef}
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy || blocked}
            aria-pressed={decision === "apply"}
            title={blocked ? "Hard blocker — агент не подаёт" : undefined}
            className={cx(pill, h, "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]")}
          >
            <Send className="size-3.5" aria-hidden />Apply
          </button>
          <button
            name="decision"
            value={decision === "auto" ? "reset" : "auto"}
            disabled={busy || blocked}
            aria-pressed={decision === "auto"}
            className={cx(pill, h, decision === "auto" ? "bg-green-soft text-green ring-1 ring-green/25 hover:bg-green/15" : "glass !rounded-full text-head hover:bg-white")}
            title={decision === "auto" ? "Агент подаст сам. Нажмите, чтобы снять." : "Агент сам решит, когда и как подать"}
          >
            {busy && (intent === "auto" || intent === "reset") ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Bot className="size-3.5" aria-hidden />}
            {decision === "auto" ? "Auto включён" : "Auto"}
          </button>
          <button name="decision" value="skip" disabled={busy} className={cx(pill, h, "text-ink-3 hover:bg-white/60 hover:text-rose")}>
            {busy && intent === "skip" ? "Пропускаем…" : "Skip"}
          </button>
          {pending > 0 && !state.message && (
            <Link href="/app/approvals" className="text-[12.5px] text-amber underline-offset-2 hover:underline">
              {decision === "apply" ? "Apply подтверждён · " : ""}{pending === 1 ? "1 вопрос ждёт вас" : `${pending} вопроса ждут вас`}
            </Link>
          )}
        </div>
      )}
      {feedback}
    </form>
  );
}
