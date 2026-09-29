"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/** Built-in texts in Russian, for a page that doesn't pass the «interviewsPage» namespace to the client. */
const RU = { copy: "Копировать", copied: "Скопировано", failed: "Не удалось" } as const;

/**
 * Copy-to-clipboard button. Its own texts come from `labels` (a server page passes t("interviewsPage.copy.*")) or from
 * «interviewsPage.copy.*» in the page's <I18nScope>; without either they fall back to Russian (never a raw key).
 */
export function CopyButton({ text, label, labels, className }: { text: string; label?: string; labels?: Partial<Record<keyof typeof RU, string>>; className?: string }) {
  const t = useT();
  const msg = (k: keyof typeof RU) => labels?.[k] ?? (t.has(`interviewsPage.copy.${k}`) ? t(`interviewsPage.copy.${k}`) : RU[k]);
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("ok");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button type="button" onClick={copy} className={cx("inline-flex h-10 items-center gap-2 rounded-full glass !rounded-full px-4 text-[13px] font-medium text-head transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", className)}>
      {state === "ok" ? <Check className="size-3.5 text-green" strokeWidth={2} /> : <Copy className="size-3.5" strokeWidth={1.7} />}
      <span aria-live="polite">{state === "ok" ? msg("copied") : state === "fail" ? msg("failed") : label ?? msg("copy")}</span>
    </button>
  );
}
