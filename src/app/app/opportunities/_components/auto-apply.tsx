"use client";
import { useOptimistic, useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { cx } from "@/components/ui";
import { setAutoApply } from "@/lib/actions/opportunities";

/** Global "Auto-apply all jobs above N% match" switch, bound to User.autonomy. Optimistic; reverts on failure. */
export function AutoApplyToggle({ enabled, min }: { enabled: boolean; min: number }) {
  const [on, setOn] = useOptimistic(enabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState("");

  const toggle = () => {
    const next = !on;
    setError("");
    start(async () => {
      setOn(next);
      try {
        await setAutoApply(next);
      } catch {
        setError("Не удалось сохранить. Попробуйте ещё раз.");
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
            Auto-apply all jobs above <span className="num">{min}%</span> match
          </span>
          <span className="text-[12.5px] text-ink-3" aria-live="polite">{on ? "Включено — агент подаёт сам" : "Выключено — агент подаёт только на отмеченные Apply / Auto"}</span>
        </div>
      </div>
      <p id="auto-apply-hint" className="flex items-start gap-1.5 text-[12px] leading-snug text-ink-3">
        <ShieldCheck className="mt-px size-3.5 shrink-0 text-teal" aria-hidden />
        Чувствительные вопросы (визы, юридические, self-identification) всё равно придут вам на подтверждение.
      </p>
      {error && <p role="alert" className="text-[12.5px] text-rose">{error}</p>}
    </div>
  );
}
