"use client";
import Link from "next/link";
import { useEffect, useSyncExternalStore } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * Page-level result toast for actions whose card may disappear after the server refresh (Skip on «Ждут решения»,
 * a resolved approval). The card calls `announce()`; the one <Announcer/> on the page keeps the message in a polite
 * live region that outlives the card. Hides itself after a while; the close button hides it at once.
 */
type Msg = { text: string; tone: "ok" | "error"; href?: string; hrefLabel?: string; id: number };

const HIDE_MS = 10_000;
let current: Msg | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const clear = () => { current = null; emit(); };

export function announce(text: string, opts: { tone?: Msg["tone"]; href?: string; hrefLabel?: string } = {}) {
  current = { text, tone: opts.tone ?? "ok", href: opts.href, hrefLabel: opts.hrefLabel, id: Date.now() };
  clearTimeout(timer);
  timer = setTimeout(clear, HIDE_MS);
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

export function Announcer() {
  const msg = useSyncExternalStore(subscribe, () => current, () => null);
  // A message from this page must not greet the next one.
  useEffect(() => () => { clearTimeout(timer); current = null; }, []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-8">
      {msg && (
        <p key={msg.id} className={cx("pointer-events-auto flex w-full max-w-xl animate-rise items-start gap-2 rounded-2xl border px-4 py-3 text-[14px] shadow-(--shadow-glass)", msg.tone === "error" ? "border-rose/20 bg-rose-soft text-rose" : "border-green/20 bg-white text-head")}>
          {msg.tone === "error" ? <X className="mt-0.5 size-4 shrink-0" aria-hidden /> : <Check className="mt-0.5 size-4 shrink-0 text-green" aria-hidden />}
          <span className="min-w-0 flex-1">
            {msg.text}
            {msg.href && (
              <>
                {" "}
                <Link href={msg.href} className="inline-flex min-h-10 items-center gap-1 whitespace-nowrap text-teal underline-offset-2 hover:text-head hover:underline sm:min-h-0">
                  {msg.hrefLabel ?? "Открыть"}<ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </>
            )}
          </span>
          <button type="button" onClick={clear} className="-my-2 -mr-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-mint-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green" aria-label="Скрыть сообщение">
            <X className="size-4" aria-hidden />
          </button>
        </p>
      )}
    </div>
  );
}
