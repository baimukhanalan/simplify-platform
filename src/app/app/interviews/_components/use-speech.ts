"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/config";
import type { MessageKey } from "@/lib/i18n/translator";

// Minimal Web Speech API typings (not in every TS lib.dom version).
type SRAlternative = { transcript: string };
type SRResult = { isFinal: boolean; 0: SRAlternative; length: number };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SRErrorEvent = { error: string };
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SRCtor = new () => SR;

const getCtor = (): SRCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const noop = () => () => {};
/** Feature detection that is stable across SSR/hydration (false on the server). */
export function useSpeechSupported() {
  return useSyncExternalStore(noop, () => Boolean(getCtor()), () => false);
}

/** Russian messages by engine error code (kept for compatibility; the UI shows the translated `speech.errors.*`). */
export const SPEECH_ERROR: Record<string, string> = {
  "not-allowed": "Доступ к микрофону запрещён. Разреши его в настройках браузера или вводи текст.",
  "service-not-allowed": "Распознавание речи недоступно в этом браузере. Используй ввод текста.",
  "audio-capture": "Микрофон не найден.",
  network: "Сервис распознавания речи недоступен (сеть). Используй ввод текста.",
};

/** Engine error code → message key in the «interviewPractice» namespace. */
const ERROR_KEY: Record<string, MessageKey> = {
  "not-allowed": "interviewPractice.speech.errors.notAllowed",
  "service-not-allowed": "interviewPractice.speech.errors.serviceNotAllowed",
  "audio-capture": "interviewPractice.speech.errors.audioCapture",
  network: "interviewPractice.speech.errors.network",
};

export type SpeechLang = "ru-RU" | "kk-KZ" | "en-US";
/** The recognition language that matches the interface language (the user's own language). */
export const SPEECH_TAG: Record<Locale, SpeechLang> = { ru: "ru-RU", kk: "kk-KZ", en: "en-US" };
/** Recognition languages offered in a selector, the default first. `interview`: the interview language (English) leads. */
export function speechLangs(locale: Locale, interview: boolean): SpeechLang[] {
  if (interview) return locale === "kk" ? ["en-US", "ru-RU", "kk-KZ"] : ["en-US", "ru-RU"];
  if (locale === "kk") return ["kk-KZ", "ru-RU", "en-US"];
  return locale === "en" ? ["en-US", "ru-RU"] : ["ru-RU", "en-US"];
}
/** Option label keys for the selectors (full and short). */
export const SPEECH_LANG_KEY: Record<SpeechLang, "ru" | "kk" | "en"> = { "ru-RU": "ru", "kk-KZ": "kk", "en-US": "en" };
/** Kazakh recognition is missing in some browsers: fall back to Russian (the closest widely supported language). */
const FALLBACK: Record<string, string> = { "kk-KZ": "ru-RU" };

function flushEnd(waiters: { current: (() => void)[] }) {
  const w = waiters.current;
  waiters.current = [];
  w.forEach((f) => f());
}

/**
 * Browser speech recognition. Audio is handled by the browser's speech engine; Simplify never records it.
 * - `onFinal(text)` fires for each final segment.
 * - `onInterim(text)` fires with the current in-progress segment.
 * `continuous` keeps listening (auto-restarts when the engine stops on silence).
 * `stop()` returns a promise that resolves after the last final segment has been delivered.
 */
export function useSpeech(opts: { lang: string; continuous?: boolean; onFinal: (text: string) => void; onInterim?: (text: string) => void }) {
  const t = useT();
  // Messages in the interface language when the «interviewPractice» namespace is provided, Russian otherwise.
  const tr = (key: MessageKey, ru: string, params?: Record<string, string>) => (t.has(key) ? t(key, params) : ru);
  const trRef = useRef(tr);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set when the chosen language isn't recognized by this browser and a fallback language is used instead. */
  const [notice, setNotice] = useState<string | null>(null);
  // The language a fallback replaced («kk-KZ») → used instead while that language stays selected.
  const fallbackFor = useRef<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
    trRef.current = tr;
  });

  // Resolvers waiting for the current recognizer's onend (stop() → final segment delivered).
  const endWaiters = useRef<(() => void)[]>([]);

  /** Stop listening. The promise resolves once the engine has delivered its last final segment (onend), or after 2 s. */
  const stop = useCallback((): Promise<void> => {
    wantRef.current = false;
    setListening(false);
    const rec = recRef.current;
    if (!rec) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 2000);
      endWaiters.current.push(() => { clearTimeout(timer); resolve(); });
      try {
        rec.stop();
      } catch {
        recRef.current = null;
        flushEnd(endWaiters);
      }
    });
  }, []);

  const begin = useCallback(function run(override?: string) {
    const tr = trRef.current;
    const Ctor = getCtor();
    if (!Ctor) {
      setError(tr("interviewPractice.speech.errors.unsupported", "Распознавание речи не поддерживается этим браузером (нужен Chrome, Edge или Safari). Используй ввод текста."));
      return;
    }
    const chosen = cb.current.lang;
    if (fallbackFor.current && fallbackFor.current !== chosen) {
      fallbackFor.current = null;
      setNotice(null);
    }
    const lang = override ?? (fallbackFor.current === chosen ? FALLBACK[chosen] ?? chosen : chosen);
    // Unsupported language → retry once with the fallback and say so.
    const fallBack = () => {
      const alt = FALLBACK[chosen];
      if (!alt || lang === alt) return false;
      fallbackFor.current = chosen;
      setNotice(tr("interviewPractice.speech.kkFallback", "В этом браузере нет распознавания казахского — используется русский."));
      run(alt);
      return true;
    };
    // Replace any previous recognizer; its late events are ignored by the identity guards below.
    const prev = recRef.current;
    recRef.current = null;
    flushEnd(endWaiters);
    prev?.abort();
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = cb.current.continuous ?? true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      if (recRef.current !== rec) return;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) cb.current.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      cb.current.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (recRef.current !== rec) return;
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "language-not-supported" && fallBack()) return;
      const key = ERROR_KEY[e.error];
      setError(key ? tr(key, SPEECH_ERROR[e.error]) : tr("interviewPractice.speech.errors.generic", `Ошибка распознавания: ${e.error}`, { code: e.error }));
      wantRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      // A stale recognizer (replaced by start() or unmounted) must never restart itself or touch state.
      if (recRef.current !== rec) return;
      // Engines stop after silence; keep going while the user wants to listen.
      if (wantRef.current && (cb.current.continuous ?? true)) {
        try {
          rec.start();
          return;
        } catch {
          /* fallthrough */
        }
      }
      wantRef.current = false;
      recRef.current = null;
      setListening(false);
      flushEnd(endWaiters);
    };
    recRef.current = rec;
    wantRef.current = true;
    setError(null);
    try {
      rec.start();
      setListening(true);
    } catch {
      wantRef.current = false;
      recRef.current = null;
      if (fallBack()) return;
      setError(tr("interviewPractice.speech.errors.startFailed", "Не удалось запустить микрофон."));
    }
  }, []);

  const start = useCallback(() => begin(), [begin]);

  useEffect(() => () => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    flushEnd(endWaiters);
    rec?.abort();
  }, []);

  return { listening, error, notice, start, stop, clearError: () => setError(null) };
}
