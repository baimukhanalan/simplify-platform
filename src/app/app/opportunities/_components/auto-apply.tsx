"use client";
import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { cx } from "@/components/ui";
import { setAutoApply } from "@/lib/actions/opportunities";

/**
 * Global "Auto-apply all jobs above N% match" switch = User.autonomy.submitApplications (the Agent screen writes the
 * same field; the threshold is set there). `consent` is the campaign's auto-submit consent: without it nothing is
 * sent by the agent, so the status line says so instead of claiming the agent applies. Optimistic; reverts on failure.
 */
export function AutoApplyToggle({ enabled, min, consent }: { enabled: boolean; min: number; consent: boolean }) {
  // `saved` = what the server confirmed; the optimistic value falls back to it when the transition ends, so a refused
  // save ({ ok: false }) or a thrown one flips the switch back instead of showing a state that was never stored.
  const [saved, setSaved] = useState(enabled);
  const [prevProp, setPrevProp] = useState(enabled);
  if (enabled !== prevProp) {
    setPrevProp(enabled);
    setSaved(enabled);
  }
  const [on, setOn] = useOptimistic(saved);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const toggle = () => {
    const next = !on;
    setError("");
    start(async () => {
      setOn(next);
      try {
        const r = await setAutoApply(next);
        setSaved(r.enabled);
        if (!r.ok) setError("Не удалось сохранить — переключатель вернулся в прежнее положение. Попробуй ещё раз.");
      } catch {
        setError("Не удалось сохранить — переключатель вернулся в прежнее положение. Попробуй ещё раз.");
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="auto-apply-label"
          aria-describedby="auto-apply-hint"
          onClick={toggle}
          disabled={pending}
          className={cx(
            "relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green disabled:opacity-70",
            on ? "border-transparent bg-green" : "border-line bg-head/10",
          )}
        >
          <span className={cx("inline-block size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/.25)] transition-transform duration-200", on ? "translate-x-[22px]" : "translate-x-[3px]")} />
        </button>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span id="auto-apply-label" className="text-[14px] font-medium leading-snug text-head">
            Автоподача на все вакансии с Match от <span className="num">{min}%</span>
          </span>
          <span className="text-[12.5px] text-ink-3" aria-live="polite">
            {!consent
              ? "Автоподача выключена в настройках — агент готовит пакеты, но сам ничего не отправляет. Подать можно кнопкой Apply."
              : on
                ? `Включено — агент сам подаёт на вакансии с Match ≥ ${min}% и на отмеченные Auto`
                : "Выключено — агент подаёт только на отмеченные Apply / Auto"}
          </span>
          {!consent && <Link href="/app/settings" className="inline-flex min-h-10 items-center text-[12.5px] text-teal underline-offset-2 hover:underline sm:min-h-0">Включить автоподачу</Link>}
          <Link href="/app/agent" className="inline-flex min-h-10 items-center text-[12px] text-ink-3 underline-offset-2 hover:text-head hover:underline sm:min-h-0">Порог Match — в настройках агента</Link>
        </div>
      </div>
      <p id="auto-apply-hint" className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-3">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-teal" aria-hidden />
        Чувствительные вопросы (визы, юридические, самоидентификация) всё равно придут тебе на подтверждение.
      </p>
      {error && <p role="alert" className="text-[12.5px] text-rose">{error}</p>}
    </div>
  );
}
