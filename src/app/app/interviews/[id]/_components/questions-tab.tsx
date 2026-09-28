import { Clock, Lightbulb } from "lucide-react";
import { ButtonLink, Card, Chip, Label } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import type { Pack, StoryLite } from "@/lib/engine/interview";
import { buildLikely, type LikelyCtx } from "./likely";
import { StarLibrary } from "./star-library";
import { DebugLine, RegenerateForm } from "./regenerate-form";

type Props = { id: string; pack: Pack | null; generatedBy?: string; generatedAt?: string; debug?: boolean; ctx: LikelyCtx; stories: StoryLite[] };

export function QuestionsTab({ id, pack, generatedBy, generatedAt, debug, ctx, stories }: Props) {
  const likely = buildLikely(pack, ctx);
  // Claude's list is written for this user; the engine fallback is replaced with «ты»-copy.
  const redFlags = generatedBy === "claude" && pack
    ? pack.redFlags
    : [ctx.yearsExperience < 2 ? "Не преувеличивай стаж — рассказывай о глубине задач." : "Жди вопросов о масштабе задач.", "Не называй цифру зарплаты первым без вилки."];
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="likely-h" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Label>Скорее всего спросят</Label>
            <h2 id="likely-h" className="h-serif text-[clamp(24px,2.6vw,32px)]">Вопросы, которые почти наверняка зададут</h2>
            <p className="text-[13.5px] text-ink-3">Ответы на английском собраны из твоего опыта и историй. Это опора, а не текст для заучивания.</p>
          </div>
          <RegenerateForm id={id} aiOn={aiEnabled()} by={generatedBy} stamp={generatedAt} pendingText="Claude готовит ответы…" className="shrink-0" />
        </div>
        {debug && <DebugLine>pack: {generatedBy ?? "нет"}{generatedAt ? ` · ${generatedAt}` : ""} · ai={aiEnabled() ? "on" : "off"}</DebugLine>}

        <ol className="glass divide-y divide-line overflow-hidden !p-0">
          {likely.map((l, i) => (
            <li key={l.q}>
              <details className="group" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="num mt-0.5 w-5 shrink-0 text-[15px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="h-serif text-[19px] sm:text-[21px]">{l.q}</span>
                    <span className="text-[13px] text-ink-3">{l.why}</span>
                  </span>
                  <span aria-hidden className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-line text-ink-3 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="flex flex-col gap-4 px-5 pb-5 sm:pl-[60px] sm:pr-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip><Clock className="size-3" strokeWidth={2} aria-hidden />{l.timing}</Chip>
                    {l.story && <Chip tone="teal" wrap>История: {l.story.title}</Chip>}
                  </div>
                  {l.opener && <p className="border-l-2 border-green/50 pl-3 font-serif text-[18px] leading-snug text-head">{l.opener}</p>}
                  <ul className="flex flex-col gap-2">
                    {l.points.map((p, k) => (
                      <li key={k} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
                        {p.k ? <span className="label mt-[5px] w-[108px] shrink-0 break-words !text-[11px] !text-teal">{p.k}</span> : <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-teal/60" />}
                        <span>{p.v}</span>
                      </li>
                    ))}
                  </ul>
                  {l.story?.metric && <p className="text-[13px] text-ink-3">Ключевая цифра: <span className="num text-green">{l.story.metric}</span></p>}
                  {l.tips && l.tips.length > 0 && (
                    <aside aria-label="Советы" className="flex gap-2.5 rounded-2xl border border-amber/25 bg-amber-soft/60 px-4 py-3">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.7} aria-hidden />
                      <ul className="flex flex-col gap-1 text-[13px] leading-relaxed text-ink-2">
                        {l.tips.map((t) => <li key={t}><span className="font-medium text-head">Совет: </span>{t}</li>)}
                      </ul>
                    </aside>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
        <div>
          <ButtonLink href={`/app/interviews/${id}?tab=mock`} scroll={false} variant="primary" size="sm" className="!h-10">Отрепетировать вслух в пробном интервью</ButtonLink>
        </div>
      </section>

      <StarLibrary stories={stories} />

      {pack && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Label className="mb-3">Твои вопросы интервьюеру</Label>
            <ol className="flex flex-col gap-2.5">
              {pack.questionsToAsk.slice(0, 6).map((q, i) => (
                <li key={q} className="flex gap-3 text-[14.5px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>{q}</li>
              ))}
            </ol>
          </Card>
          {redFlags.length > 0 && (
            <Card>
              <Label className="mb-3">Чего избегать</Label>
              <ul className="flex flex-col gap-2">
                {redFlags.map((r) => <li key={r} className="flex gap-2.5 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />{r}</li>)}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
