"use client";
// Browser-side PWA helpers: service worker, Web Push subscription, install prompt. No server imports here.

export const SW_URL = "/sw.js";

/** Storage that never throws (private mode, blocked site data). */
export const store = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {}
  },
};

export function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Same short key as the server's endpointKey (sha256 hex, 16 chars): identifies «это устройство» in the list. */
export async function endpointKey(endpoint: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export const isIos = () =>
  typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The registration, or null when the worker can't start (unsupported, blocked, dev without HTTPS). */
export async function swRegistration(timeoutMs = 8000): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/");
    if (!existing) await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
    return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))]);
  } catch {
    return null;
  }
}

// ——— install prompt (Android / desktop Chrome) ———
// beforeinstallprompt can fire before React mounts, so it is captured at module load and kept here.

export type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // we show our own card instead of the browser's mini-infobar
    deferred = e as InstallEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export const installEvent = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  get: () => deferred,
  getServer: () => null,
  async prompt() {
    const e = deferred;
    if (!e) return "unavailable" as const;
    deferred = null; // a prompt event can be used once
    emit();
    try {
      await e.prompt();
      return (await e.userChoice).outcome;
    } catch {
      return "dismissed" as const;
    }
  },
};
