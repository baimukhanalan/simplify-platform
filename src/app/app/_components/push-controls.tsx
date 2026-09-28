"use client";
import { usePathname } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { X } from "lucide-react";
import { dismissNotification } from "@/lib/actions/notifications";
import { isPushHiddenOn } from "@/lib/push";
import { cx } from "@/components/ui";

/**
 * Live Copilot is a focused screen: no push moment on top of it (routes: src/lib/push.ts). `hideExact` / `hidePrefix`
 * add screens that already show this moment themselves (the Offer Desk, Today with the offer as its next step, the
 * push's own destination) — strings, since RegExps don't cross the server → client boundary.
 */
export function PushGate({ children, hideExact = [], hidePrefix = [] }: { children: ReactNode; hideExact?: string[]; hidePrefix?: string[] }) {
  const path = usePathname();
  if (isPushHiddenOn(path)) return null;
  if (path && (hideExact.includes(path) || hidePrefix.some((p) => path === p || path.startsWith(`${p}/`)))) return null;
  return <>{children}</>;
}

/** After the moment is gone, keyboard and screen-reader users land on the page's own heading, not on <body>. */
function focusMainHeading() {
  const h = document.querySelector<HTMLElement>("main h1");
  if (!h) return;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: false });
}

export function DismissButton({ id, light }: { id: string; light: boolean }) {
  const [pending, start] = useTransition();
  return (
    <form
      action={dismissNotification}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          await dismissNotification(fd);
          requestAnimationFrame(focusMainHeading);
        });
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        aria-label="Скрыть уведомление"
        title="Скрыть"
        disabled={pending}
        aria-busy={pending || undefined}
        className={cx(
          "grid size-10 place-items-center rounded-full transition-colors focus-visible:outline-2 disabled:opacity-60",
          light ? "text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-white" : "text-ink-3 hover:bg-white hover:text-head focus-visible:outline-green",
        )}
      >
        <X className="size-4" aria-hidden />
      </button>
    </form>
  );
}
