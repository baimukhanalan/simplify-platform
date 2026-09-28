import Link from "next/link";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
import { completeStep } from "@/lib/actions/onboarding";
import { SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";

/** Footer for steps that save inline: marks the step done and moves on. */
export function ContinueBar({ step, label = "Далее", note, back = true }: { step: number; label?: string; note?: ReactNode; back?: boolean }) {
  return (
    <div className="mt-2 flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
      {back && step > 1 ? <BackLink step={step} /> : <span />}
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
        {note && <span className="text-[12.5px] text-ink-3 sm:text-right">{note}</span>}
        <form action={completeStep}>
          <input type="hidden" name="step" value={step} />
          <SubmitButton pendingText="Сохраняем…" className="w-full sm:w-auto">{label} →</SubmitButton>
        </form>
      </div>
    </div>
  );
}

export function BackLink({ step }: { step: number }) {
  return (
    <Link href={`/onboarding?step=${step - 1}`} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
      <ArrowLeft className="size-4" /> Назад
    </Link>
  );
}

export function FormAlert({ error, message, className }: { error?: string; message?: string; className?: string }) {
  if (!error && !message) return null;
  return error ? (
    <p role="alert" className={cx("flex items-start gap-2 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[13.5px] text-rose", className)}><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</p>
  ) : (
    <p role="status" className={cx("flex items-start gap-2 text-[13px] text-green animate-fade", className)}><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{message}</p>
  );
}

export const FieldErr = ({ id, children }: { id: string; children?: ReactNode }) =>
  children ? <span id={id} className="flex items-center gap-1.5 text-[12.5px] text-rose"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{children}</span> : null;
