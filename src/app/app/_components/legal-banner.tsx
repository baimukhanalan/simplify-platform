"use client";
import { useState, useTransition } from "react";
import { FileCheck2, Loader2 } from "lucide-react";
import { acceptLegal } from "@/lib/actions/legal";
import { Button } from "@/components/ui";
import { DocLink } from "../../_components/legal-page";

/**
 * One-time, non-blocking acceptance of the current terms / privacy / consent for accounts that haven't accepted them
 * (created before the documents, or after a version bump). Rendered by the app layout only when needed; the rest of the
 * app keeps working without an answer.
 */
export function LegalBanner() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [pending, start] = useTransition();
  if (done) return null;
  const accept = () =>
    start(async () => {
      setError(false);
      try {
        const r = await acceptLegal();
        if (r.ok) setDone(true);
        else setError(true);
      } catch {
        setError(true);
      }
    });
  return (
    <section aria-labelledby="legal-banner-h" className="mb-5 flex flex-col gap-3 rounded-2xl border border-line bg-white/70 px-4 py-3.5 text-[13.5px] text-ink-2 animate-fade sm:flex-row sm:items-center sm:gap-4 print:hidden">
      <FileCheck2 className="hidden size-5 shrink-0 text-teal sm:block" strokeWidth={1.7} aria-hidden />
      <p className="min-w-0 flex-1 leading-relaxed">
        <span id="legal-banner-h" className="font-medium text-head">Мы обновили документы. </span>
        Подтверди, что принимаешь <DocLink doc="terms" newTab>пользовательское соглашение</DocLink> и даёшь{" "}
        <DocLink doc="consent" newTab>согласие на обработку персональных данных</DocLink> по{" "}
        <DocLink doc="privacy" newTab>политике конфиденциальности</DocLink>.
        {error && <span role="alert" className="mt-1 block text-rose">Не получилось сохранить — попробуй ещё раз.</span>}
      </p>
      <Button type="button" size="sm" onClick={accept} disabled={pending} aria-busy={pending || undefined} className="shrink-0 self-start sm:self-auto">
        {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        {pending ? "Сохраняем…" : "Принимаю"}
      </Button>
    </section>
  );
}
