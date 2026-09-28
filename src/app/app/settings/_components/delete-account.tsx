"use client";
import { useActionState, useId, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui";
import { deleteAccount } from "@/lib/actions/account";
import { FormMessage } from "../../profile/_components/action-form";

/** Irreversible: the button stays disabled until the exact account email is typed. The server re-checks it. */
export function DeleteAccount({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined);
  const [typed, setTyped] = useState("");
  const id = useId();
  const match = typed.trim().toLowerCase() === email.toLowerCase();
  return (
    <form action={action} className="flex flex-col gap-3">
      <label htmlFor={id} className="text-[13.5px] text-ink-2">
        Для подтверждения введи email аккаунта: <span className="font-mono text-head">{email}</span>
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
          className="field sm:max-w-xs"
          aria-describedby={`${id}-hint`}
        />
        <Button type="submit" variant="danger" disabled={!match || pending}>
          {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : <Trash2 className="size-4" strokeWidth={1.7} aria-hidden />}
          {pending ? "Удаляем…" : "Удалить аккаунт навсегда"}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-[12.5px] text-ink-3">
        Удалятся профиль, факты, истории, кампании, заявки, письма, интервью, офферы и журнал. Восстановить нельзя — сначала скачай экспорт.
      </p>
      <FormMessage state={state} />
    </form>
  );
}
