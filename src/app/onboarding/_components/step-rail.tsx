import Link from "next/link";
import { Check } from "lucide-react";
import { ONBOARDING_STEPS, LAST_STEP } from "@/lib/onboarding";
import { cx } from "@/components/ui";

/** Vertical progress rail on desktop; compact bar + step dots on mobile. */
export function StepRail({ current, done }: { current: number; done: number[] }) {
  const doneSet = new Set(done);
  const reachable = (n: number) => n <= current || doneSet.has(n) || doneSet.has(n - 1);
  const pct = Math.round((doneSet.size / LAST_STEP) * 100);

  return (
    <nav aria-label="Шаги онбординга" className="lg:sticky lg:top-6 lg:self-start">
      {/* Mobile */}
      <div className="glass flex flex-col gap-3 p-4 lg:hidden">
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-head">{ONBOARDING_STEPS[current - 1].label}</span>
          <span className="num text-ink-3">{current} / {LAST_STEP}</span>
        </div>
        <ol className="grid grid-cols-5 gap-1.5">
          {ONBOARDING_STEPS.map((st) => {
            const isDone = doneSet.has(st.n);
            const cls = cx("block h-1.5 rounded-full transition-colors", st.n === current ? "bg-cta" : isDone ? "bg-green" : "bg-head/10");
            return (
              <li key={st.n}>
                {reachable(st.n) ? (
                  <Link href={`/onboarding?step=${st.n}`} aria-label={`Шаг ${st.n}: ${st.label}${isDone ? " (пройден)" : ""}`} aria-current={st.n === current ? "step" : undefined} className="block py-2 focus-visible:outline-2 focus-visible:outline-green"><span className={cls} /></Link>
                ) : (
                  <span className="block py-2" aria-label={`Шаг ${st.n}: ${st.label}`}><span className={cls} /></span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* Desktop */}
      <div className="hidden flex-col gap-5 lg:flex">
        <div className="flex flex-col gap-2">
          <span className="label">Запуск кампании</span>
          <div className="flex items-center gap-2.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-head/10"><div className="h-full rounded-full bg-green transition-[width] duration-700" style={{ width: `${pct}%` }} /></div>
            <span className="num text-[12px] text-ink-3">{pct}%</span>
          </div>
        </div>
        <ol className="relative flex flex-col">
          <span aria-hidden className="absolute bottom-4 left-[15px] top-4 w-px bg-line" />
          {ONBOARDING_STEPS.map((st) => {
            const isDone = doneSet.has(st.n);
            const isCur = st.n === current;
            const inner = (
              <>
                <span className={cx("relative z-10 grid size-[31px] shrink-0 place-items-center rounded-full border text-[12px] transition-all", isCur ? "border-cta bg-cta text-white shadow-(--shadow-cta)" : isDone ? "border-green bg-green text-white" : "border-line bg-white/80 text-ink-3")}>
                  {isDone && !isCur ? <Check className="size-3.5" strokeWidth={2.6} aria-hidden /> : <span className="num">{st.n}</span>}
                </span>
                <span className="flex flex-col">
                  <span className={cx("text-[14px]", isCur ? "font-medium text-head" : isDone ? "text-ink-2" : "text-ink-3")}>{st.label}</span>
                  {isCur && <span className="text-[12px] text-ink-3">{st.title}</span>}
                </span>
              </>
            );
            return (
              <li key={st.n}>
                {reachable(st.n) ? (
                  <Link href={`/onboarding?step=${st.n}`} aria-current={isCur ? "step" : undefined} className="group flex items-center gap-3 rounded-xl py-2 pr-2 transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:outline-green">
                    {inner}
                    {isDone && !isCur && <span className="sr-only">(пройден)</span>}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 py-2 pr-2 opacity-80">{inner}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
