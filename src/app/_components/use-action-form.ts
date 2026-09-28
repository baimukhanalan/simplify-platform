"use client";
import { startTransition, useActionState, type FormEvent } from "react";

/**
 * useActionState + manual dispatch on submit. Unlike `<form action>`, this does not reset
 * uncontrolled fields after the action returns, so a validation error keeps what the user typed.
 * `formAction` is still passed to `action` for no-JS progressive enhancement.
 */
export function useActionForm<S>(action: (state: Awaited<S>, form: FormData) => S | Promise<S>, initial: Awaited<S>) {
  const [state, formAction, pending] = useActionState<S, FormData>(action, initial);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => formAction(fd));
  };
  return { state, pending, formAction, onSubmit };
}
