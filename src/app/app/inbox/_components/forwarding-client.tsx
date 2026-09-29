"use client";
import { useActionState, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { regenerateInboxAlias, type RegenerateState } from "@/lib/inbound/actions";
import { cx } from "@/components/ui";
import { useT } from "@/lib/i18n/client";

/** Copy a value; «Скопировано» is announced to screen readers. Falls back to selecting the text when the clipboard is blocked. */
export function CopyButton({ value, label, targetId, className }: { value: string; label?: string; targetId?: string; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 2000);
    } catch {
      const el = targetId ? document.getElementById(targetId) : null;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cx("inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full border border-stroke bg-white px-4 text-[13px] font-medium text-head transition-colors hover:bg-mint-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", className)}
    >
      {done ? <Check className="size-4 text-green" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span aria-live="polite">{done ? t("inbox.copied") : label ?? t("inbox.copy")}</span>
    </button>
  );
}

/** «Сменить адрес» with an inline confirmation: the old address stops working at once. */
export function RegenerateAlias() {
  const [state, action, pending] = useActionState<RegenerateState, FormData>(regenerateInboxAlias, {});
  const t = useT();
  // The confirmation belongs to the state it was opened on: a finished regeneration (a new state) closes it by itself.
  const [openedOn, setOpenedOn] = useState<RegenerateState | null>(null);
  const asking = openedOn !== null && (openedOn === state || Boolean(state.error));
  const setAsking = (v: boolean) => setOpenedOn(v ? state : null);
  const noteId = useId();
  if (!asking) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" onClick={() => setAsking(true)} className="inline-flex min-h-10 items-center gap-1.5 self-start rounded text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
          <RefreshCw className="size-3.5" aria-hidden />{t("inbox.changeAddress")}
        </button>
        {state.address && <p role="status" className="text-[12.5px] text-green">{t("inbox.newAddressReady")}</p>}
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2.5 rounded-2xl border border-amber/20 bg-amber-soft/60 p-3.5" aria-describedby={noteId}>
      <p id={noteId} className="text-[13px] text-ink-2">{t("inbox.changeWarning")}</p>
      {state.error && <p role="alert" className="text-[12.5px] text-rose">{state.error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:opacity-60" aria-busy={pending || undefined}>
          {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
          {t(pending ? "inbox.changing" : "inbox.changeAddress")}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={pending} className="inline-flex h-10 items-center rounded-full px-4 text-[13px] text-head hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green">
          {t("work.cancel")}
        </button>
      </div>
    </form>
  );
}

export type GuideStep = { text: string; copy?: string };
export type Guide = { key: string; label: string; steps: GuideStep[]; note?: string };

/** Step-by-step set-up per mail provider, as tabs (arrow keys move between them). */
export function ProviderGuide({ guides }: { guides: Guide[] }) {
  const [active, setActive] = useState(0);
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? guides.length - 1 : d ? (active + d + guides.length) % guides.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setActive(to);
    tabs.current[to]?.focus();
  };
  const g = guides[active];
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label={t("inbox.mailService")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {guides.map((x, i) => (
          <button
            key={x.key}
            ref={(el) => { tabs.current[i] = el; }}
            role="tab"
            type="button"
            id={`${base}-tab-${x.key}`}
            aria-selected={i === active}
            aria-controls={`${base}-panel`}
            tabIndex={i === active ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={onKey}
            className={cx("inline-flex min-h-10 shrink-0 items-center rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", i === active ? "border-transparent bg-cta text-white" : "border-stroke bg-white/60 text-head hover:bg-white")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${g.key}`} tabIndex={0} className="flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-green">
        <ol className="flex flex-col gap-3">
          {g.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-mint text-[12px] text-forest" aria-hidden>{i + 1}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                <p className="text-[13.5px] leading-relaxed text-ink-2">{s.text}</p>
                {s.copy && (
                  <div className="flex flex-wrap items-center gap-2">
                    <code id={`${base}-c-${g.key}-${i}`} className="min-w-0 max-w-full break-all rounded-xl border border-line bg-white/80 px-3 py-2 font-mono text-[12px] text-head">{s.copy}</code>
                    <CopyButton value={s.copy} targetId={`${base}-c-${g.key}-${i}`} className="!h-9" />
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {g.note && <p className="rounded-2xl bg-white/55 px-4 py-3 text-[12.5px] leading-relaxed text-ink-3">{g.note}</p>}
      </div>
    </div>
  );
}
