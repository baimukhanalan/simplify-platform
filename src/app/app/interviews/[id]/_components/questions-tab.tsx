import { Clock, Sparkles } from "lucide-react";
import { ButtonLink, Card, Chip, Label } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { regeneratePack } from "@/lib/actions/interview";
import { aiEnabled } from "@/lib/ai";
import type { Pack, StoryLite } from "@/lib/engine/interview";
import { buildLikely, type LikelyCtx } from "./likely";
import { StarLibrary } from "./star-library";

type Props = { id: string; pack: Pack | null; generatedBy?: string; ctx: LikelyCtx; stories: StoryLite[] };

export function QuestionsTab({ id, pack, generatedBy, ctx, stories }: Props) {
  const likely = buildLikely(pack, ctx);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="likely-h" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Label>Most likely</Label>
            <h2 id="likely-h" className="h-serif text-[clamp(24px,2.6vw,32px)]">Вопросы, которые почти наверняка зададут</h2>
            <p className="text-[13.5px] text-ink-3">Ответы собраны из вашего опыта и историй. Это опора, а не текст для заучивания.</p>
          </div>
          <form action={regeneratePack} className="shrink-0">
            <input type="hidden" name="id" value={id} />
            <SubmitButton size="sm" variant="glass" pendingText={aiEnabled() ? "Claude готовит ответы…" : "Обновляем…"}>
              <Sparkles className="size-3.5" strokeWidth={1.7} aria-hidden />Обновить с AI{generatedBy === "claude" ? " · Claude" : ""}
            </SubmitButton>
          </form>
        </div>

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
                    {l.story && <Chip tone="teal">История: {l.story.title}</Chip>}
                  </div>
                  {l.opener && <p className="border-l-2 border-green/50 pl-3 font-serif text-[18px] leading-snug text-head">{l.opener}</p>}
                  <ul className="flex flex-col gap-2">
                    {l.points.map((p, k) => (
                      <li key={k} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
                        {p.k ? <span className="label mt-[5px] w-[82px] shrink-0 !text-[10px] !text-teal">{p.k}</span> : <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-teal/60" />}
                        <span>{p.v}</span>
                      </li>
                    ))}
                  </ul>
                  {l.story?.metric && <p className="text-[13px] text-ink-3">Ключевая цифра: <span className="num text-green">{l.story.metric}</span></p>}
                </div>
              </details>
            </li>
          ))}
        </ol>
        <div>
          <ButtonLink href={`/app/interviews/${id}?tab=mock`} scroll={false} variant="primary" size="sm">Отрепетировать вслух в Mock Interview</ButtonLink>
        </div>
      </section>

      <StarLibrary stories={stories} />

      {pack && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Label className="mb-3">Ваши вопросы интервьюеру</Label>
            <ol className="flex flex-col gap-2.5">
              {pack.questionsToAsk.slice(0, 6).map((q, i) => (
                <li key={q} className="flex gap-3 text-[14.5px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>{q}</li>
              ))}
            </ol>
          </Card>
          {pack.redFlags.length > 0 && (
            <Card>
              <Label className="mb-3">Чего избегать</Label>
              <ul className="flex flex-col gap-2">
                {pack.redFlags.map((r) => <li key={r} className="flex gap-2.5 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />{r}</li>)}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
