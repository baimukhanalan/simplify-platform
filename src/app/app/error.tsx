"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="glass mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center animate-rise" role="alert">
      <span className="label">Что-то пошло не так</span>
      <h1 className="h-serif text-[30px]">Экран не загрузился</h1>
      <p className="text-[14.5px] text-ink-3">Агент при этом продолжает работать. Попробуй ещё раз — если не поможет, вернись в Today.</p>
      {error.digest && <p className="font-mono text-[11px] text-ink-4">Код: {error.digest}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Повторить</button>
        <Link href="/app" className="glass inline-flex h-11 items-center !rounded-full px-5 text-[14.5px] text-head focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">В Today</Link>
      </div>
    </div>
  );
}
