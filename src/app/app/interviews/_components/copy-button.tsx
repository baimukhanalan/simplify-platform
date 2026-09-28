"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cx } from "@/components/ui";

export function CopyButton({ text, label = "Копировать", className }: { text: string; label?: string; className?: string }) {
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
      <span aria-live="polite">{state === "ok" ? "Скопировано" : state === "fail" ? "Не удалось" : label}</span>
    </button>
  );
}
