"use client";
import { useState, useTransition, type ReactNode } from "react";
import { Play, Sparkles } from "lucide-react";
import { cx } from "@/components/ui";
import { runAgentWithResult, simulateWithResult, type DemoResult } from "./demo-actions";

/**
 * A demo action button with its own result line (polite live region). The button is disabled while the action runs,
 * so a double click never starts a second cycle.
 */
function DemoButton({ run, label, pendingLabel, icon, className }: { run: () => Promise<DemoResult>; label: string; pendingLabel: string; icon: ReactNode; className?: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DemoResult | null>(null);
  const onClick = () => {
    if (pending) return;
    setResult(null);
    start(async () => {
      try {
        setResult(await run());
      } catch {
        setResult({ ok: false, message: "Не получилось — попробуй ещё раз.", at: Date.now() });
      }
    });
  };
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-busy={pending || undefined}
        className={cx("inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-[12.5px] font-medium text-ink-3 transition-all hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green disabled:opacity-60", className)}
      >
        {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : icon}
        {pending ? pendingLabel : label}
      </button>
      <span role="status" aria-live="polite" className={cx("max-w-xs px-3 text-[12px] leading-snug", result?.ok === false ? "text-amber" : "text-ink-2")}>
        {result?.message}
      </span>
    </span>
  );
}

export function RunAgentButton({ className }: { className?: string }) {
  return <DemoButton run={runAgentWithResult} label="Запустить цикл агента" pendingLabel="Агент работает…" icon={<Play className="size-3.5" strokeWidth={1.7} aria-hidden />} className={className} />;
}

export function SimulateButton({ className }: { className?: string }) {
  return <DemoButton run={simulateWithResult} label="Симулировать ответы" pendingLabel="Симулируем…" icon={<Sparkles className="size-3.5 text-amber" strokeWidth={1.7} aria-hidden />} className={className} />;
}
