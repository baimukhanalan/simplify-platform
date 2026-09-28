"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "@/components/ui";

type Tone = "accept" | "decline";

/**
 * Two-step irreversible action: a trigger reveals an inline confirmation with the real form.
 * Focus moves into the confirmation, Escape / "Отмена" return it to the trigger,
 * and the submit button locks on the first submit (pending + a ref guard against double clicks).
 */
export function ConfirmAction({ action, offerId, tone, trigger, title, children, confirmLabel, pendingLabel, onDark = tone === "accept" }: {
  action: (form: FormData) => void | Promise<void>;
  offerId: string;
  tone: Tone;
  trigger: ReactNode;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  /** Rendered on the dark decision block: the quiet trigger needs light text. */
  onDark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sent = useRef(false);
  const id = useId();

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    sent.current = false;
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="flex flex-col gap-3">
      {!open && (
        <button
          ref={triggerRef}
          type="button"
          aria-expanded={false}
          aria-controls={id}
          onClick={() => setOpen(true)}
          className={cx(
            "inline-flex w-fit items-center justify-center gap-2 rounded-full font-medium transition-all focus-visible:outline-2 focus-visible:outline-offset-3 active:scale-[.98]",
            tone === "accept"
              ? "h-13 bg-[#7fe3b6] px-7 text-[15.5px] text-[#0c1512] shadow-[0_8px_30px_rgb(127_227_182/.25)] hover:bg-[#9aeec7] focus-visible:outline-[#7fe3b6]"
              : onDark
                ? "h-13 px-5 text-[14px] text-white/70 underline-offset-4 hover:text-white hover:underline focus-visible:outline-[#7fe3b6]"
                : "h-11 px-5 text-[14px] text-ink-3 underline-offset-4 hover:text-head hover:underline focus-visible:outline-green",
          )}
        >
          {trigger}
        </button>
      )}
      {open && (
        <div
          id={id}
          ref={panelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby={`${id}-t`}
          onKeyDown={(e) => { if (e.key === "Escape") close(); }}
          className={cx(
            "animate-fade rounded-2xl border p-4 outline-none sm:p-5",
            tone === "accept" ? "border-[#7fe3b6]/30 bg-white/[.06]" : "border-rose/20 bg-rose-soft",
          )}
        >
          <p id={`${id}-t`} className={cx("text-[15px] font-medium", tone === "accept" ? "text-white" : "text-head")}>{title}</p>
          <div className={cx("mt-1.5 text-[14px] leading-relaxed", tone === "accept" ? "text-white/70" : "text-ink-2")}>{children}</div>
          <form
            action={action}
            onSubmit={(e) => {
              if (sent.current) e.preventDefault();
              sent.current = true;
            }}
            className="mt-4 flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="offerId" value={offerId} />
            <ConfirmSubmit tone={tone} pendingLabel={pendingLabel}>{confirmLabel}</ConfirmSubmit>
            <CancelButton tone={tone} onClick={close} />
          </form>
        </div>
      )}
    </div>
  );
}

function ConfirmSubmit({ tone, pendingLabel, children }: { tone: Tone; pendingLabel: string; children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={cx(
        "inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[14.5px] font-medium transition-all disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-3 active:scale-[.98]",
        tone === "accept" ? "bg-[#7fe3b6] text-[#0c1512] hover:bg-[#9aeec7] focus-visible:outline-[#7fe3b6]" : "bg-rose text-white hover:brightness-110 focus-visible:outline-green",
      )}
    >
      {pending && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {pending ? pendingLabel : children}
    </button>
  );
}

function CancelButton({ tone, onClick }: { tone: Tone; onClick: () => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cx(
        "inline-flex h-11 items-center rounded-full px-4 text-[14px] transition disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2",
        tone === "accept" ? "text-white/75 hover:bg-white/10 hover:text-white focus-visible:outline-[#7fe3b6]" : "text-ink-2 hover:bg-white/60 focus-visible:outline-green",
      )}
    >
      Отмена
    </button>
  );
}
