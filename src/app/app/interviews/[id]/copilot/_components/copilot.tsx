"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { CornerDownLeft, Gauge, Info, Mic, MicOff, PictureInPicture2, X } from "lucide-react";
import { retrieveStories, scaffold, type FactLite, type Intent, type Scaffold, type StoryLite } from "@/lib/engine/interview";
import { cx } from "@/components/ui";
import { useSpeech, useSpeechSupported } from "../../../_components/use-speech";
import { matchMethod, type Method } from "./methods";

type Ctx = { stories: StoryLite[]; facts: FactLite[]; skills: string[]; yearsExperience: number; company: string; role: string; salary?: { low: number; high: number } };
type Row = { k: string; v: string };
type Card =
  | { mode: "technical"; method: Method; opener: string; keyNumber: string }
  | { mode: "behavioral"; rows: Row[]; opener: string; keyNumber: string; storyTitle: string | null }
  | { mode: "general"; strategy: string; bullets: string[]; opener: string; keyNumber: string };
type Item = { q: string; intent: Intent; card: Card; at: number };

const QUESTION_START = /^(what|why|how|when|where|who|which|tell|describe|walk|can you|could you|would you|have you|do you|did you|are you|give|explain|share|talk|any questions|расскаж|почему|как|что|когда|где|опиш|приведите|какие|какой|есть ли)/i;
const looksLikeQuestion = (t: string) => /\?\s*$/.test(t) || QUESTION_START.test(t.trim());
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const clip = (s: string, n = 110) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
const PAUSE_MS = 700;

const MODE_LABEL: Record<Intent, string> = {
  behavioral: "Behavioral", leadership: "Behavioral · Leadership", experience: "Experience", technical: "Technical Interview Mode", case: "Technical Interview Mode · Case",
  motivation: "Motivation", salary: "Salary", strengths: "Strengths", weakness: "Weakness", intro: "Tell me about yourself", closing: "Your questions",
};

function lessonFor(story: StoryLite | undefined) {
  if (!story) return "What you'd repeat or change next time";
  if (story.tags.includes("failure")) return "What I changed in my process afterwards";
  if (story.tags.includes("conflict")) return "Disagree with data, then commit as a team";
  if (story.tags.includes("leadership")) return "How it changed the way I work with people";
  return "What I'd repeat next time";
}

/** Pure + synchronous: question → on-screen card. Stays well under a frame. */
function buildCard(q: string, ctx: Ctx): { intent: Intent; card: Card } {
  const sc: Scaffold = scaffold(q, ctx);
  const method = matchMethod(q);
  if (method && (sc.intent === "technical" || sc.intent === "case" || sc.intent === "experience")) {
    return { intent: sc.intent === "experience" ? "technical" : sc.intent, card: { mode: "technical", method, opener: sc.intent === "case" ? "Let me structure this first." : "Let me walk through it step by step.", keyNumber: "" } };
  }
  if (sc.intent === "behavioral" || sc.intent === "leadership") {
    const [s] = retrieveStories(q, ctx.stories, 1);
    const rows: Row[] = s
      ? [
          { k: "Context", v: clip(s.situation) },
          { k: "Why", v: clip(s.task) },
          { k: "Action", v: clip(s.action) },
          { k: "Result", v: clip(s.result) },
          { k: "Lesson", v: lessonFor(s) },
        ]
      : [
          { k: "Context", v: "Where and when — one sentence" },
          { k: "Why", v: "What was at stake, your responsibility" },
          { k: "Action", v: "2–3 things you did personally" },
          { k: "Result", v: "Outcome with a number" },
          { k: "Lesson", v: lessonFor(undefined) },
        ];
    const opener = s ? `One example that taught me a lot was ${s.title.charAt(0).toLowerCase()}${s.title.slice(1)}.` : "One example that taught me a lot was…";
    return { intent: sc.intent, card: { mode: "behavioral", rows, opener, keyNumber: s?.metric ?? "", storyTitle: s?.title ?? null } };
  }
  return { intent: sc.intent, card: { mode: "general", strategy: sc.strategy, bullets: sc.bullets, opener: sc.opener, keyNumber: sc.keyNumber } };
}

