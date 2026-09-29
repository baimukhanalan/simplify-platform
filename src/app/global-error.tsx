"use client";
import { useEffect, useSyncExternalStore } from "react";
import { LOCALE_COOKIE, fromAcceptLanguage, isLocale, type Locale } from "@/lib/i18n/config";
import { globalErrorEn, globalErrorKk, globalErrorRu } from "@/lib/i18n/dictionaries/global-error";

const COPY = { ru: globalErrorRu, kk: globalErrorKk, en: globalErrorEn };

/** No provider or server here (this replaces the root layout): the language comes from the cookie, then the browser. */
function clientLocale(): Locale {
  const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
  const c = m ? decodeURIComponent(m[1]) : null;
  return isLocale(c) ? c : fromAcceptLanguage(navigator.languages?.join(",") || navigator.language) ?? "ru";
}
const noop = () => () => {};
import { reportClientError } from "@/lib/monitoring/client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error, "global"), [error]);
  const locale = useSyncExternalStore(noop, clientLocale, (): Locale => "ru");
  const c = COPY[locale];
  return (
    <html lang={locale}>
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "linear-gradient(180deg,#dcefe6,#f5faf7)", fontFamily: "system-ui, sans-serif", color: "#233b3b" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontWeight: 400, fontSize: 32, margin: "0 0 12px" }}>{c.title}</h1>
          <p style={{ opacity: 0.7, margin: "0 0 20px" }}>{c.text}</p>
          <button onClick={reset} style={{ height: 44, padding: "0 20px", borderRadius: 999, border: 0, background: "#262424", color: "#fff", fontSize: 15, cursor: "pointer" }}>{c.retry}</button>
        </div>
      </body>
    </html>
  );
}
