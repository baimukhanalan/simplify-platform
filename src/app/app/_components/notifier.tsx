"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing } from "lucide-react";

type Item = { id: string; type: string; title: string; body: string };
type Perm = NotificationPermission | "unsupported";

// Notification.permission has no change event we can rely on everywhere; we emit after requestPermission().
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
const getSnapshot = (): Perm => (typeof window === "undefined" || !("Notification" in window) ? "unsupported" : Notification.permission);
const getServerSnapshot = (): Perm => "unsupported";

const POLL_MS = 30_000;

/**
 * Polls /api/notifications while the tab is open. New unread items refresh the page (so the in-app moment appears)
 * and, when the user allowed it, fire a system notification. Items already unread at page load are only shown in-app.
 */
export function Notifier() {
  const permission = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const router = useRouter();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/notifications", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const { items } = (await r.json()) as { items: Item[] };
        if (!seen.current) {
          seen.current = new Set(items.map((i) => i.id));
          return;
        }
        const fresh = items.filter((i) => !seen.current!.has(i.id));
        if (!fresh.length) return;
        for (const i of fresh) seen.current.add(i.id);
        router.refresh();
        if ("Notification" in window && Notification.permission === "granted") {
          for (const i of fresh.slice(0, 3)) {
            const n = new Notification(`Simplify · ${i.title}`, { body: i.body, tag: i.id, icon: "/brand/favicon.png" });
            n.onclick = () => { window.focus(); n.close(); };
          }
        }
      } catch {
        // Offline or signed out: try again on the next tick.
      }
    };
    void poll();
    const t = window.setInterval(poll, POLL_MS);
    return () => { alive = false; window.clearInterval(t); };
  }, [router]);

  if (permission === "unsupported") return null;
  if (permission === "granted") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-2 text-[12px] text-ink-3" title="Системные уведомления включены: интервью, assessment и офферы">
        <BellRing className="size-4 text-green" strokeWidth={1.7} aria-hidden />
        <span className="sr-only sm:not-sr-only">Уведомления включены</span>
      </span>
    );
  }
  if (permission === "denied") {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-2 text-[12px] text-ink-3" title="Уведомления заблокированы в настройках браузера">
        <BellOff className="size-4" strokeWidth={1.7} aria-hidden />
        <span className="sr-only">Уведомления заблокированы в настройках браузера</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={async () => {
        await Notification.requestPermission();
        listeners.forEach((l) => l());
      }}
      className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-teal transition-colors hover:bg-white/70 hover:text-head focus-visible:outline-2 focus-visible:outline-green"
    >
      <Bell className="size-4" strokeWidth={1.7} aria-hidden />
      Сообщать об интервью
    </button>
  );
}
