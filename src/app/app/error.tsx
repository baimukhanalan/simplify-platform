"use client";
import { useEffect } from "react";
import Link from "next/link";
import { reportClientError } from "@/lib/monitoring/client";
import { useLocale } from "@/lib/i18n/client";
import { appErrorEn, appErrorKk, appErrorRu } from "@/lib/i18n/dictionaries/app-error";

// Its own tiny copy module (not the «errors» namespace): the layout doesn't ship error strings to every page.
const COPY = { ru: appErrorRu, kk: appErrorKk, en: appErrorEn };

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const c = COPY[useLocale()] ?? appErrorRu;
  useEffect(() => {
    console.error(error);
    reportClientError(error, "app");
  }, [error]);
  return (
    <div className="glass mx-auto mt-10 flex max-w-lg flex-col items-center gap-4 px-6 py-12 text-center animate-rise" role="alert">
      <span className="label">{c.appEyebrow}</span>
      <h1 className="h-serif text-[30px]">{c.appTitle}</h1>
      <p className="text-[14.5px] text-ink-3">{c.appText}</p>
      {error.digest && <p className="font-mono text-[11px] text-ink-3">{c.code.replace("{digest}", error.digest)}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button onClick={reset} className="inline-flex h-11 items-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">{c.retry}</button>
        <Link href="/app" className="glass inline-flex h-11 items-center !rounded-full px-5 text-[14.5px] text-head focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">{c.toToday}</Link>
      </div>
    </div>
  );
}
