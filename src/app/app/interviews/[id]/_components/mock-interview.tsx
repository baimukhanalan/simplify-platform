"use client";
import { useId, useRef, useState, useTransition } from "react";
import { Mic, MicOff, RotateCcw, ArrowRight, Check, SkipForward, Play } from "lucide-react";
import { Button, Card, Chip, Label, Progress, Ring, cx } from "@/components/ui";
import { scoreAnswer } from "@/lib/engine/interview";
import { PERSONAS, PERSONA_LABEL } from "@/lib/rounds";
import { saveMockSession } from "@/lib/actions/interview";
import { useSpeech, useSpeechSupported } from "../../_components/use-speech";
import { MOCK_SETS, missingPoints, suggestion, type MockCtx } from "./mock-questions";

type Score = ReturnType<typeof scoreAnswer>;
type Turn = { question: string; answer: string; score: Score | null };
type Current = { score: Score; missing: string[]; better: ReturnType<typeof suggestion> };
export type MockFeedback = {
  overall: number;
  answered: number;
  dims: Record<"content" | "structure" | "clarity" | "length" | "confidence", number>;
  fillers: number;
  plan: string[];
  perQuestion: { question: string; overall: number | null; tips: string[] }[];
};

const DIMS: { key: keyof MockFeedback["dims"]; label: string }[] = [
  { key: "content", label: "Содержание" },
  { key: "structure", label: "Структура" },
  { key: "clarity", label: "Ясность" },
  { key: "length", label: "Длина" },
  { key: "confidence", label: "Уверенность" },
];
const DIM_ADVICE: Record<keyof MockFeedback["dims"], string> = {
  content: "Каждый ответ — с одной цифрой результата из твоего опыта.",
  structure: "Отвечай по STAR: 1 фраза контекста, 1 — задача, 2–3 — твои действия, 1 — результат.",
  clarity: "Короткие предложения и паузы вместо слов-паразитов.",
  length: "Держи ответ в 60–120 секунд (≈ 80–220 слов).",
  confidence: "Убери «I think maybe / наверное» — говори о своих решениях в первом лице.",
};

function summarize(turns: Turn[]): MockFeedback {
  const scored = turns.filter((t) => t.score).map((t) => t.score!);
  const avg = (f: (s: Score) => number) => (scored.length ? Math.round(scored.reduce((a, s) => a + f(s), 0) / scored.length) : 0);
  const dims = { content: avg((s) => s.content), structure: avg((s) => s.structure), clarity: avg((s) => s.clarity), length: avg((s) => s.length), confidence: avg((s) => s.confidence) };
  const tipCount = new Map<string, number>();
  scored.flatMap((s) => s.tips).forEach((t) => tipCount.set(t.replace(/\d+/g, "N"), (tipCount.get(t.replace(/\d+/g, "N")) ?? 0) + 1));
  const weakest = (Object.keys(dims) as (keyof typeof dims)[]).sort((a, b) => dims[a] - dims[b]).slice(0, 2);
  const plan = [...weakest.map((k) => DIM_ADVICE[k]), ...[...tipCount.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t.replace(/N/g, "несколько"))].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);
  return {
    overall: avg((s) => s.overall),
    answered: scored.length,
    dims,
    fillers: scored.reduce((a, s) => a + s.fillers, 0),
    plan,
    perQuestion: turns.map((t) => ({ question: t.question, overall: t.score?.overall ?? null, tips: t.score?.tips ?? [] })),
  };
}

