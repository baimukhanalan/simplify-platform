"use client";
import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { ButtonLink, Label, cx } from "@/components/ui";
import type { StoryLite } from "@/lib/engine/interview";
import { STORY_TAG_RU } from "@/lib/ru";

/** Story tag labels: the same map as Profile («Истории») — lib STORY_TAG_RU. */
export const THEME_LABEL: Record<string, string> = STORY_TAG_RU;

const STAR = [
  { k: "situation", letter: "S", l: "Ситуация" },
  { k: "task", letter: "T", l: "Задача" },
  { k: "action", letter: "A", l: "Действие" },
  { k: "result", letter: "R", l: "Результат" },
] as const;

/** STAR-истории: library, filterable by theme. */
export function StarLibrary({ stories }: { stories: StoryLite[] }) {
  const uid = useId();
  const themes = Object.keys(THEME_LABEL).filter((t) => stories.some((s) => s.tags.includes(t)));
  const [theme, setTheme] = useState<string>("all");
  const shown = theme === "all" ? stories : stories.filter((s) => s.tags.includes(theme));

  return (
    <section aria-labelledby={`${uid}-h`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Label>STAR-истории</Label>
          <h2 id={`${uid}-h`} className="h-serif text-[clamp(24px,2.6vw,32px)]">Библиотека твоих историй</h2>
        </div>
        <ButtonLink href="/app/profile#stories" size="sm" variant="glass" className="!h-10 self-start"><Plus className="size-3.5" strokeWidth={1.8} aria-hidden />Добавить историю</ButtonLink>
      </div>

      {stories.length === 0 ? (
        <p className="glass px-5 py-6 text-[14px] text-ink-3">Историй пока нет. Добавь 3–4 в Career Profile: конфликт, ошибка, лидерство и проект с цифрой — их хватит на большинство поведенческих вопросов.</p>
      ) : (
        <>
          <div role="group" aria-label="Фильтр по теме" className="scroll-thin -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {[["all", `Все · ${stories.length}`] as const, ...themes.map((t) => [t, THEME_LABEL[t]] as const)].map(([k, l]) => (
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
                    {s.tags.filter((t) => THEME_LABEL[t]).map((t) => (
                      <span key={t} className="font-mono text-[11px] uppercase tracking-[.08em] text-teal">{THEME_LABEL[t]}</span>
                    ))}
                  </div>
                  <h3 className="h-serif text-[20px]">{s.title}</h3>
                  {s.metric && <span className="num w-fit rounded-full bg-green-soft px-2.5 py-0.5 text-[13px] text-green">{s.metric}</span>}
                </div>
                <div role="group" aria-label="STAR: ситуация, задача, действие, результат">
                <dl className="flex flex-col gap-2.5">
                  {STAR.map(({ k, letter, l }) => (
                    <div key={k} className="grid grid-cols-[18px_1fr] gap-3">
                      <dt className="num text-[15px] leading-6 text-green" title={l}><span aria-hidden>{letter}</span><span className="sr-only">{l}</span></dt>
                      <dd className="text-[14px] leading-relaxed text-ink-2">{s[k]}</dd>
                    </div>
                  ))}
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
