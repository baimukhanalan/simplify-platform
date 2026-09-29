"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import { createExtensionToken, revokeExtensionToken, type ExtensionTokenState } from "@/lib/actions/extension";

/** «Создать ключ» — the key is shown exactly once, right here; the server keeps only its hash. */
export function TokenPanel({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ExtensionTokenState, FormData>(createExtensionToken, {});
  const [copied, setCopied] = useState(false);
  // A revoked key is never shown again: once the page says «not connected», the one-time key from this session is gone
  // (the page may also remount the panel with a new `key` after revoke).
  const token = connected ? state.token : undefined;

  async function copy() {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the key stays selectable */
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {token ? (
        <div className="flex flex-col gap-2.5 rounded-[18px] border border-green/20 bg-green-soft p-4">
          <div className="label !text-green">Твой ключ — скопируй сейчас</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} aria-label="Ключ для расширения" spellCheck={false} className="field font-mono !text-[13px]" />
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
        <Button type="submit" variant={token ? "glass" : "primary"} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <KeyRound className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? "Создаём…" : connected || token ? "Создать новый ключ" : "Создать ключ для расширения"}
        </Button>
      </form>
      {connected && !token && <p className="text-[12.5px] text-ink-3">Новый ключ заменит текущий — расширение с прежним ключом отключится.</p>}
    </div>
  );
}

function RevokeSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending} aria-busy={pending || undefined} className="!h-10">
      {pending ? "Отзываем…" : "Да, отозвать"}
    </Button>
  );
}

/** «Отозвать ключ» with a confirm step: the extension loses access at once, so one tap never does it. */
export function RevokeKey() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <div className="border-t border-line pt-4">
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-10 items-center rounded text-[14px] text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
          Отозвать ключ
        </button>
        <p className="mt-1 text-[12.5px] text-ink-3">Расширение сразу потеряет доступ к твоему аккаунту.</p>
      </div>
    );
  return (
    <form action={revokeExtensionToken} className="flex flex-col gap-3 border-t border-line pt-4" role="group" aria-label="Подтверждение отзыва ключа">
      <p className="text-[13.5px] text-ink-2">Отозвать ключ? Расширение сразу потеряет доступ, для новой связки понадобится новый ключ.</p>
      <div className="flex flex-wrap gap-2">
        <RevokeSubmit />
        <Button type="button" variant="ghost" size="sm" className="!h-10" onClick={() => setConfirming(false)}>Отмена</Button>
      </div>
    </form>
  );
}