export function Copilot({ interviewId, ctx, title, round, blocked }: { interviewId: string; ctx: Ctx; title: string; round?: string; blocked: "employer" | "assessment" | "consent" | null }) {
  const router = useRouter();
  const exitHref = `/app/interviews/${interviewId}`;
  const uid = useId();
  const [popup, setPopup] = useState(false);
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

  const exit = useCallback(() => {
    if (popup) window.close();
    else router.push(exitHref);
  }, [popup, router, exitHref]);

  const show = useCallback(
    (q: string, start: number) => {
      const { intent, card } = buildCard(q, ctx);
      t0.current = start;
      const item = { q, intent, card, at: Date.now() };
      setActive(item);
      setHistory((h) => [item, ...h.filter((x) => x.q !== q)].slice(0, 6));
    },
    [ctx],
  );

  // Measured latency: end of question → card committed to the DOM.
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
      // Skip a final segment already handled from its interim version (pause / '?' detection).
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

  // Keyboard: Space = listen/stop, Esc = close. Ignored while typing or on native controls.
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

  // Focus mode: lock page scroll, make the app shell behind the panel inert, focus the primary control.
  useEffect(() => {
    // Popped-out window (see popOut) — the close button closes the window instead of navigating.
    const isPopup = window.name === "simplify-copilot" && Boolean(window.opener);
    const raf = requestAnimationFrame(() => setPopup(isPopup));
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
      cancelAnimationFrame(raf);
      document.body.style.overflow = prev;
      inerted.forEach((el) => el.removeAttribute("inert"));
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const popOut = () => {
    const w = window.open(window.location.href, "simplify-copilot", "popup,width=440,height=720");
    if (w) {
      speech.stop();
      router.push(exitHref);
    }
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const q = manual.trim();
    if (!q) return;
    show(q, performance.now());
    setManual("");
  };

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} className="fixed inset-0 z-[70] flex items-end justify-center bg-[#0c1512]/85 p-0 backdrop-blur-md sm:items-end sm:justify-end sm:p-6">
      {/* Calm backdrop hint (desktop only) */}
      <div aria-hidden className="pointer-events-none absolute left-8 top-8 hidden max-w-sm flex-col gap-2 text-white/70 lg:flex">
        <span className="font-mono text-[11px] uppercase tracking-[.1em] text-white/45">Interview Copilot</span>
        <span className="font-serif text-[28px] leading-tight text-white/85">Смотри в камеру. Карточка — только опора.</span>
        <span className="text-[13px]">Space — слушать / стоп · Esc — закрыть</span>
      </div>

      <section
        className={cx(
          "relative flex w-full flex-col overflow-hidden bg-[#0f1a16] text-white shadow-[0_24px_80px_rgb(0_0_0/.45)] ring-1 ring-white/10 animate-rise",
          popup ? "h-dvh sm:h-[calc(100dvh-48px)] sm:max-w-none sm:rounded-[22px]" : "h-dvh sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:w-[420px] sm:rounded-[22px]",
        )}
      >
        {/* Header */}
        <header className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <span className={cx("size-2 shrink-0 rounded-full", speech.listening ? "bg-[#4fd39a] animate-pulse-dot" : "bg-white/30")} aria-hidden />
          <h1 id={`${uid}-title`} className="flex min-w-0 flex-1 flex-col font-mono text-[11px] uppercase leading-snug tracking-[.08em] text-white/60 sm:flex-row sm:gap-1">
            <span className="truncate">Copilot · <span className="text-white/90">{title}</span></span>
            {round && <span className="shrink-0 text-white/70"><span aria-hidden className="hidden sm:inline">· </span>{round}</span>}
          </h1>
          {latency != null && (
            <span className={cx("flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10.5px]", latency <= 150 ? "bg-[#4fd39a]/15 text-[#7fe3b6]" : "bg-amber-400/15 text-amber-200")} title="От конца вопроса до карточки на экране">
              <Gauge className="size-3" strokeWidth={1.8} aria-hidden />
              <span className="num">{latency < 10 ? latency.toFixed(1) : Math.round(latency)}</span> ms
            </span>
          )}
          {!popup && !blocked && (
            <button type="button" onClick={popOut} className="hidden size-8 shrink-0 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#4fd39a] sm:grid" aria-label="Открыть в отдельном маленьком окне" title="Отдельное окно — поставь рядом со звонком">
              <PictureInPicture2 className="size-4" strokeWidth={1.7} />
            </button>
          )}
          <button type="button" onClick={exit} className="grid size-8 shrink-0 place-items-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-[#4fd39a]" aria-label="Закрыть Copilot (Esc)">
            <X className="size-4" strokeWidth={1.8} />
          </button>
        </header>

        {blocked ? (
          <Blocked kind={blocked} exitHref={exitHref} />
        ) : (
          <>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite" aria-label="Подсказка к ответу">
              {active ? <CardView key={active.at} item={active} /> : <Idle listening={speech.listening} supported={supported} />}
            </div>

            <div className="border-t border-white/10 px-4 py-2.5">
              <p className="line-clamp-2 min-h-[1.5em] text-[12.5px] leading-snug text-white/55">
                <span className="mr-1.5 font-mono text-[10px] uppercase tracking-[.08em] text-white/35">Слышу</span>
                {live || (speech.listening ? "…" : "микрофон выключен")}
              </p>
              {history.length > 1 && (
                <div className="scroll-thin -mx-1 mt-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Прошлые вопросы">
                  {history.map((h) => (
                    <button
                      key={h.at}
                      type="button"
                      onClick={() => { setActive(h); setLatency(null); }}
                      aria-pressed={active?.at === h.at}
                      className={cx("max-w-[180px] shrink-0 truncate rounded-full px-2.5 py-1 text-[12px] transition focus-visible:outline-2 focus-visible:outline-[#4fd39a]", active?.at === h.at ? "bg-white/15 text-white" : "bg-white/5 text-white/60 hover:bg-white/10")}
                    >
                      {h.q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <footer className="flex flex-col gap-2.5 border-t border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <button
                  ref={startBtn}
                  type="button"
                  onClick={toggle}
                  disabled={!supported}
                  aria-pressed={speech.listening}
                  className={cx("flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[14.5px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fd39a] disabled:cursor-not-allowed disabled:opacity-40", speech.listening ? "bg-[#e5484d] text-white hover:brightness-110" : "bg-white text-[#0c1512] hover:bg-white/90")}
                >
                  {speech.listening ? <MicOff className="size-4.5" strokeWidth={1.8} aria-hidden /> : <Mic className="size-4.5" strokeWidth={1.8} aria-hidden />}
                  {speech.listening ? "Стоп" : "Слушать"}
                  <kbd className="hidden rounded border border-current/30 px-1 font-mono text-[10px] opacity-60 sm:inline">Space</kbd>
                </button>
                <label htmlFor={`${uid}-lang`} className="sr-only">Язык интервью</label>
                <select id={`${uid}-lang`} value={lang} onChange={(e) => setLang(e.target.value)} disabled={speech.listening} className="h-11 rounded-full border border-white/15 bg-transparent px-3 text-[13px] text-white focus-visible:outline-2 focus-visible:outline-[#4fd39a] disabled:opacity-50 [&>option]:text-black">
                  <option value="en-US">EN</option>
                  <option value="ru-RU">RU</option>
                </select>
              </div>
              <form onSubmit={submitManual} className="flex items-center gap-2">
                <label htmlFor={`${uid}-q`} className="sr-only">Вопрос интервьюера текстом</label>
                <input
                  id={`${uid}-q`}
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                  placeholder="Или вставь вопрос текстом…"
                  autoComplete="off"
                  className="h-10 min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-[14px] text-white placeholder:text-white/35 focus:border-[#4fd39a] focus:outline-none focus:ring-4 focus:ring-[#4fd39a]/15"
                />
                <button type="submit" disabled={!manual.trim()} className="grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-[#4fd39a] disabled:opacity-40" aria-label="Показать подсказку">
                  <CornerDownLeft className="size-4" strokeWidth={1.8} />
                </button>
              </form>
              {(speech.error || !supported) && (
                <p role="alert" className="text-[12px] leading-snug text-amber-200">{speech.error ?? "Распознавание речи недоступно в этом браузере — вставляй вопросы текстом, карточка появится мгновенно."}</p>
              )}
              <p className="text-[11px] leading-snug text-white/35">Речь распознаёт браузер, Simplify ничего не записывает.</p>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function CardView({ item }: { item: Item }) {
  const { card, q, intent } = item;
  const technical = card.mode === "technical";
  return (
    <article className="flex animate-fade flex-col gap-4">
      <p className="line-clamp-3 text-[13.5px] leading-snug text-white/55">«{q}»</p>
      <span className={cx("w-fit rounded-full px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[.08em]", technical ? "bg-[#7fe3b6] text-[#0c1512]" : "bg-white/10 text-[#7fe3b6]")}>{MODE_LABEL[intent]}</span>

      {card.opener && (
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Первая фраза</span>
          <p className="font-serif text-[22px] leading-[1.18] text-white">{card.opener}</p>
        </div>
      )}

      {card.mode === "technical" && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Method · {card.method.title}</span>
          <ol className="flex flex-col gap-2">
            {card.method.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-[15px] leading-snug text-white/92">
                <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-white/10 text-[12px] text-[#7fe3b6]">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          {card.method.formula && (
            <div className="rounded-xl bg-white/6 px-3 py-2.5 ring-1 ring-white/10">
              <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Formula</span>
              <p className="num mt-0.5 text-[15px] text-[#7fe3b6]">{card.method.formula}</p>
            </div>
          )}
          {card.method.mention && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Mention</span>
              {card.method.mention.map((m) => <span key={m} className="rounded-full bg-white/8 px-2 py-0.5 text-[12px] text-white/80">{m}</span>)}
            </div>
          )}
        </div>
      )}

      {card.mode === "behavioral" && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Suggested structure</span>
          <dl className="flex flex-col gap-2">
            {card.rows.map((r) => (
              <div key={r.k} className="grid grid-cols-[64px_1fr] gap-2.5">
                <dt className="pt-0.5 font-mono text-[10.5px] uppercase tracking-[.06em] text-[#7fe3b6]">{r.k}</dt>
                <dd className="text-[14.5px] leading-snug text-white/90">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {card.mode === "general" && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Structure · {card.strategy}</span>
          <ul className="flex flex-col gap-2">
            {card.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-[15px] leading-snug text-white/90">
                <span aria-hidden className="mt-[0.5em] size-1.5 shrink-0 rounded-full bg-[#4fd39a]" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {card.keyNumber && (
        <div className="flex items-baseline gap-2 border-t border-white/10 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[.08em] text-white/40">Цифра</span>
          <span className="num text-[18px] text-[#7fe3b6]">{card.keyNumber}</span>
        </div>
      )}
    </article>
  );
}

function Idle({ listening, supported }: { listening: boolean; supported: boolean }) {
  return (
    <div className="flex h-full min-h-[40dvh] flex-col justify-center gap-3 py-6 sm:min-h-0 sm:justify-start">
      <span className="font-mono text-[10.5px] uppercase tracking-[.08em] text-white/45">{listening ? "Слушаю интервьюера" : "Ждёт вопроса"}</span>
      <p className="font-serif text-[24px] leading-[1.15] text-white">
        {listening ? "Как только вопрос закончится, здесь появится карточка." : supported ? "Нажми «Слушать», когда начнётся звонок." : "Вставь вопрос интервьюера в поле ниже."}
      </p>
      <p className="text-[13px] leading-relaxed text-white/50">Первая фраза, структура ответа и твоя цифра. Для технических вопросов — пошаговый метод.</p>
      <p className="mt-2 text-[13px] leading-relaxed text-white/40 lg:hidden">Смотри в камеру — карточка только опора.</p>
    </div>
  );
}

function Blocked({ kind, exitHref }: { kind: "employer" | "assessment" | "consent"; exitHref: string }) {
  const text = {
    employer: "Для этого раунда отмечено, что правила интервью не разрешают внешнюю помощь.",
    assessment: "Во время онлайн-тестов внешняя помощь обычно запрещена правилами платформы.",
    consent: "Interview Copilot выключен в настройках приватности.",
  }[kind];
  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      <Info className="size-6 text-[#7fe3b6]" strokeWidth={1.6} aria-hidden />
      <h2 className="font-serif text-[26px] leading-tight">Copilot не нужен в этом раунде</h2>
      <p className="text-[14.5px] leading-relaxed text-white/70">{text} Подготовься заранее — Mock Interview даёт тот же материал до звонка.</p>
      <div className="flex flex-wrap gap-2">
        <Link href={`${exitHref}?tab=mock`} className="flex h-10 items-center rounded-full bg-white px-4 text-[14px] font-medium text-[#0c1512] hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4fd39a]">Mock Interview</Link>
        {kind === "consent" && <Link href="/app/settings" className="flex h-10 items-center rounded-full border border-white/20 px-4 text-[14px] text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#4fd39a]">Настройки</Link>}
      </div>
    </div>
  );
}
