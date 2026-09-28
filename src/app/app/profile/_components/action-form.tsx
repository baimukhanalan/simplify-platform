"use client";
import { createContext, useActionState, useContext, useEffect, useRef, startTransition, type ComponentProps, type ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { FormState } from "@/lib/actions/profile";

const Pending = createContext(false);

/**
 * Form bound to a `(state, formData) => FormState` server action.
 * - Submits inside a transition so fields are NOT reset when validation fails.
 * - Exposes pending state to <FormSubmit>, which disables itself (no double submit).
 * - Announces success/error in a polite live region.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  closeDetailsOnSuccess,
  ...rest
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  closeDetailsOnSuccess?: boolean;
} & Omit<ComponentProps<"form">, "action" | "onSubmit" | "children" | "className">) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok || !ref.current) return;
    if (resetOnSuccess) ref.current.reset();
    if (closeDetailsOnSuccess) ref.current.closest("details")?.removeAttribute("open");
  }, [state, resetOnSuccess, closeDetailsOnSuccess]);

  return (
    <Pending.Provider value={pending}>
      <form
        ref={ref}
        {...rest}
        className={className}
        aria-busy={pending}
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const fd = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        <FormMessage state={state} />
      </form>
    </Pending.Provider>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  return (
    <p role="status" aria-live="polite" className={cx("flex min-h-0 items-start gap-1.5 text-[13px] empty:hidden", state?.ok ? "text-green" : "text-rose")}>
      {state?.error && (
        <>
          <CircleAlert className="mt-px size-4 shrink-0" strokeWidth={1.7} aria-hidden />
          <span key={state.at}>{state.error}</span>
        </>
      )}
      {state?.ok && state.message && (
        <>
          <CircleCheck className="mt-px size-4 shrink-0" strokeWidth={1.7} aria-hidden />
          <span key={state.at} className="animate-fade">{state.message}</span>
        </>
      )}
    </p>
  );
}

export function FormSubmit({ children, pendingText, ...p }: ComponentProps<typeof Button> & { pendingText?: string }) {
  const pending = useContext(Pending);
  return (
    <Button {...p} type="submit" disabled={pending || p.disabled}>
      {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {pending ? pendingText ?? children : children}
    </Button>
  );
}
