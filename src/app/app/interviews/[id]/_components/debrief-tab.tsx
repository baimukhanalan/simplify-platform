import { ArrowRight, CalendarClock, CircleDollarSign, Mail, Route } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink, Card, Chip, Field, Label, Ring } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createNextRound, type Debrief } from "@/lib/actions/interview";
import { IV_STATUS_TONE, ROUNDS, nextRound, type Round } from "@/lib/rounds";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { CopyButton } from "../../_components/copy-button";
import { DebriefForm } from "./debrief-form";
import { AlmatyDateTimeInput } from "./almaty-datetime";

type Props = { iv: { id: string; round: string; status: string; company: string; upcoming: boolean }; debrief: Partial<Debrief>; debug?: boolean };

const verdictKey = (p: number): "verdictStrong" | "verdictGood" | "verdictMid" | "verdictHard" => (p >= 80 ? "verdictStrong" : p >= 65 ? "verdictGood" : p >= 50 ? "verdictMid" : "verdictHard");
const STATUSES = ["upcoming", "done", "passed", "failed", "cancelled"] as const;

export async function DebriefTab({ iv, debrief, debug }: Props) {
  const t = await getT();
  // The debrief itself is stored content (Russian); marked lang="ru" outside the Russian interface.
  const engine = t.locale === "ru" ? undefined : "ru";
  const roundName = (r: string) => ((ROUNDS as readonly string[]).includes(r) ? t(`interviewPractice.rounds.${r as Round}`) : r);
  const statusName = (st: string) => ((STATUSES as readonly string[]).includes(st) ? t(`interviewPractice.status.${st as (typeof STATUSES)[number]}`) : st);
  const form = (el: ReactNode) => <I18nScope ns={["interviewPractice", "interviewsPage"]}>{el}</I18nScope>;
  const has = Boolean(debrief.savedAt || debrief.questions?.length);
  const next = nextRound(iv.round);

  // Before the call: the debrief is secondary — a short note with the form collapsed.
  if (!has && iv.upcoming)
    return (
      <Card className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="flex items-start gap-3">
          <CalendarClock className="mt-0.5 size-5 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
          <div className="flex flex-col gap-1">
            <Label>{iv.round === "assessment" ? t("interviewPractice.debrief.afterAssessment") : t("interviewPractice.debrief.afterCall")}</Label>
            <p className="text-[14.5px] text-ink-2">
              {iv.round === "assessment"
                ? t("interviewPractice.debrief.aheadAssessment", { company: iv.company })
                : t("interviewPractice.debrief.aheadCall", { company: iv.company })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/interviews/${iv.id}`} size="sm" scroll={false} className="!h-10">{t("interviewPractice.debrief.toPrep")}<ArrowRight className="size-3.5" strokeWidth={1.7} aria-hidden /></ButtonLink>
        </div>
        <details className="group border-t border-line pt-4">
          <summary className="inline-flex min-h-10 w-fit cursor-pointer items-center rounded text-[13.5px] text-teal underline-offset-4 hover:text-head hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">{iv.round === "assessment" ? t("interviewPractice.debrief.pastAssessment") : t("interviewPractice.debrief.pastCall")}</summary>
          <div className="mt-4">{form(<DebriefForm id={iv.id} />)}</div>
        </details>
      </Card>
    );

  if (!has)
    return (
      <Card strong className="mx-auto flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label>{t("interviewPractice.debrief.label")}</Label>
          <h2 className="h-serif text-[clamp(30px,3.6vw,44px)]">{t("interviewPractice.debrief.title")}</h2>
          <p className="max-w-xl text-[14.5px] text-ink-2">{t("interviewPractice.debrief.intro")}</p>
        </div>
        {form(<DebriefForm id={iv.id} />)}
      </Card>
    );

  const perf = debrief.performance;
  const structured = typeof perf === "number";
  const answerBy = debrief.answerBy ? t.date(debrief.answerBy, "dayMonth") : null;

  return (
    <div className="flex flex-col gap-5">
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          {structured ? <Ring value={perf} size={128} stroke={9} label={t("interviewPractice.outOf100")} className="shrink-0" /> : null}
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>{t("interviewPractice.debrief.labelRound", { round: roundName(iv.round) })}</Label>
              <Chip tone={IV_STATUS_TONE[iv.status] ?? "neutral"}>{statusName(iv.status)}</Chip>
              {debrief.structuredBy === "claude" && <Chip tone="green">Claude</Chip>}
              {debug && <Chip>by: {debrief.structuredBy ?? "—"}</Chip>}
            </div>
            <h2 className="h-serif text-[clamp(28px,3.4vw,42px)]">{structured ? t.rich("interviewPractice.debrief.score", { score: perf }, { n: (c) => <span className="num">{c}</span> }) : t("interviewPractice.debrief.saved")}</h2>
            <p className="text-[15px] text-ink-2">{structured ? t(`interviewPractice.debrief.${verdictKey(perf)}`) : debrief.selfRating ? t("interviewPractice.debrief.selfRating", { n: debrief.selfRating }) : ""}</p>
          </div>
        </div>

        {structured && (
          <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
            {[
              { k: t("interviewPractice.debrief.strong"), items: debrief.strong ?? [], dot: "bg-green", empty: t("interviewPractice.debrief.emptyStrong") },
              { k: t("interviewPractice.debrief.weak"), items: debrief.weak ?? [], dot: "bg-amber", empty: t("interviewPractice.debrief.emptyWeak") },
              { k: t("interviewPractice.debrief.prep"), items: debrief.nextPrep ?? [], dot: "bg-teal", empty: "—" },
            ].map((col) => (
              <div key={col.k} className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
                <Label>{col.k}</Label>
                {col.items.length ? (
                  <ul className="flex flex-col gap-2">
                    {col.items.map((x) => <li key={x} lang={engine} className="flex gap-2.5 text-[14px] leading-relaxed text-ink-2"><span aria-hidden className={`mt-2 size-1.5 shrink-0 rounded-full ${col.dot}`} />{x}</li>)}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-ink-3">{col.empty}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <dl className="grid gap-4 sm:grid-cols-3">
          <div className="flex gap-3">
            <Route className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[11px]">{t("interviewPractice.debrief.nextStage")}</dt><dd className="mt-1 text-[14px] text-head">{debrief.nextSteps ? <span lang={engine}>{debrief.nextSteps}</span> : t("interviewPractice.debrief.notNamed")}</dd></div>
          </div>
          <div className="flex gap-3">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[11px]">{t("interviewPractice.debrief.answerBy")}</dt><dd className="mt-1 text-[14px] text-head">{answerBy ?? t("interviewPractice.debrief.noDeadline")}</dd></div>
          </div>
          <div className="flex gap-3">
            <CircleDollarSign className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <div><dt className="label !text-[11px]">{t("interviewPractice.debrief.salary")}</dt><dd className="mt-1 text-[14px] text-head">{debrief.salaryDiscussed ? (debrief.salaryNote ? <span lang={engine}>{debrief.salaryNote}</span> : t("interviewPractice.debrief.discussed")) : t("interviewPractice.debrief.notDiscussed")}</dd></div>
          </div>
        </dl>

        {debrief.questions && debrief.questions.length > 0 && (
          <div className="border-t border-line pt-5">
            <Label className="mb-2.5">{t("interviewPractice.debrief.questions")}</Label>
            <ul className="flex flex-wrap gap-1.5">
              {debrief.questions.map((q) => <li key={q} lang={engine} className="rounded-full border border-line bg-white/65 px-3 py-1 text-[13px] text-ink-2">{q}</li>)}
            </ul>
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4">
          <Label>{t("interviewPractice.debrief.whatNext")}</Label>
          {debrief.nextSuggestion && <p lang={engine} className="text-[15px] leading-relaxed text-ink-2">{debrief.nextSuggestion}</p>}
          {iv.status === "passed" && next && (
            <form action={createNextRound} className="flex flex-col gap-3 rounded-2xl border border-green/20 bg-green-soft/50 p-4">
              <input type="hidden" name="id" value={iv.id} />
              <Field label={t("interviewPractice.debrief.roundDate", { round: roundName(next).toLowerCase() })} hint={t("interviewPractice.debrief.roundDateHint")}>
                <AlmatyDateTimeInput name="scheduledAt" className="field" />
              </Field>
              <div><SubmitButton pendingText={t("interviewPractice.debrief.creatingRoom")}>{t("interviewPractice.debrief.createRound", { round: roundName(next).toLowerCase() })}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></SubmitButton></div>
            </form>
          )}
          {iv.status === "passed" && !next && iv.round === "final" && (
            <ButtonLink href="/app/offers" className="self-start">{t("interviewPractice.debrief.openOfferDesk")}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></ButtonLink>
          )}
          {iv.status !== "passed" && debrief.nextPrep && debrief.nextPrep.length > 0 && (
            <ButtonLink href={`/app/interviews/${iv.id}?tab=mock`} variant="glass" size="sm" className="!h-10 self-start">{t("interviewPractice.debrief.practiceWeak")}</ButtonLink>
          )}
        </Card>

        {debrief.followUpEmail && (
          <Card className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><Mail className="size-4 text-teal" strokeWidth={1.7} aria-hidden /><Label>{t("interviewPractice.debrief.email")}</Label></span>
              <CopyButton text={debrief.followUpEmail} label={t("interviewPractice.debrief.copy")} />
            </div>
            {/* The email is sent to the employer: it keeps its own language (English). */}
            <pre tabIndex={0} lang="en" aria-label={t("interviewPractice.debrief.emailAria")} className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13.5px] leading-relaxed text-ink-2 focus-visible:outline-2 focus-visible:outline-green">{debrief.followUpEmail}</pre>
            <p className="text-[12px] text-ink-3">{t("interviewPractice.debrief.emailHint")}</p>
          </Card>
        )}
      </div>

      <details className="glass group p-5 sm:p-6">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-[14.5px] font-medium text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
          {t("interviewPractice.debrief.retell")}
          <span aria-hidden className="text-ink-4 transition-transform group-open:rotate-45">+</span>
        </summary>
        <div className="mt-5">
          {form(<DebriefForm id={iv.id} initialTranscript={debrief.transcript ?? (debrief.questions ?? []).join(". ")} initialOutcome={debrief.outcome ?? "done"} />)}
        </div>
      </details>
    </div>
  );
}
