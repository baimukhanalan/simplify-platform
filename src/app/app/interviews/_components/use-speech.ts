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

/**
 * Browser speech recognition. Audio is handled by the browser's speech engine; Simplify never records it.
 * - `onFinal(text)` fires for each final segment.
 * - `onInterim(text)` fires with the current in-progress segment.
 * `continuous` keeps listening (auto-restarts when the engine stops on silence).
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

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      setError("Распознавание речи не поддерживается этим браузером (нужен Chrome, Edge или Safari). Используйте ввод текста.");
      return;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = cb.current.lang;
    rec.continuous = cb.current.continuous ?? true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) cb.current.onFinal(r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      cb.current.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(SPEECH_ERROR[e.error] ?? `Ошибка распознавания: ${e.error}`);
      wantRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
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
      setListening(false);
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
    }
  }, []);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { listening, error, start, stop, clearError: () => setError(null) };
}
