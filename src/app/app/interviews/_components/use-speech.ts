"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

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

export const SPEECH_ERROR: Record<string, string> = {
  "not-allowed": "Доступ к микрофону запрещён. Разрешите его в настройках браузера или вводите текст.",
  "service-not-allowed": "Распознавание речи недоступно в этом браузере. Используйте ввод текста.",
  "audio-capture": "Микрофон не найден.",
  network: "Сервис распознавания речи недоступен (сеть). Используйте ввод текста.",
};

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
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
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

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Распознавание речи не поддерживается этим браузером (нужен Chrome, Edge или Safari). Используйте ввод текста.");
      return;
    }
    // Replace any previous recognizer; its late events are ignored by the identity guards below.
    const prev = recRef.current;
    recRef.current = null;
    flushEnd(endWaiters);
    prev?.abort();
    const rec = new Ctor();
    rec.lang = cb.current.lang;
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
      setError(SPEECH_ERROR[e.error] ?? `Ошибка распознавания: ${e.error}`);
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
      setError("Не удалось запустить микрофон.");
      wantRef.current = false;
      recRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    flushEnd(endWaiters);
    rec?.abort();
  }, []);

  return { listening, error, start, stop, clearError: () => setError(null) };
}
