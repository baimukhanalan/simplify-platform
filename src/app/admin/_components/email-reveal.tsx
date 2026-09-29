"use client";
import { useState, useTransition } from "react";
import { Eye, EyeOff } from "lucide-react";
import { adminRevealEmail } from "@/lib/actions/admin";

/** Masked e-mail; the full address is fetched only on an explicit «показать» click (never sent with the page). */
export function EmailReveal({ userId, masked }: { userId: string; masked: string }) {
  const [email, setEmail] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = () => {
    if (shown) return setShown(false);
    if (email) return setShown(true);
    start(async () => {
      const r = await adminRevealEmail(userId).catch(() => ({ error: "Не удалось загрузить", email: undefined }));
      if (r.email) { setEmail(r.email); setShown(true); setErr(null); } else setErr(r.error ?? "Ошибка");
    });
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-[12px] text-ink-3">
      <span className="truncate font-mono" aria-live="polite">{shown && email ? email : masked}</span>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={shown}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11.5px] text-teal hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green disabled:opacity-60"
      >
        {shown ? <EyeOff className="size-3" strokeWidth={1.8} /> : <Eye className="size-3" strokeWidth={1.8} />}
        {pending ? "…" : shown ? "скрыть" : "показать"}
      </button>
      {err && <span role="alert" className="text-rose">{err}</span>}
    </span>
  );
}
