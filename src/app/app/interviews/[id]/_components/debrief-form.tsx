"use client";
import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { Label, cx } from "@/components/ui";
import { PendingButton, submitVia } from "../../_components/pending-button";
import { useSpeech, useSpeechSupported } from "../../_components/use-speech";
import { saveDebrief, type DebriefState } from "@/lib/actions/interview";
import { DEBRIEF_PROMPTS } from "./debrief-engine";

const OUTCOMES = [
  { v: "done", label: "Ждём ответа" },
  { v: "passed", label: "Прошёл дальше" },
  { v: "failed", label: "Не прошёл" },
] as const;

const TARGET_S = 60;
const MAX_S = 180;

/** "How did it go?" — tell it in about a minute by voice, or type it. */
export function DebriefForm({ id, initialTranscript = "", initialOutcome = "done" }: { id: string; initialTranscript?: string; initialOutcome?: string }) {
  const [state, action, pending] = useActionState<DebriefState, FormData>(saveDebrief, undefined);
  const uid = useId();
  const [text, setText] = useState(initialTranscript);
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState("ru-RU");
  const [secs, setSecs] = useState(0);
  const supported = useSpeechSupported();
  const elapsed = useRef(0);
  // Latest transcript/interim outside React state, so a submit that waits for the last speech segment reads it synchronously.
  const textRef = useRef(initialTranscript);
  const interimRef = useRef("");
  const setTranscript = (next: string) => {
    textRef.current = next;
    setText(next);
  };
  const append = (t: string) => {
    if (!t) return;
    const d = textRef.current;
    setTranscript(d ? `${d.trimEnd()} ${t}` : t);
  };
  const speech = useSpeech({
    lang,
    onFinal: append,
    onInterim: (t) => {
      interimRef.current = t;
      setInterim(t);
    },
  });
  const { listening, stop } = speech;

  // Recording timer: resumes from the accumulated time when the user records again.
  useEffect(() => {
    if (!listening) return;
    const t0 = Date.now() - elapsed.current * 1000;
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      elapsed.current = s;
      setSecs(s);
      if (s >= MAX_S) stop();
    }, 250);
    return () => clearInterval(iv);
  }, [listening, stop]);

  const toggle = () => {
    if (listening) {
      void stop().then(() => {
        append(interimRef.current.trim());
        interimRef.current = "";
        setInterim("");
      });
    } else speech.start();
  };

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const r = 34;
  const c = 2 * Math.PI * r;
  const progress = Math.min(1, secs / TARGET_S);

  return (
    <form
      onSubmit={async (e) => {
        if (!listening) return submitVia(action, startTransition)(e);
        // Recording: stop, wait for the engine's final segment (onend), then post the complete transcript.
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        await stop();
        // An engine that ended without finalizing the in-progress phrase: keep what the user saw on screen.
        append(interimRef.current.trim());
        interimRef.current = "";
        setInterim("");
        fd.set("transcript", textRef.current);
        startTransition(() => action(fd));
      }}
      className="flex flex-col gap-6"
      aria-describedby={state?.error ? `${uid}-err` : undefined}
    >
      <input type="hidden" name="id" value={id} />

      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        {supported ? (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={toggle}
              aria-pressed={listening}
              aria-describedby={`${uid}-timer`}
              className={cx(
                "relative grid size-[84px] shrink-0 place-items-center rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green",
                listening ? "bg-rose text-white" : "bg-cta text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c]",
              )}
            >
              <svg aria-hidden width="84" height="84" className="absolute inset-0 -rotate-90">
                <circle cx="42" cy="42" r={r} fill="none" stroke="rgb(255 255 255 / .18)" strokeWidth="3" />
                <circle cx="42" cy="42" r={r} fill="none" stroke="#7fe3b6" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} style={{ transition: "stroke-dashoffset .25s linear" }} />
              </svg>
              {listening ? <Square className="size-6" strokeWidth={1.8} fill="currentColor" /> : <Mic className="size-7" strokeWidth={1.7} />}
              <span className="sr-only">{listening ? "Остановить запись" : "Рассказать голосом"}</span>
            </button>
            <div className="flex flex-col gap-1">
              <span className="text-[15px] font-medium text-head">{listening ? "Слушаю — говорите свободно" : secs ? "Можно продолжить или отредактировать текст" : "Рассказать голосом"}</span>
              <span id={`${uid}-timer`} className="num text-[13px] text-ink-3" aria-live="off">
                {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} / ~1:00
              </span>
              <label htmlFor={`${uid}-lang`} className="sr-only">Язык рассказа</label>
              <select id={`${uid}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening} className="field mt-1 !h-8 !w-auto !rounded-full !py-0 !pl-3 !pr-8 text-[12.5px]">
                <option value="ru-RU">Русский</option>
                <option value="en-US">English</option>
              </select>
            </div>
          </div>
        ) : (
          <p className="text-[13.5px] text-ink-3">Голосовой ввод недоступен в этом браузере — напишите пару предложений.</p>
        )}
        <div className="flex-1 sm:border-l sm:border-line sm:pl-5">
          <Label className="mb-2">Расскажите за минуту</Label>
          <ul className="flex flex-wrap gap-1.5">
            {DEBRIEF_PROMPTS.map((p) => <li key={p} className="rounded-full border border-line bg-white/60 px-3 py-1 text-[12.5px] text-ink-2">{p}</li>)}
          </ul>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}-t`} className="label">{supported ? "Расшифровка — можно поправить" : "Ваш рассказ"}</label>
        <textarea
          id={`${uid}-t`}
          name="transcript"
          value={text}
          onChange={(e) => setTranscript(e.target.value)}
          rows={6}
          required
          placeholder="Спросили про сегментацию клиентов и SQL window functions. Сложно было с вопросом про конфликт. Сказали, что следующий этап — техническое интервью, ответ обещали через неделю. О зарплате не говорили."
          className="field resize-y leading-relaxed"
          aria-describedby={`${uid}-count`}
        />
        {interim && <p className="text-[13px] italic text-ink-3">{interim}…</p>}
        <p id={`${uid}-count`} className="text-[12px] text-ink-4">{words} слов · Simplify не записывает звук — речь распознаёт браузер</p>
        {speech.error && <p role="alert" className="rounded-xl bg-amber-soft px-3 py-2 text-[13px] text-amber">{speech.error}</p>}
      </div>

      <fieldset>
        <legend className="label mb-2">Статус раунда</legend>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <label key={o.v} className={cx("flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white/60 px-4 py-2 text-[14px] has-[:checked]:border-green/40 has-[:checked]:bg-green-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green", o.v === "failed" && "has-[:checked]:!border-rose/30 has-[:checked]:!bg-rose-soft")}>
              <input type="radio" name="outcome" value={o.v} required defaultChecked={initialOutcome === o.v} className="accent-green" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && <p id={`${uid}-err`} role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13.5px] text-rose">{state.error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <PendingButton pending={pending} pendingText="Разбираем интервью…" size="lg" disabled={words < 3}>Разобрать интервью</PendingButton>
        <span className="text-[12.5px] text-ink-3">Получите оценку, сильные и слабые места, план подготовки и thank-you письмо.</span>
      </div>
    </form>
  );
}