export function MockInterview({ interviewId, defaultPersona, ctx, jdTerms, assessment = false }: { interviewId: string; defaultPersona: string; ctx: MockCtx; jdTerms: string[]; assessment?: boolean }) {
  const [phase, setPhase] = useState<"select" | "run" | "done">("select");
  const [persona, setPersona] = useState(defaultPersona);
  const [idx, setIdx] = useState(0);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraftState] = useState("");
  // Mirror of the draft so async handlers read the text that arrived after speech.stop() resolved.
  const draftRef = useRef("");
  const setDraft = (v: string | ((d: string) => string)) => setDraftState((d) => (draftRef.current = typeof v === "function" ? v(d) : v));
  const [interim, setInterim] = useState("");
  const [current, setCurrent] = useState<Current | null>(null);
  const [lang, setLang] = useState("en-US");
  const [saved, setSaved] = useState<"idle" | "ok" | "error">("idle");
  const [pending, startTransition] = useTransition();
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const ids = useId();
  const supported = useSpeechSupported();
  const speech = useSpeech({
    lang,
    onFinal: (t) => setDraft((d) => (d ? `${d.trimEnd()} ${t}` : t)),
    onInterim: setInterim,
  });

  const questions = MOCK_SETS[persona] ?? [];
  const question = questions[idx];

  const start = () => {
    setPhase("run");
    setIdx(0);
    setTurns([]);
    setDraft("");
    setCurrent(null);
    setSaved("idle");
    requestAnimationFrame(() => answerRef.current?.focus());
  };

  const evaluate = async () => {
    if (speech.listening) await speech.stop();
    const text = draftRef.current.trim();
    if (!text) return;
    const score = scoreAnswer(question, text, { skills: ctx.skills, jdTerms: jdTerms.length ? jdTerms : ctx.skills });
    setCurrent({ score, missing: missingPoints(question, text, score, ctx), better: suggestion(question, ctx) });
  };

  const advance = async (skip = false) => {
    if (speech.listening) await speech.stop();
    const nextTurns = [...turns, { question, answer: skip ? "" : draftRef.current.trim(), score: skip ? null : current?.score ?? null }];
    setTurns(nextTurns);
    setDraft("");
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
    const feedback = summarize(all);
    if (!feedback.answered) return;
    startTransition(async () => {
      try {
        const r = await saveMockSession({
          interviewId,
          persona,
          transcript: all.flatMap((t) => [{ role: "interviewer" as const, text: t.question }, { role: "candidate" as const, text: t.answer || "(пропущено)" }]),
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
        <Label className="mb-2">Mock Interview</Label>
        <h2 className="h-serif mb-2 text-[clamp(24px,2.6vw,32px)]">Кто будет тебя интервьюировать?</h2>
        <p className="mb-5 max-w-xl text-[14px] text-ink-3">5 вопросов. Отвечай голосом или текстом — после каждого ответа: оценка, структура, ясность, чего не хватило и как сказать сильнее на твоих же историях.</p>
        <fieldset>
          <legend className="sr-only">Персона интервьюера</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PERSONAS.map((p) => (
              <label key={p.key} className={cx("flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green", persona === p.key ? "border-green/40 bg-green-soft/70" : "border-line bg-white/60 hover:bg-white")}>
                <input type="radio" name={`${ids}-persona`} value={p.key} checked={persona === p.key} onChange={() => setPersona(p.key)} className="sr-only" />
                <span className="flex items-center justify-between text-[15px] font-medium text-head">{p.label}{persona === p.key && <Check className="size-4 text-green" strokeWidth={2} />}</span>
                <span className="text-[12.5px] text-ink-3">{p.sub}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <Button className="mt-6" size="lg" onClick={start}><Play className="size-4" strokeWidth={1.7} aria-hidden />{assessment ? "Начать тренировку" : "Start Mock Interview"}</Button>
      </Card>
    );

  if (phase === "done") {
    const fb = summarize(turns);
    return (
      <Card strong className="flex flex-col gap-6">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Ring value={fb.overall} size={112} label="overall" />
          <div className="flex flex-col gap-1.5">
            <Label>Итог · {PERSONA_LABEL[persona]}</Label>
            <h2 className="h-serif text-[28px]">{fb.overall >= 75 ? (assessment ? "Уровень для теста есть" : "Уровень для звонка есть") : fb.overall >= 55 ? "Почти на уровне" : "Нужна ещё одна тренировка"}</h2>
            <p className="text-[13px] text-ink-3" role="status">
              {fb.answered === 0 ? "Нет ответов — сессия не сохранена." : pending ? "Сохраняем сессию…" : saved === "ok" ? "Сессия сохранена." : saved === "error" ? "Не удалось сохранить сессию." : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          {DIMS.map((d) => (
            <div key={d.key} className="flex flex-col gap-1.5">
              <span className="label !text-[10px]">{d.label}</span>
              <span className="num text-[20px] text-head">{fb.dims[d.key]}</span>
              <Progress value={fb.dims[d.key]} tone={fb.dims[d.key] >= 70 ? "green" : fb.dims[d.key] >= 50 ? "teal" : "amber"} />
            </div>
          ))}
        </div>
        {fb.plan.length > 0 && (
          <div>
            <Label className="mb-2">План улучшения</Label>
            <ol className="flex flex-col gap-2">
              {fb.plan.map((p, i) => <li key={p} className="flex gap-3 text-[14.5px] text-ink-2"><span className="num w-4 shrink-0 text-green">{i + 1}</span>{p}</li>)}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={start}><RotateCcw className="size-4" strokeWidth={1.7} />Ещё раз</Button>
          <Button variant="glass" onClick={() => setPhase("select")}>Другой интервьюер</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card strong className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chip tone="teal">{PERSONA_LABEL[persona]}</Chip>
        <span className="num text-[13px] text-ink-3" aria-label={`Вопрос ${idx + 1} из ${questions.length}`}>{idx + 1} / {questions.length}</span>
      </div>
      <Progress value={((idx + (current ? 1 : 0)) / questions.length) * 100} tone="teal" />
      <h2 className="h-serif text-[clamp(22px,2.6vw,30px)]" aria-live="polite">{question}</h2>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${ids}-answer`} className="label">Твой ответ</label>
        <textarea
          ref={answerRef}
          id={`${ids}-answer`}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setCurrent(null); }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (current) advance(); else evaluate(); } }}
          rows={6}
          placeholder={supported ? "Говори в микрофон или печатай…" : "Напечатай ответ так, как он звучал бы вслух…"}
          className="field resize-y leading-relaxed"
          aria-describedby={`${ids}-hint`}
        />
        {interim && <p className="text-[13px] italic text-ink-3" aria-live="polite">{interim}…</p>}
        <p id={`${ids}-hint`} className="text-[12px] text-ink-4">{draft.trim().split(/\s+/).filter(Boolean).length} слов · Ctrl/⌘ + Enter — оценить</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {supported ? (
          <>
            <Button variant={speech.listening ? "danger" : "glass"} onClick={speech.listening ? speech.stop : speech.start} aria-pressed={speech.listening}>
              {speech.listening ? <><MicOff className="size-4" strokeWidth={1.7} />Стоп</> : <><Mic className="size-4" strokeWidth={1.7} />Ответить голосом</>}
            </Button>
            <label className="sr-only" htmlFor={`${ids}-lang`}>Язык распознавания</label>
            <select id={`${ids}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={speech.listening} className="field !w-auto !rounded-full !py-2 text-[13px]">
              <option value="en-US">English</option>
              <option value="ru-RU">Русский</option>
            </select>
          </>
        ) : (
          <span className="text-[12.5px] text-ink-3">Голосовой ввод недоступен в этом браузере — ответь текстом.</span>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => advance(true)}><SkipForward className="size-4" strokeWidth={1.7} />Пропустить</Button>
        {current ? (
          <Button onClick={() => advance()}>{idx + 1 >= questions.length ? "Завершить" : "Следующий вопрос"}<ArrowRight className="size-4" strokeWidth={1.7} /></Button>
        ) : (
          <Button onClick={evaluate} disabled={!draft.trim()}>Оценить ответ</Button>
        )}
      </div>
      {speech.error && <p role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13px] text-rose">{speech.error}</p>}

      {current && <Feedback c={current} />}
    </Card>
  );
}

function Feedback({ c }: { c: Current }) {
  const s = c.score;
  const tone = (v: number) => (v >= 70 ? "green" : v >= 50 ? "teal" : "amber") as "green" | "teal" | "amber";
  return (
    <section aria-label="Оценка ответа" aria-live="polite" className="animate-rise overflow-hidden rounded-2xl border border-line bg-white/75">
      <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
        <Ring value={s.overall} size={88} label="score" />
        <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
          {[
            { label: "Структура", v: s.structure },
            { label: "Ясность", v: s.clarity },
          ].map((b) => (
            <div key={b.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-[12.5px]"><span className="text-ink-3">{b.label}</span><span className="num text-[18px] leading-none text-head">{b.v}</span></div>
              <Progress value={b.v} tone={tone(b.v)} />
            </div>
          ))}
          <div className="col-span-2 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="flex gap-1" role="img" aria-label={`STAR: ${(["s", "t", "a", "r"] as const).map((k) => `${k.toUpperCase()} ${s.star[k] ? "есть" : "нет"}`).join(", ")}`}>
              {(["s", "t", "a", "r"] as const).map((k) => (
                <span key={k} aria-hidden className={cx("num grid size-6 place-items-center rounded-md text-[11px] uppercase", s.star[k] ? "bg-green text-white" : "bg-head/10 text-ink-4")}>{k}</span>
              ))}
            </span>
            <Chip>{s.words} слов</Chip>
            <Chip tone={s.fillers > 2 ? "amber" : "neutral"}>Паразиты: {s.fillers}</Chip>
            <Chip>Уверенность {s.confidence}</Chip>
          </div>
        </div>
      </div>

      <div className="grid gap-px border-t border-line bg-line md:grid-cols-2">
        <div className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
          <Label>Чего не хватило</Label>
          {c.missing.length ? (
            <ul className="flex flex-col gap-1.5">
              {c.missing.map((m) => <li key={m} className="flex gap-2 text-[14px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />{m}</li>)}
            </ul>
          ) : (
            <p className="text-[14px] text-green">Все ключевые элементы на месте.</p>
          )}
          {s.tips.filter((t) => !/цифру|STAR/.test(t)).slice(0, 2).map((t) => <p key={t} className="text-[13px] text-ink-3">{t}</p>)}
        </div>
        <div className="flex flex-col gap-2.5 bg-white/85 p-4 sm:p-5">
          <Label>Как сказать сильнее · {c.better.strategy}</Label>
          {c.better.opener && <p className="border-l-2 border-green/50 pl-3 font-serif text-[16.5px] leading-snug text-head">{c.better.opener}</p>}
          <ul className="flex flex-col gap-1.5">
            {c.better.bullets.map((b) => <li key={b} className="flex gap-2 text-[13.5px] text-ink-2"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-green" />{b}</li>)}
          </ul>
          {c.better.keyNumber && <p className="text-[13px] text-ink-3">Цифра: <span className="num text-green">{c.better.keyNumber}</span></p>}
        </div>
      </div>
    </section>
  );
}
