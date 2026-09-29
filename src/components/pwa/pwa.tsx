"use client";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Share, SquarePlus, X } from "lucide-react";
import { installEvent, isIos, isStandalone, store, swRegistration } from "@/lib/push-client";
import { isPushHiddenOn } from "@/lib/push";
import { useT } from "@/lib/i18n/client";

const SESSIONS_KEY = "simplify:pwa:sessions";
const SESSION_FLAG = "simplify:pwa:session";
const DISMISSED_KEY = "simplify:pwa:install-dismissed";
const MIN_SESSIONS = 3;

/** Counts app visits: one per browser session (sessionStorage), persisted in localStorage. */
function countSession() {
  let fresh = false;
  try {
    if (!window.sessionStorage.getItem(SESSION_FLAG)) {
      window.sessionStorage.setItem(SESSION_FLAG, "1");
      fresh = true;
    }
  } catch {}
  const n = Number(store.get(SESSIONS_KEY)) || 0;
  if (fresh) store.set(SESSIONS_KEY, String(n + 1));
  return fresh ? n + 1 : n;
}

/**
 * PWA shell for the signed-in app: registers the service worker (push + offline fallback) and, after a few visits,
 * offers to install Simplify. Mounted in the app layout only — never on the landing or login.
 */
export function Pwa() {
  const router = useRouter();

  useEffect(() => {
    void swRegistration();
    // A notification click on a tab the worker doesn't control yet: the page navigates itself (public/sw.js).
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null;
      if (d?.type !== "simplify:navigate" || typeof d.url !== "string") return;
      try {
        const u = new URL(d.url, window.location.origin);
        if (u.origin === window.location.origin) router.push(u.pathname + u.search + u.hash);
      } catch {}
    };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, [router]);

  return <InstallPrompt />;
}

type Mode = "prompt" | "ios" | null;

function InstallPrompt() {
  const t = useT();
  const pathname = usePathname();
  const deferred = useSyncExternalStore(installEvent.subscribe, installEvent.get, installEvent.getServer);
  const [eligible, setEligible] = useState<"prompt" | "ios" | "wait" | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const sessions = countSession();
    if (isStandalone() || store.get(DISMISSED_KEY) || sessions < MIN_SESSIONS) return;
    // Reading browser-only state after mount (localStorage, UA) is the point of this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEligible(isIos() ? "ios" : "wait");
  }, []);

  const mode: Mode = closed || !eligible ? null : eligible === "ios" ? "ios" : deferred ? "prompt" : null;
  // Never over a live interview Copilot.
  if (!mode || isPushHiddenOn(pathname)) return null;

  const dismiss = () => {
    store.set(DISMISSED_KEY, new Date().toISOString());
    setClosed(true);
  };
  const install = async () => {
    const outcome = await installEvent.prompt();
    if (outcome === "accepted") setClosed(true);
    else dismiss();
  };

  return (
    <aside
      aria-labelledby="pwa-install-h"
      className="glass-strong fixed inset-x-4 bottom-4 z-40 flex animate-rise gap-3.5 p-4 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-[372px]"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-[12px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h2 id="pwa-install-h" className="h-serif pr-8 text-[18px]">{t("pwa.installTitle")}</h2>
        {mode === "prompt" ? (
          <>
            <p className="text-[13.5px] text-ink-3">{t("pwa.installText")}</p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={install} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-[#fcfcfc] shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]">
                {t("pwa.install")}
              </button>
              <button type="button" onClick={dismiss} className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-medium text-head transition-colors hover:bg-white/60 focus-visible:outline-2 focus-visible:outline-green">
                {t("pwa.notNow")}
              </button>
            </div>
          </>
        ) : (
          <p className="text-[13.5px] text-ink-3">
            {t.rich("pwa.iosText", {}, {
              share: () => <Share className="inline size-4 -translate-y-px text-head" strokeWidth={1.8} aria-label={t("pwa.shareAria")} />,
              plus: () => <SquarePlus className="inline size-4 -translate-y-px text-head" strokeWidth={1.8} aria-hidden />,
            })}
          </p>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label={t("pwa.close")} className="absolute right-2 top-2 grid size-10 place-items-center rounded-full text-ink-3 transition-colors hover:bg-white/70 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <X className="size-4" strokeWidth={1.8} aria-hidden />
      </button>
    </aside>
  );
}
