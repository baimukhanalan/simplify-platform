"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { createExtensionToken, revokeExtensionToken, type ExtensionTokenState } from "@/lib/actions/extension";

/** «Создать ключ» — the key is shown exactly once, right here; the server keeps only its hash. */
export function TokenPanel({ connected }: { connected: boolean }) {
  const [state, action, pending] = useActionState<ExtensionTokenState, FormData>(createExtensionToken, {});
  const [copied, setCopied] = useState(false);
  const t = useT();
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
          <div className="label !text-green">{t("extensionPage.token.yourKey")}</div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input readOnly value={token} onFocus={(e) => e.currentTarget.select()} aria-label={t("extensionPage.token.aria")} spellCheck={false} className="field font-mono !text-[13px]" />
            <Button type="button" variant="green" size="sm" onClick={copy} className="shrink-0">
              {copied ? <Check className="size-4" strokeWidth={1.8} aria-hidden /> : <Copy className="size-4" strokeWidth={1.7} aria-hidden />}
              {copied ? t("extensionPage.token.copied") : t("extensionPage.token.copy")}
            </Button>
          </div>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {t("extensionPage.token.note")}
          </p>
        </div>
      ) : null}
      {state.error && <p role="alert" className="text-[13px] text-rose">{state.error}</p>}
      <form action={action} onSubmit={(e) => { if (pending) e.preventDefault(); }}>
        <Button type="submit" variant={token ? "glass" : "primary"} disabled={pending} aria-busy={pending || undefined}>
          {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <KeyRound className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? t("extensionPage.token.creating") : connected || token ? t("extensionPage.token.createNew") : t("extensionPage.token.create")}
        </Button>
      </form>
      {connected && !token && <p className="text-[12.5px] text-ink-3">{t("extensionPage.token.replaceNote")}</p>}
    </div>
  );
}

function RevokeSubmit() {
  const { pending } = useFormStatus();
  const t = useT();
  return (
    <Button type="submit" variant="danger" size="sm" disabled={pending} aria-busy={pending || undefined} className="!h-10">
      {pending ? t("extensionPage.token.revoking") : t("extensionPage.token.revokeYes")}
    </Button>
  );
}

/** «Отозвать ключ» with a confirm step: the extension loses access at once, so one tap never does it. */
export function RevokeKey() {
  const [confirming, setConfirming] = useState(false);
  const t = useT();
  if (!confirming)
    return (
      <div className="border-t border-line pt-4">
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex min-h-10 items-center rounded text-[14px] text-rose hover:underline focus-visible:outline-2 focus-visible:outline-green">
          {t("extensionPage.token.revoke")}
        </button>
        <p className="mt-1 text-[12.5px] text-ink-3">{t("extensionPage.token.revokeNote")}</p>
      </div>
    );
  return (
    <form action={revokeExtensionToken} className="flex flex-col gap-3 border-t border-line pt-4" role="group" aria-label={t("extensionPage.token.confirmAria")}>
      <p className="text-[13.5px] text-ink-2">{t("extensionPage.token.confirm")}</p>
      <div className="flex flex-wrap gap-2">
        <RevokeSubmit />
        <Button type="button" variant="ghost" size="sm" className="!h-10" onClick={() => setConfirming(false)}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
