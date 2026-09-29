"use client";
import { useActionState, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteAccount } from "@/lib/actions/account";
import { FormMessage } from "../../profile/_components/action-form";
import { useT } from "@/lib/i18n/client";

/**
 * Irreversible: the button stays disabled until the exact account email is typed. The server re-checks it.
 * While the request runs the button and field are disabled and a second submit is ignored; an error is announced as an alert
 * (FormMessage). On success the server redirects to the landing page.
 */
export function DeleteAccount({ email }: { email: string }) {
  const t = useT();
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  const [typed, setTyped] = useState("");
  const id = useId();
  const match = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <form action={action} onSubmit={(e) => { if (pending) e.preventDefault(); }} aria-busy={pending} className="flex flex-col gap-3">
      <label htmlFor={id} className="break-words text-[13.5px] text-ink-2">
        {t("settingsPage.danger.confirmLabel")} <span className="break-all font-mono text-head">{email}</span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          name="confirmEmail"
          type="email"
          autoComplete="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          readOnly={pending}
          aria-invalid={state?.error ? true : undefined}
          className="field sm:max-w-xs"
          aria-describedby={`${id}-hint`}
        />
        <Button type="submit" variant="danger" disabled={!match || pending}>
          {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Trash2 className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? t("settingsPage.danger.deleting") : t("settingsPage.danger.deleteButton")}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-[12.5px] text-ink-3">
        {t("settingsPage.danger.hint")}
      </p>
      <p role="status" aria-live="polite" className="sr-only">{pending ? t("settingsPage.danger.deletingStatus") : ""}</p>
      <FormMessage state={state} />
    </form>
  );
}
