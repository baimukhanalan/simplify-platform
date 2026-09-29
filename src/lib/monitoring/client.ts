"use client";

// Browser side of error monitoring: error boundaries (error.tsx / global-error.tsx) report here → POST /api/monitoring/client.
// Errors with a `digest` come from the server and were already recorded there by onRequestError (src/instrumentation.ts),
// so only browser-side errors are sent. Once per distinct error per page load, at most 5 per load; fire-and-forget (keepalive survives navigation).

const sent = new Set<string>();

export function reportClientError(error: Error & { digest?: string }, boundary: string) {
  try {
    if (typeof window === "undefined" || error?.digest) return;
    const key = `${boundary}|${error?.digest ?? ""}|${error?.message ?? ""}`;
    if (sent.has(key) || sent.size >= 5) return;
    sent.add(key);
    const body = JSON.stringify({
      message: String(error?.message || error?.name || "Error").slice(0, 1000),
      name: String(error?.name || "Error").slice(0, 80),
      stack: String(error?.stack ?? "").slice(0, 6000),
      route: window.location.pathname.slice(0, 300),
      boundary,
    });
    void fetch("/api/monitoring/client", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => undefined);
  } catch {
    /* reporting must never break the error screen */
  }
}
