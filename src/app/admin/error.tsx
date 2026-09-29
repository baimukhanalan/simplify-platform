"use client";
import { useEffect } from "react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="glass mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center" role="alert">
      <span className="label">Ошибка загрузки</span>
      <h1 className="h-serif text-[28px]">Раздел не загрузился</h1>
      <p className="text-[14.5px] text-ink-3">Данные не изменены. Попробуй ещё раз.</p>
      {error.digest && <p className="font-mono text-[11px] text-ink-3">Код: {error.digest}</p>}
      <button onClick={reset} className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Повторить</button>
    </div>
  );
}
