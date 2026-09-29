import { Clock, Lightbulb } from "lucide-react";
import { ButtonLink, Card, Chip, Label } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { packRedFlags, packTips, type Pack, type StoryLite } from "@/lib/engine/interview";
import { hasCyrillic } from "@/lib/engine/taxonomy";
import { getT } from "@/lib/i18n/server";
import { buildLikely, type LikelyCtx } from "./likely";
import { StarLibrary } from "./star-library";
import { DebugLine, RegenerateForm } from "./regenerate-form";

type Props = { id: string; pack: Pack | null; generatedBy?: string; generatedAt?: string; debug?: boolean; ctx: LikelyCtx; stories: StoryLite[] };

export async function QuestionsTab({ id, pack, generatedBy, generatedAt, debug, ctx, stories }: Props) {
  const t = await getT();
  const likely = buildLikely(pack, ctx, t);
  // Engine / Claude copy (red flags, tips, scaffold bullets) is stored Russian; English answer text is marked English.
  const engine = t.locale === "ru" ? undefined : "ru";
  const langOf = (s: string) => (hasCyrillic(s) ? engine : "en");
  // Claude's list is written for this user; otherwise the engine's «ты»-copy (packRedFlags / packTips, by experience).
  const redFlags = generatedBy === "claude" && pack ? pack.redFlags : packRedFlags(ctx.yearsExperience);
  const tips = packTips(ctx.yearsExperience);
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="likely-h" className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-1.5">
            <Label>{t("interviewsPage.questions.eyebrow")}</Label>
            <h2 id="likely-h" className="h-serif text-[clamp(24px,2.6vw,32px)]">{t("interviewsPage.questions.title")}</h2>
            <p className="text-[13.5px] text-ink-3">{t("interviewsPage.questions.sub")}</p>
          </div>
          <RegenerateForm id={id} aiOn={aiEnabled()} by={generatedBy} stamp={generatedAt} pendingText={t("interviewsPage.questions.pending")} className="shrink-0" />
        </div>
        {debug && <DebugLine>pack: {generatedBy ?? t("interviewsPage.questions.none")}{generatedAt ? ` · ${generatedAt}` : ""} · ai={aiEnabled() ? "on" : "off"}</DebugLine>}

        <ol className="glass divide-y divide-line overflow-hidden !p-0">
          {likely.map((l, i) => (
            <li key={l.q}>
              <details className="group" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-start gap-4 px-5 py-4 transition-colors hover:bg-white/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-green sm:px-6 [&::-webkit-details-marker]:hidden">
                  <span className="num mt-0.5 w-5 shrink-0 text-[15px] text-ink-4">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span lang="en" className="h-serif text-[19px] sm:text-[21px]">{l.q}</span>
                    <span className="text-[13px] text-ink-3">{l.why}</span>
                  </span>
                  <span aria-hidden className="mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-line text-ink-3 transition-transform group-open:rotate-45">+</span>
                </summary>
                <div className="flex flex-col gap-4 px-5 pb-5 sm:pl-[60px] sm:pr-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip><Clock className="size-3" strokeWidth={2} aria-hidden />{l.timing}</Chip>
                    {l.story && <Chip tone="teal" wrap>{t("interviewsPage.questions.story", { title: l.story.title })}</Chip>}
                  </div>
                  {l.opener && <p lang={langOf(l.opener)} className="border-l-2 border-green/50 pl-3 font-serif text-[18px] leading-snug text-head">{l.opener}</p>}
                  <ul className="flex flex-col gap-2">
                    {l.points.map((p, k) => (
                      <li key={k} className="flex gap-3 text-[14.5px] leading-relaxed text-ink-2">
                        {p.k ? <span className="label mt-[5px] w-[108px] shrink-0 break-words !text-[11px] !text-teal">{p.k}</span> : <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-teal/60" />}
                        <span lang={langOf(p.v)}>{p.v}</span>
                      </li>
                    ))}
                  </ul>
                  {l.story?.metric && <p className="text-[13px] text-ink-3">{t("interviewsPage.questions.keyNumber")} <span className="num text-green">{l.story.metric}</span></p>}
                  {((l.tips && l.tips.length > 0) || l.briefQuote) && (
                    <aside aria-label={t("interviewsPage.questions.tipsAria")} className="flex gap-2.5 rounded-2xl border border-amber/25 bg-amber-soft/60 px-4 py-3">
                      <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.7} aria-hidden />
                      <ul className="flex flex-col gap-1 text-[13px] leading-relaxed text-ink-2">
                        {l.tips?.map((tip) => <li key={tip}><span className="font-medium text-head">{t("interviewsPage.questions.tip")} </span>{tip}</li>)}
                        {l.briefQuote && <li><span className="font-medium text-head">{t("interviewsPage.questions.fromBrief")} </span><span lang={engine}>{l.briefQuote}</span></li>}
                      </ul>
                    </aside>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ol>
        <div>
          <ButtonLink href={`/app/interviews/${id}?tab=mock`} scroll={false} variant="primary" size="sm" className="!h-10">{t("interviewsPage.questions.rehearse")}</ButtonLink>
        </div>
      </section>

      <StarLibrary stories={stories} />

      {pack && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Label className="mb-3">{t("interviewsPage.questions.askLabel")}</Label>
            <ol className="flex flex-col gap-2.5">
              {pack.questionsToAsk.slice(0, 6).map((q, i) => (
                <li key={q} lang={langOf(q)} className="flex gap-3 text-[14.5px] text-ink-2"><span className="num w-4 shrink-0 text-ink-4">{i + 1}</span>{q}</li>
              ))}
            </ol>
          </Card>
          {(redFlags.length > 0 || tips.length > 0) && (
            <Card className="flex flex-col gap-5">
              {tips.length > 0 && (
                <div>
                  <Label className="mb-3">{t("interviewsPage.questions.expect")}</Label>
                  <ul className="flex flex-col gap-2">
                    {tips.map((tip) => <li key={tip} lang={engine} className="flex gap-2.5 text-[14px] text-ink-2"><Lightbulb className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />{tip}</li>)}
                  </ul>
                </div>
              )}
              {redFlags.length > 0 && (
                <div>
                  <Label className="mb-3">{t("interviewsPage.questions.avoid")}</Label>
                  <ul className="flex flex-col gap-2">
                    {redFlags.map((r) => <li key={r} lang={langOf(r)} className="flex gap-2.5 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />{r}</li>)}
                  </ul>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
