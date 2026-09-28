"use client";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui";

/** Submit button driven by an explicit pending flag (for forms submitted via startTransition, where useFormStatus doesn't apply). */
export function PendingButton({ pending, pendingText, children, disabled, ...p }: ComponentProps<typeof Button> & { pending: boolean; pendingText?: string }) {
  return (
    <Button type="submit" disabled={pending || disabled} aria-busy={pending} {...p}>
      {pending && <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {pending ? pendingText ?? children : children}
    </Button>
  );
}

/** Submit a form through a useActionState action without React's automatic form reset (keeps input on validation errors). */
export function submitVia(action: (fd: FormData) => void, start: (cb: () => void) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(() => action(fd));
  };
}
