"use client";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { ButtonLink, Label, cx } from "@/components/ui";
import type { StoryLite } from "@/lib/engine/interview";
import { STORY_TAG_RU } from "@/lib/ru";
import { useT } from "@/lib/i18n/client";

/** Story tag labels: the same map as Profile («Истории») — lib STORY_TAG_RU. */
export const THEME_LABEL: Record<string, string> = STORY_TAG_RU;
type TagKey = keyof typeof STORY_TAG_RU;

const STAR = [
  { k: "situation", letter: "S" },
  { k: "task", letter: "T" },
  { k: "action", letter: "A" },
  { k: "result", letter: "R" },
] as const;

/** STAR-истории: library, filterable by theme. */
export function StarLibrary({ stories }: { stories: StoryLite[] }) {
  const t = useT();
  const uid = useId();
  const tagLabel = (tag: string) => (tag in STORY_TAG_RU ? t(`interviewsPage.star.tags.${tag as TagKey}`) : tag);
  const themes = Object.keys(THEME_LABEL).filter((x) => stories.some((s) => s.tags.includes(x)));
  const [theme, setTheme] = useState<string>("all");
  const shown = theme === "all" ? stories : stories.filter((s) => s.tags.includes(theme));

  return (
    <section aria-labelledby={`${uid}-h`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Label>{t("interviewsPage.star.label")}</Label>
          <h2 id={`${uid}-h`} className="h-serif text-[clamp(24px,2.6vw,32px)]">{t("interviewsPage.star.title")}</h2>
        </div>
        <ButtonLink href="/app/profile#stories" size="sm" variant="glass" className="!h-10 self-start"><Plus className="size-3.5" strokeWidth={1.8} aria-hidden />{t("interviewsPage.star.add")}</ButtonLink>
      </div>

      {stories.length === 0 ? (
        <p className="glass px-5 py-6 text-[14px] text-ink-3">{t("interviewsPage.star.empty")}</p>
      ) : (
        <>
          <div role="group" aria-label={t("interviewsPage.star.filterAria")} className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {[["all", t("interviewsPage.star.all", { n: stories.length })] as const, ...themes.map((x) => [x, tagLabel(x)] as const)].map(([k, l]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTheme(k)}
                aria-pressed={theme === k}
                className={cx(
                  "h-10 shrink-0 rounded-full border px-3.5 text-[13px] transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
                  theme === k ? "border-transparent bg-cta text-white" : "border-line bg-white/60 text-ink-2 hover:bg-white",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <ul className="grid gap-4 lg:grid-cols-2" aria-live="polite">
            {shown.map((s) => (
              <li key={s.id} className="glass flex flex-col gap-4 p-5 sm:p-6">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1.5">
                    {s.tags.filter((x) => THEME_LABEL[x]).map((x) => (
                      <span key={x} className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{tagLabel(x)}</span>
                    ))}
                  </div>
                  <h3 className="h-serif text-[20px]">{s.title}</h3>
                  {s.metric && <span className="num w-fit rounded-full bg-green-soft px-2.5 py-0.5 text-[13px] text-green">{s.metric}</span>}
                </div>
                <div role="group" aria-label={t("interviewsPage.star.starAria")}>
                <dl className="flex flex-col gap-2.5">
                  {STAR.map(({ k, letter }) => {
                    const l = t(`interviewsPage.star.${k}`);
                    return (
                    <div key={k} className="grid grid-cols-[18px_1fr] gap-3">
                      <dt className="num text-[15px] leading-6 text-green" title={l}><span aria-hidden>{letter}</span><span className="sr-only">{l}</span></dt>
                      <dd className="text-[14px] leading-relaxed text-ink-2">{s[k]}</dd>
                    </div>
                    );
                  })}
                </dl>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
