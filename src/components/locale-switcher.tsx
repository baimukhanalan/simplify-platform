"use client";
import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import { setLocale } from "@/lib/actions/locale";
import { LOCALES, LOCALE_NATIVE, LOCALE_SHORT, type Locale } from "@/lib/i18n/config";
import { useLocale, useT } from "@/lib/i18n/client";

/**
 * RU · ҚАЗ · EN. Saves the choice (cookie, and User.locale when signed in) and re-renders the page in place.
 * The pressed language switches instantly (optimistic); on failure it snaps back and says so.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const current = useLocale();
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic<Locale, Locale>(current, (_, next) => next);
  const [failed, setFailed] = useState(false);

  const choose = (l: Locale) => {
    if (l === shown || pending) return;
    setFailed(false);
    start(async () => {
      setShown(l);
      try {
        const res = await setLocale(l);
        if (!res.ok) throw new Error("locale");
        router.refresh();
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <div className={cx("flex flex-col items-center gap-0.5", className)}>
      <div role="group" aria-label={t("switcher.label")} aria-busy={pending || undefined} className="inline-flex items-center text-[12px] tracking-[.06em]">
        {LOCALES.map((l, i) => (
          <span key={l} className="inline-flex items-center">
            {i > 0 && <span aria-hidden className="px-0.5 text-ink-4">·</span>}
            <button
              type="button"
              lang={l}
              aria-pressed={shown === l}
              aria-label={LOCALE_NATIVE[l]}
              title={LOCALE_NATIVE[l]}
              onClick={() => choose(l)}
              // The brand mono has no Kazakh letters (Қ would fall back mid-word): one Cyrillic-complete mono for all three.
              style={{ fontFamily: "var(--font-mono-cyr), ui-monospace, monospace" }}
              className={cx(
                "inline-flex min-h-10 min-w-10 items-center justify-center rounded-full px-2 uppercase transition-colors focus-visible:outline-2 focus-visible:outline-green",
                shown === l ? "font-medium text-head" : "text-ink-3 hover:text-head",
                pending && shown === l && "animate-pulse",
              )}
            >
              {LOCALE_SHORT[l]}
            </button>
          </span>
        ))}
      </div>
      {failed && <span role="alert" className="text-[11.5px] text-rose">{t("switcher.failed")}</span>}
    </div>
  );
}
