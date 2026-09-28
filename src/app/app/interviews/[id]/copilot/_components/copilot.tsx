"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Mic, MicOff, X, ShieldAlert, AlertTriangle, CornerDownLeft, Lock, Gauge } from "lucide-react";
import { scaffold, type FactLite, type Scaffold, type StoryLite } from "@/lib/engine/interview";
import { cx } from "@/components/ui";
import { useSpeech, useSpeechSupported } from "../../../_components/use-speech";

type Ctx = { stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; salary?: { low: number; high: number } };
type Item = { q: string; sc: Scaffold; at: number };

const QUESTION_START = /^(what|why|how|when|where|who|which|tell|describe|walk|can you|could you|would you|have you|do you|did you|are you|give|explain|share|talk|any questions|расскаж|почему|как|что|когда|где|опиш|приведите|какие|какой|есть ли)/i;
const looksLikeQuestion = (t: string) => /\?\s*$/.test(t) || QUESTION_START.test(t.trim());
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const PAUSE_MS = 700;

export function Copilot({ interviewId, ctx, title, blocked }: { interviewId: string; ctx: Ctx; title: string; blocked: "employer" | "assessment" | "consent" | null }) {
  const router = useRouter();
  const exitHref = `/app/interviews/${interviewId}`;
  const exit = useCallback(() => router.push(exitHref), [router, exitHref]);
  const uid = useId();
  const [lang, setLang] = useState("en-US");
  const [history, setHistory] = useState<Item[]>([]);
  const [active, setActive] = useState<Item | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [live, setLive] = useState("");
  const [manual, setManual] = useState("");
  const t0 = useRef<number | null>(null);
  const finalBuf = useRef("");
  const interimRef = useRef("");
  const consumed = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startBtn = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const supported = useSpeechSupported();

  const show = useCallback(
    (q: string, start: number) => {
      const sc = scaffold(q, ctx);
      t0.current = start;
      const item = { q, sc, at: Date.now() };
      setActive(item);
      setHistory((h) => [item, ...h.filter((x) => x.q !== q)].slice(0, 8));
    },
    [ctx],
  );

  // Measured latency: question end → scaffold committed to the DOM.
  useLayoutEffect(() => {
    if (t0.current == null) return;
    const ms = performance.now() - t0.current;
    t0.current = null;
    setLatency(ms);
  }, [active]);

  const flush = useCallback(
    (fromInterim: boolean) => {
      const start = performance.now();
      if (timer.current) clearTimeout(timer.current);
      const text = `${finalBuf.current} ${fromInterim ? interimRef.current : ""}`.replace(/\s+/g, " ").trim();
      if (fromInterim) consumed.current = norm(interimRef.current);
      finalBuf.current = "";
      interimRef.current = "";
      setLive("");
      if (text.split(" ").length >= 3 && looksLikeQuestion(text)) show(text, start);
    },
    [show],
  );

  const armPause = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(true), PAUSE_MS);
  }, [flush]);

  const speech = useSpeech({
    lang,
    continuous: true,
    onFinal: (t) => {
      const n = norm(t);
      // Skip a final segment we already handled from its interim version (pause / '?' detection).
      if (consumed.current && (n === consumed.current || n.startsWith(consumed.current) || consumed.current.startsWith(n))) {
        consumed.current = "";
        return;
      }
      consumed.current = "";
      finalBuf.current = `${finalBuf.current} ${t}`.trim();
      interimRef.current = "";
      setLive(finalBuf.current);
      if (/\?\s*$/.test(t)) flush(false);
      else armPause();
    },
    onInterim: (t) => {
      if (!t) return;
      interimRef.current = t;
      setLive(`${finalBuf.current} ${t}`.trim());
      if (/\?\s*$/.test(t)) flush(true);
      else armPause();
    },
  });

  const toggle = useCallback(() => {
    if (blocked) return;
    if (speech.listening) {
      speech.stop();
      flush(true);
    } else speech.start();
  }, [blocked, speech, flush]);

  // Keyboard: Space = start/stop, Esc = exit. Ignore while typing or on native controls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, button, a, [contenteditable]");
      if (e.key === "Escape") {
        e.preventDefault();
        exit();
      } else if (e.code === "Space" && !typing && !e.repeat) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exit, toggle]);

  // Focus mode: lock page scroll, make the app shell behind the overlay inert, focus the primary control.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const inerted: Element[] = [];
    for (let node: HTMLElement | null = rootRef.current; node && node !== document.body; node = node.parentElement) {
      for (const sib of Array.from(node.parentElement?.children ?? [])) {
        if (sib !== node && !sib.hasAttribute("inert") && !(sib instanceof HTMLScriptElement)) {
          sib.setAttribute("inert", "");
          inerted.push(sib);
        }
      }
    }
    (startBtn.current ?? rootRef.current?.querySelector<HTMLElement>("a, button"))?.focus();
    return () => {
      document.body.style.overflow = prev;
      inerted.forEach((el) => el.removeAttribute("inert"));
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const q = manual.trim();
    if (!q) return;
    show(q, performance.now());
    setManual("");
  };

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} className="fixed inset-0 z-[70] flex flex-col overflow-hidden bg-[#0c1512] text-white">
      {/* Top bar */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
        <span className={cx("size-2.5 rounded-full", speech.listening ? "bg-[#4fd39a] animate-pulse-dot" : "bg-white/30")} aria-hidden />
        <h1 id={`${uid}-title`} className="min-w-0 flex-1 truncate font-mono text-[12px] uppercase tracking-[.08em] text-white/70">
          Interview Copilot · <span className="text-white">{title}</span>
        </h1>
        {latency != null && (
          <span className={cx("flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[11px]", latency <= 150 ? "bg-[#4fd39a]/15 text-[#7fe3b6]" : "bg-amber-400/15 text-amber-200")} title="От конца вопроса до карточки на экране">
            <Gauge className="size-3.5" strokeWidth={1.7} aria-hidden />
            <span className="num">{latency < 10 ? latency.toFixed(1) : Math.round(latency)}</span> ms
          </span>
        )}
        <button onClick={exit} className="flex h-9 items-center gap-2 rounded-full border border-white/15 px-3.5 text-[13px] text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fd39a]">
          <X className="size-4" strokeWidth={1.7} />Выйти <kbd className="hidden rounded border border-white/20 px-1 font-mono text-[10px] sm:inline">Esc</kbd>
        </button>
      </header>

      {blocked ? (
        <Blocked kind={blocked} exitHref={exitHref} />
      ) : (
        <>
          <main className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[1fr_320px] lg:overflow-hidden">
            <section aria-live="polite" aria-label="Подсказка к ответу" className="flex min-h-0 flex-col px-4 py-6 sm:px-8 lg:overflow-y-auto lg:py-10">
              {active ? <ScaffoldCard key={active.at} item={active} /> : <Idle listening={speech.listening} supported={supported} />}
            </section>

            <aside className="flex min-h-0 flex-col gap-5 border-t border-white/10 px-4 py-5 sm:px-6 lg:overflow-y-auto lg:border-l lg:border-t-0">
              <div>
                <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[.08em] text-white/50">Слышу</div>
                <p className="min-h-[3em] text-[15px] leading-snug text-white/80">{live || <span className="text-white/35">{speech.listening ? "…" : "Микрофон выключен"}</span>}</p>
              </div>
              <div>
                <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[.08em] text-white/50">Последние вопросы</div>
                {history.length === 0 ? (
                  <p className="text-[13px] text-white/40">Пока пусто</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {history.map((h) => (
                      <li key={h.at}>
                        <button onClick={() => { setActive(h); setLatency(null); }} aria-current={active?.at === h.at} className={cx("w-full rounded-xl px-3 py-2 text-left text-[13.5px] leading-snug transition focus-visible:outline-2 focus-visible:outline-[#4fd39a]", active?.at === h.at ? "bg-white/12 text-white" : "text-white/65 hover:bg-white/6 hover:text-white")}>
                          <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-[.06em] text-[#7fe3b6]">{h.sc.intent}</span>
                          <span className="line-clamp-2">{h.q}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </main>

          {/* Controls */}
          <footer className="border-t border-white/10 px-4 py-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="flex items-center gap-2">
                <button
                  ref={startBtn}
                  onClick={toggle}
                  disabled={!supported}
                  aria-pressed={speech.listening}
                  className={cx("flex h-12 items-center gap-2.5 rounded-full px-6 text-[15px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[#4fd39a] disabled:cursor-not-allowed disabled:opacity-40", speech.listening ? "bg-[#e5484d] text-white hover:brightness-110" : "bg-white text-[#0c1512] hover:bg-white/90")}
                >
                  {speech.listening ? <MicOff className="size-5" strokeWidth={1.8} /> : <Mic className="size-5" strokeWidth={1.8} />}
                  {speech.listening ? "Стоп" : "Слушать"}
                  <kbd className="hidden rounded border border-current/30 px-1.5 font-mono text-[10px] opacity-60 sm:inline">Space</kbd>
                </button>
                <label htmlFor={`${uid}-lang`} className="sr-only">Язык интервью</label>
                <select id={`${uid}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={speech.listening} className="h-12 rounded-full border border-white/15 bg-transparent px-4 text-[14px] text-white focus-visible:outline-2 focus-visible:outline-[#4fd39a] disabled:opacity-50 [&>option]:text-black">
                  <option value="en-US">English (en-US)</option>
                  <option value="ru-RU">Русский (ru-RU)</option>
                </select>
              </div>
              <form onSubmit={submitManual} className="flex min-w-0 flex-1 items-center gap-2">
                <label htmlFor={`${uid}-q`} className="sr-only">Вставьте вопрос интервьюера</label>
                <input
                  id={`${uid}-q`}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Вставьте вопрос, если микрофон недоступен…"
                  autoComplete="off"
                  className="h-12 min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 text-[15px] text-white placeholder:text-white/35 focus:border-[#4fd39a] focus:outline-none focus:ring-4 focus:ring-[#4fd39a]/15"
                />
                <button type="submit" disabled={!manual.trim()} className="grid size-12 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#4fd39a] disabled:opacity-40" aria-label="Показать подсказку">
                  <CornerDownLeft className="size-5" strokeWidth={1.7} />
                </button>
              </form>
            </div>
            {(speech.error || !supported) && (
              <p role="alert" className="mt-3 text-[13px] text-amber-200">{speech.error ?? "Распознавание речи недоступно в этом браузере (нужен Chrome, Edge или Safari). Вставляйте вопросы текстом — подсказка появится мгновенно."}</p>
            )}
            <p className="mt-3 flex items-start gap-2 text-[12px] text-white/45">
              <Lock className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
              Звук обрабатывает встроенный speech engine браузера. Simplify ничего не записывает и не сохраняет. Подсказки — только из ваших подтверждённых фактов и STAR-историй.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}

function ScaffoldCard({ item }: { item: Item }) {
  const { sc, q } = item;
  return (
    <article className="mx-auto flex w-full max-w-3xl animate-fade flex-col gap-6">
      <p className="text-[15px] leading-snug text-white/55">«{q}»</p>
      {sc.warning && (
        <div role="alert" className="flex gap-3 rounded-2xl border-2 border-[#ff8a8a]/60 bg-[#e5484d]/15 px-5 py-4">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-[#ff9d9d]" strokeWidth={1.8} aria-hidden />
          <div>
            <div className="mb-1 font-mono text-[11px] uppercase tracking-[.08em] text-[#ff9d9d]">Truth Lock</div>
            <p className="text-[clamp(17px,2vw,21px)] font-medium leading-snug text-white">{sc.warning}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-full bg-[#4fd39a] px-3 py-1 font-mono text-[11.5px] uppercase tracking-[.08em] text-[#0c1512]">{sc.intent}</span>
        <span className="text-[15px] text-white/70">{sc.strategy}</span>
      </div>
      {sc.opener && <p className="font-serif text-[clamp(26px,3.4vw,40px)] leading-[1.12] text-white">{sc.opener}</p>}
      <ul className="flex flex-col gap-3.5">
        {sc.bullets.map((b, i) => (
          <li key={i} className="flex gap-4 text-[clamp(18px,2.1vw,24px)] leading-snug text-white/92">
            <span aria-hidden className="mt-[0.55em] size-2 shrink-0 rounded-full bg-[#4fd39a]" />
            {b}
          </li>
        ))}
      </ul>
      {sc.keyNumber && (
        <div className="flex flex-col gap-1 border-t border-white/10 pt-5">
          <span className="font-mono text-[11px] uppercase tracking-[.08em] text-white/50">Ключевая цифра</span>
          <span className="num text-[clamp(22px,2.8vw,32px)] leading-tight text-[#7fe3b6]">{sc.keyNumber}</span>
        </div>
      )}
    </article>
  );
}

function Idle({ listening, supported }: { listening: boolean; supported: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center gap-5 py-10">
      <span className="font-mono text-[11px] uppercase tracking-[.08em] text-white/50">{listening ? "Слушаю интервьюера" : "Готов"}</span>
      <p className="font-serif text-[clamp(28px,3.6vw,44px)] leading-[1.1] text-white">
        {listening ? "Как только вопрос закончится, здесь появится подсказка." : supported ? "Нажмите «Слушать» или Space, когда начнётся звонок." : "Вставьте вопрос интервьюера в поле внизу."}
      </p>
      <ul className="flex flex-col gap-2 text-[15px] text-white/60">
        <li>· Одна фраза-опенер, 3–5 тезисов, ключевая цифра</li>
        <li>· Предупреждение, если вопрос тянет на то, чего нет в профиле</li>
        <li>· Смотрите в камеру — подсказка лишь опора, не текст для чтения</li>
      </ul>
    </div>
  );
}

function Blocked({ kind, exitHref }: { kind: "employer" | "assessment" | "consent"; exitHref: string }) {
  const text = {
    employer: "Для этого интервью отмечено, что работодатель запрещает внешнюю помощь. Live-режим Copilot отключён — это честно по отношению к работодателю и защищает вас.",
    assessment: "Во время онлайн-assessments внешняя помощь обычно запрещена правилами теста. Live-режим недоступен.",
    consent: "Вы отключили Interview Copilot в настройках приватности. Включите его там, если хотите пользоваться live-режимом.",
  }[kind];
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex max-w-xl flex-col gap-5">
        <ShieldAlert className="size-9 text-amber-200" strokeWidth={1.5} aria-hidden />
        <h2 className="font-serif text-[clamp(28px,3.4vw,40px)] leading-[1.1]">Copilot недоступен для этого раунда</h2>
        <p className="text-[16px] leading-relaxed text-white/75">{text}</p>
        <p className="text-[15px] text-white/60">Подготовьтесь заранее: Interview Pack и Mock Interview дают тот же материал до звонка.</p>
        <div className="flex flex-wrap gap-2">
          <Link href={`${exitHref}?tab=pack`} className="flex h-11 items-center rounded-full bg-white px-5 text-[14.5px] font-medium text-[#0c1512] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fd39a]">Interview Pack</Link>
          <Link href={`${exitHref}?tab=mock`} className="flex h-11 items-center rounded-full border border-white/20 px-5 text-[14.5px] text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#4fd39a]">Mock Interview</Link>
          {kind === "consent" && <Link href="/app/settings" className="flex h-11 items-center rounded-full border border-white/20 px-5 text-[14.5px] text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#4fd39a]">Настройки приватности</Link>}
        </div>
      </div>
    </div>
  );
}
