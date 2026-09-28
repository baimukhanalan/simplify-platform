"use client";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "@/components/ui";

export type StyleTab = { key: string; label: string; hint: string; panel: ReactNode };

/**
 * Segmented control for the negotiation styles (WAI-ARIA tabs, manual activation not needed:
 * arrows move + select, Home/End jump). All panels are server-rendered; inactive ones are `hidden`.
 * The selection is mirrored into ?level= so a reload / shared link keeps the chosen style.
 */
export function NegotiationTabs({ tabs, initial }: { tabs: StyleTab[]; initial: string }) {
  const [active, setActive] = useState(tabs.some((t) => t.key === initial) ? initial : tabs[0].key);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const select = (i: number, focus = false) => {
    const t = tabs[(i + tabs.length) % tabs.length];
    setActive(t.key);
    if (focus) refs.current[(i + tabs.length) % tabs.length]?.focus();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("level", t.key);
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* URL sync is a convenience only */
    }
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(next, true);
  };

  return (
    <div>
      <div role="tablist" aria-label="Стиль переговоров" className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-white/55 p-1 sm:inline-grid sm:rounded-full">
        {tabs.map((t, i) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => { refs.current[i] = el; }}
              id={`${base}-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`${base}-panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => select(i)}
              onKeyDown={(e) => onKey(e, i)}
              className={cx(
                "flex min-h-11 flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green sm:rounded-full sm:px-5",
                on ? "bg-cta text-white shadow-(--shadow-cta)" : "text-ink-2 hover:bg-white/80 hover:text-head",
              )}
            >
              <span className="text-[12.5px] font-medium leading-tight sm:text-[13.5px]">{t.label}</span>
              <span className={cx("font-mono text-[11px] uppercase tracking-[.06em] leading-tight", on ? "text-white/60" : "text-ink-4")}>{t.hint}</span>
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.key}
          id={`${base}-panel-${t.key}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${t.key}`}
          hidden={t.key !== active}
          tabIndex={0}
          className="mt-5 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}
