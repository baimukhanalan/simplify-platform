"use client";
import { useActionState, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import { createExtensionToken, type ExtensionTokenState } from "@/lib/actions/extension";

/** «Создать ключ» — the key is shown exactly once, right here; the server keeps only its hash. */
export function TokenPanel({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ExtensionTokenState, FormData>(createExtensionToken, {});
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!state.token) return;
    try {
      await navigator.clipboard.writeText(state.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the key stays selectable */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state.token ? (
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-green/20 bg-green-soft p-4">
          <div className="label !text-green">Твой ключ — скопируй сейчас</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={state.token} onFocus={(e) => e.currentTarget.select()} aria-label="Ключ для расширения" spellCheck={false} className="field font-mono !text-[13px]" />
            <Button type="button" variant="green" size="sm" onClick={copy} className="shrink-0">
              {copied ? <Check className="size-4" strokeWidth={1.8} aria-hidden /> : <Copy className="size-4" strokeWidth={1.7} aria-hidden />}
              {copied ? "Скопировано" : "Скопировать"}
            </Button>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Вставь его в настройках расширения. Больше мы его не покажем: Simplify хранит только отпечаток ключа. Потерял — создай новый, старый перестанет работать.
          </p>
        </div>
      ) : null}
      {state.error && <p role="alert" className="text-[13px] text-rose">{state.error}</p>}
      <form action={action} onSubmit={(e) => { if (pending) e.preventDefault(); }}>
        <Button type="submit" variant={state.token ? "glass" : "primary"} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <KeyRound className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? "Создаём…" : connected || state.token ? "Создать новый ключ" : "Создать ключ для расширения"}
        </Button>
      </form>
      {connected && !state.token && <p className="text-[12.5px] text-ink-3">Новый ключ заменит текущий — расширение с прежним ключом отключится.</p>}
    </div>
  );
}
