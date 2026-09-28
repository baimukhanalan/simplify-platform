"use client";
import { useState, useTransition, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { cx } from "@/components/ui";
import { regeneratePack, regeneratePackForm } from "@/lib/actions/interview";
import { PendingButton } from "../../_components/pending-button";

type Props = {
  id: string;
  /** Server-side `aiEnabled()` — only used for the pending wording. */
  aiOn: boolean;
  /** Who produced the version currently on screen, and when (changes after a successful run). */
  by?: string;
  stamp?: string;
  pendingText: string;
  className?: string;
};

/**
 * «Обновить с AI»: runs the server action in a transition (no full-page reload), then reports
 * the outcome inline in a polite live region. The action returns nothing, so the result is read
 * from the refreshed props: a new stamp means it ran; `by` says whether Claude or the engine wrote it.
 * An unchanged stamp means the hourly limit stopped the run.
 */
export function RegenerateForm({ id, aiOn, by, stamp, pendingText, className }: Props) {
  const [pending, start] = useTransition();
  // Stamp at the moment of submit; `undefined` = never submitted in this view.
  const [sentFrom, setSentFrom] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<{ limited: boolean; by: string | null } | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    setFailed(false);
    setResult(null);
    setSentFrom(stamp ?? null);
    start(async () => {
      try {
        const r = await regeneratePack(fd);
        setResult(r ? { limited: r.limited, by: r.by } : null);
      } catch {
        setFailed(true);
      }
    });
  };

  let msg: { text: string; tone: "ok" | "muted" | "warn" } | null = null;
  if (!pending && sentFrom !== undefined) {
    if (failed) msg = { text: "Не удалось обновить. Проверь соединение и попробуй ещё раз.", tone: "warn" };
    else if (result?.limited) msg = { text: "Лимит обновлений на этот час исчерпан — попробуй позже.", tone: "warn" };
    else if ((result?.by ?? by) === "claude") msg = { text: "Готово — Claude обновил материалы.", tone: "ok" };
    else msg = { text: "AI недоступен — показана версия движка.", tone: "muted" };
  }

  return (
    <div className={cx("flex flex-col items-start gap-1.5 sm:items-end", className)}>
      <form action={regeneratePackForm} onSubmit={onSubmit}>
        <input type="hidden" name="id" value={id} />
        <PendingButton pending={pending} pendingText={aiOn ? pendingText : "Обновляем…"} size="sm" variant="glass" className="!h-10">
          <Sparkles className="size-3.5" strokeWidth={1.7} aria-hidden />Обновить с AI
        </PendingButton>
      </form>
      <p role="status" aria-live="polite" className={cx("min-h-0 text-[12.5px]", msg?.tone === "ok" ? "text-green" : msg?.tone === "warn" ? "text-amber" : "text-ink-3")}>
        {msg?.text ?? ""}
      </p>
    </div>
  );
}

/** Small muted technical line, rendered only with ?debug=1. */
export function DebugLine({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[11px] text-ink-4">{children}</p>;
}
