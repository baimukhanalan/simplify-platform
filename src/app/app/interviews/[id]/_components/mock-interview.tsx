"use client";
import { useId, useRef, useState, useTransition } from "react";
import { Mic, MicOff, RotateCcw, ArrowRight, Check, SkipForward, Play } from "lucide-react";
import { Button, Card, Chip, Label, Progress, Ring, cx } from "@/components/ui";
import { scoreAnswer, summarizeMock, type MockSummary } from "@/lib/engine/interview";
import { PERSONAS, PERSONA_KEYS, type PersonaKey } from "@/lib/rounds";
import { useLocale, useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/translator";
import { saveMockSession } from "@/lib/actions/interview";
import { SPEECH_LANG_KEY, speechLangs, useSpeech, useSpeechSupported } from "../../_components/use-speech";
import { MOCK_SETS, missingPoints, suggestion, type MockCtx } from "./mock-questions";

type Score = ReturnType<typeof scoreAnswer>;
type Turn = { question: string; answer: string; score: Score | null };
type Current = { score: Score; missing: string[]; better: ReturnType<typeof suggestion> };
/** The session summary — the same shape and computation the server stores (summarizeMock). */
export type MockFeedback = MockSummary;

const DIMS = [
  { key: "content", label: "dimContent" },
  { key: "structure", label: "dimStructure" },
  { key: "clarity", label: "dimClarity" },
  { key: "length", label: "dimLength" },
  { key: "confidence", label: "dimConfidence" },
] as const satisfies readonly { key: keyof MockFeedback["dims"]; label: string }[];
const STAR_KEY = { s: "starS", t: "starT", a: "starA", r: "starR" } as const;
const INTRO_CHIP = { now: "cueNow", past: "cuePast", future: "cueFuture" } as const;
const personaName = (t: T, k: string) => (PERSONA_KEYS.includes(k) ? t(`interviewPractice.personas.${k as PersonaKey}.label`) : k);

/**
 * The end-of-session summary with the server's own function and inputs (summarizeMock on the transcript, the vacancy's
 * terms), so the result shown here is exactly what gets saved.
 */
const summarize = (turns: Turn[], skills: string[], jdTerms: string[]): MockFeedback =>
  summarizeMock(turns.map((t) => ({ question: t.question, answer: t.answer })), { skills, jdTerms });

export function MockInterview({ interviewId, defaultPersona, ctx, jdTerms, assessment = false }: { interviewId: string; defaultPersona: string; ctx: MockCtx; jdTerms: string[]; assessment?: boolean }) {
  const [phase, setPhase] = useState<"select" | "run" | "done">("select");
  const [persona, setPersona] = useState(defaultPersona);
  const [idx, setIdx] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraftState] = useState("");
  // Mirror of the draft so async handlers read the text that arrived after speech.stop() resolved.
  const draftRef = useRef("");
  const setDraft = (v: string | ((d: string) => string)) => setDraftState((d) => (draftRef.current = typeof v === "function" ? v(d) : v));
  // True once any part of the current answer came from the microphone: scoreAnswer then treats it as speech
  // (transcripts carry no punctuation or paragraphing to judge).
  const spokenRef = useRef(false);
  const [interim, setInterim] = useState("");
  const [current, setCurrent] = useState<Current | null>(null);
  const t = useT();
  const locale = useLocale();
  // Stored/engine coaching text (tips, strategy, plan) stays Russian: lang="ru" outside the Russian interface.
  const engine = locale === "ru" ? undefined : "ru";
  // Answers are spoken in the interview language (English) by default.
  const [lang, setLang] = useState("en-US");
  const [saved, setSaved] = useState<"idle" | "ok" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const supported = useSpeechSupported();
  const speech = useSpeech({
    lang,
    onFinal: (t) => {
      spokenRef.current = true;
      setDraft((d) => (d ? `${d.trimEnd()} ${t}` : t));
    },
    onInterim: setInterim,
  });

  const questions = MOCK_SETS[persona] ?? [];
  const question = questions[idx];

  const start = () => {
    setPhase("run");
    setIdx(0);
    setTurns([]);
    setDraft("");
    spokenRef.current = false;
    setCurrent(null);
    setSaved("idle");
    requestAnimationFrame(() => answerRef.current?.focus());
  };

  const evaluate = async () => {
    if (speech.listening) await speech.stop();
    const text = draftRef.current.trim();
    if (!text) return;
    const score = scoreAnswer(question, text, { skills: ctx.skills, jdTerms: jdTerms.length ? jdTerms : ctx.skills, spoken: spokenRef.current });
    setCurrent({ score, missing: missingPoints(question, text, score, ctx, t), better: suggestion(question, ctx, jdTerms, t) });
  };

  const advance = async (skip = false) => {
    if (speech.listening) await speech.stop();
    const nextTurns = [...turns, { question, answer: skip ? "" : draftRef.current.trim(), score: skip ? null : current?.score ?? null }];
    setTurns(nextTurns);
    setDraft("");
    spokenRef.current = false;
    setInterim("");
    setCurrent(null);
    if (idx + 1 >= questions.length) {
      setPhase("done");
      save(nextTurns);
    } else {
      setIdx(idx + 1);
      requestAnimationFrame(() => answerRef.current?.focus());
    }
  };

  const save = (all: Turn[]) => {
    const feedback = summarize(all, ctx.skills, jdTerms);
    if (!feedback.answered) return;
    startTransition(async () => {
      try {
        const r = await saveMockSession({
          interviewId,
          persona,
          // «(пропущено)» is the stored marker of a skipped answer (summarizeMock skips it; the history shows it translated).
          transcript: all.flatMap((x) => [{ role: "interviewer" as const, text: x.question }, { role: "candidate" as const, text: x.answer || "(пропущено)" }]),
          feedback,
        });
        setSaved(r.ok ? "ok" : "error");
      } catch {
        setSaved("error");
      }
    });
  };

  if (phase === "select")
    return (
      <Card strong>
        <Label className="mb-2">{assessment ? t("interviewPractice.mock.training") : t("interviewPractice.mock.label")}</Label>
        <h2 className="h-serif mb-2 text-[clamp(24px,2.6vw,32px)]">{t("interviewPractice.mock.who")}</h2>
        <p className="mb-5 max-w-xl text-[14px] text-ink-3">{t("interviewPractice.mock.intro")}</p>
        <fieldset>
          <legend className="sr-only">{t("interviewPractice.mock.personaLegend")}</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PERSONAS.map((p) => (
              <label key={p.key} className={cx("flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green", persona === p.key ? "border-green/40 bg-green-soft/70" : "border-line bg-white/60 hover:bg-white")}>
                <input type="radio" name={`${ids}-persona`} value={p.key} checked={persona === p.key} onChange={() => setPersona(p.key)} className="sr-only" />
                <span className="flex items-center justify-between gap-2 text-[15px] font-medium text-head">{t(`interviewPractice.personas.${p.key}.label`)}{persona === p.key && <Check className="size-4 shrink-0 text-green" strokeWidth={2} aria-hidden />}</span>
                <span className="text-[12.5px] text-ink-3">{t(`interviewPractice.personas.${p.key}.sub`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button className="mt-6" size="lg" onClick={start}><Play className="size-4" strokeWidth={1.7} aria-hidden />{assessment ? t("interviewPractice.mock.startTraining") : t("interviewPractice.mock.start")}</Button>
      </Card>
    );

  if (phase === "done") {
    const fb = summarize(turns, ctx.skills, jdTerms);
    return (
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Ring value={fb.overall} size={112} label={t("interviewPractice.outOf100")} />
          <div className="flex flex-col gap-1.5">
            <Label>{t("interviewPractice.mock.summary", { persona: personaName(t, persona) })}</Label>
            <h2 className="h-serif text-[28px]">{fb.overall >= 75 ? (assessment ? t("interviewPractice.mock.readyAssessment") : t("interviewPractice.mock.readyCall")) : fb.overall >= 55 ? t("interviewPractice.mock.almost") : t("interviewPractice.mock.oneMore")}</h2>
            <p className="text-[13px] text-ink-3" role="status">
              {fb.answered === 0 ? t("interviewPractice.mock.noAnswers") : pending ? t("interviewPractice.mock.saving") : saved === "ok" ? t("interviewPractice.mock.saved") : saved === "error" ? t("interviewPractice.mock.saveFailed") : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {DIMS.map((d) => (
            <div key={d.key} className="flex flex-col gap-1.5">
              <span className="label !text-[11px]">{t(`interviewPractice.mock.${d.label}`)}</span>
              <span className="num text-[20px] text-head">{fb.dims[d.key]}</span>
              <Progress value={fb.dims[d.key]} tone={fb.dims[d.key] >= 70 ? "green" : fb.dims[d.key] >= 50 ? "teal" : "amber"} />
            </div>
          ))}
        </div>
        {fb.plan.length > 0 && (
          <div>
            <Label className="mb-2">{t("interviewPractice.mock.plan")}</Label>
            <ol className="flex flex-col gap-2">
              {fb.plan.map((p, i) => <li key={p} lang={engine} className="flex gap-3 text-[14.5px] text-ink-2"><span className="num w-4 shrink-0 text-green">{i + 1}</span>{p}</li>)}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={start}><RotateCcw className="size-4" strokeWidth={1.7} aria-hidden />{t("interviewPractice.mock.again")}</Button>
          <Button variant="glass" onClick={() => setPhase("select")}>{t("interviewPractice.mock.otherInterviewer")}</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card strong className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chip tone="teal">{personaName(t, persona)}</Chip>
        <span className="num text-[13px] text-ink-3" aria-label={t("interviewPractice.mock.questionOf", { n: idx + 1, total: questions.length })}>{idx + 1} / {questions.length}</span>
      </div>
      <Progress value={((idx + (current ? 1 : 0)) / questions.length) * 100} tone="teal" />
      <h2 lang="en" className="h-serif text-[clamp(22px,2.6vw,30px)]" aria-live="polite">{question}</h2>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-answer`} className="label">{t("interviewPractice.mock.yourAnswer")}</label>
        <textarea
          ref={answerRef}
          id={`${ids}-answer`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setCurrent(null); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (current) advance(); else evaluate(); } }}
          rows={6}
          placeholder={supported ? t("interviewPractice.mock.placeholderVoice") : t("interviewPractice.mock.placeholderText")}
          className="field resize-y leading-relaxed"
          aria-describedby={`${ids}-hint`}
        />
        {interim && <p className="text-[13px] italic text-ink-3" aria-live="polite">{interim}…</p>}
        <p id={`${ids}-hint`} className="text-[12px] text-ink-3">{t("interviewPractice.words", { n: draft.trim().split(/\s+/).filter(Boolean).length })} · {t("interviewPractice.mock.evaluateHint")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {supported ? (
          <>
            <Button variant={speech.listening ? "danger" : "glass"} onClick={speech.listening ? speech.stop : speech.start} aria-pressed={speech.listening}>
              {speech.listening ? <><MicOff className="size-4" strokeWidth={1.7} aria-hidden />{t("interviewPractice.mock.stop")}</> : <><Mic className="size-4" strokeWidth={1.7} aria-hidden />{t("interviewPractice.mock.answerByVoice")}</>}
            </Button>
            <label className="sr-only" htmlFor={`${ids}-lang`}>{t("interviewPractice.mock.recognitionLang")}</label>
            <select id={`${ids}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={speech.listening} className="field min-h-10 !w-auto !rounded-full !py-2 text-[13px]">
              {speechLangs(locale, true).map((l) => <option key={l} value={l}>{t(`interviewPractice.speech.lang.${SPEECH_LANG_KEY[l]}`)}</option>)}
            </select>
          </>
        ) : (
          <span className="text-[12.5px] text-ink-3">{t("interviewPractice.mock.noVoice")}</span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => advance(true)}><SkipForward className="size-4" strokeWidth={1.7} aria-hidden />{t("interviewPractice.mock.skip")}</Button>
        {current ? (
          <Button onClick={() => advance()}>{idx + 1 >= questions.length ? t("interviewPractice.mock.finish") : t("interviewPractice.mock.nextQuestion")}<ArrowRight className="size-4" strokeWidth={1.7} aria-hidden /></Button>
        ) : (
          <Button onClick={evaluate} disabled={!draft.trim()}>{t("interviewPractice.mock.evaluate")}</Button>
        )}
      </div>
      {speech.error && <p role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13px] text-rose">{speech.error}</p>}
      {speech.notice && lang === "kk-KZ" && <p role="status" className="rounded-xl bg-amber-soft px-3 py-2 text-[13px] text-amber">{speech.notice}</p>}

      {current && <Feedback c={current} t={t} engine={engine} />}
    </Card>
  );
}

function Feedback({ c, t, engine }: { c: Current; t: T; engine: "ru" | undefined }) {
  const s = c.score;
  const tone = (v: number) => (v >= 70 ? "green" : v >= 50 ? "teal" : "amber") as "green" | "teal" | "amber";
  return (
    <section aria-label={t("interviewPractice.mock.feedbackAria")} aria-live="polite" className="animate-rise overflow-hidden rounded-2xl border border-line bg-white/75">
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
        <Ring value={s.overall} size={88} label={t("interviewPractice.mock.score")} />
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
          {[
            { label: t("interviewPractice.mock.dimStructure"), v: s.structure },
            { label: t("interviewPractice.mock.dimClarity"), v: s.clarity },
          ].map((b) => (
            <div key={b.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-[12.5px]"><span className="text-ink-3">{b.label}</span><span className="num text-[18px] leading-none text-head">{b.v}</span></div>
              <Progress value={b.v} tone={tone(b.v)} />
            </div>
          ))}
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12px]">
            {/* STAR only where the question asks for a story; an intro shows its own present → past → future cues. */}
            {(s.intent === "behavioral" || s.intent === "leadership") && (
            <span className="flex gap-1" role="img" aria-label={`STAR: ${(["s", "t", "a", "r"] as const).map((k) => t(s.star[k] ? "interviewPractice.mock.starHas" : "interviewPractice.mock.starMissing", { name: t(`interviewPractice.mock.${STAR_KEY[k]}`) })).join(", ")}`}>
              {(["s", "t", "a", "r"] as const).map((k) => (
                <span key={k} aria-hidden className={cx("num grid size-6 place-items-center rounded-md text-[11px] uppercase", s.star[k] ? "bg-green text-white" : "bg-head/10 text-ink-4")}>{k}</span>
              ))}
            </span>
            )}
            {s.introCues && (
              <span className="flex flex-wrap gap-1">
                {(["now", "past", "future"] as const).map((k) => (
                  <Chip key={k} tone={s.introCues![k] ? "green" : "neutral"}>{s.introCues![k] ? t(`interviewPractice.mock.${INTRO_CHIP[k]}`) : t("interviewPractice.mock.cueMissing", { cue: t(`interviewPractice.mock.${INTRO_CHIP[k]}`) })}</Chip>
                ))}
              </span>
            )}
            <Chip>{t("interviewPractice.words", { n: s.words })}</Chip>
            <Chip tone={s.fillers > 2 ? "amber" : "neutral"}>{t("interviewPractice.mock.fillers", { n: s.fillers })}</Chip>
            <Chip>{t("interviewPractice.mock.confidence", { n: s.confidence })}</Chip>
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-line bg-line md:grid-cols-2">
        <div className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
          <Label>{t("interviewPractice.mock.missingTitle")}</Label>
          {c.missing.length ? (
            <ul className="flex flex-col gap-1.5">
              {c.missing.map((m) => <li key={m} className="flex gap-2 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />{m}</li>)}
            </ul>
          ) : (
            <p className="text-[14px] text-green">{t("interviewPractice.mock.allThere")}</p>
          )}
          {/* Engine tips (Russian); the number / STAR tips are already covered by the list above. */}
          {s.tips.filter((tip) => !/цифру|STAR/.test(tip)).slice(0, 2).map((tip) => <p key={tip} lang={engine} className="text-[13px] text-ink-3">{tip}</p>)}
        </div>
        <div className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
          <Label>{t.rich("interviewPractice.mock.stronger", { strategy: c.better.strategy }, { s: (x) => <span lang={engine}>{x}</span> })}</Label>
          {c.better.opener && <p lang="en" className="border-l-2 border-green/50 pl-3 font-serif text-[16.5px] leading-snug text-head">{c.better.opener}</p>}
          <ul className="flex flex-col gap-1.5">
            {c.better.bullets.map((b) => <li key={b} lang={b === c.better.skillsLine ? undefined : engine} className="flex gap-2 text-[13.5px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-green" />{b}</li>)}
          </ul>
          {c.better.keyNumber && <p className="text-[13px] text-ink-3">{t("interviewPractice.mock.number")} <span className="num text-green">{c.better.keyNumber}</span></p>}
        </div>
      </div>
    </section>
  );
}
