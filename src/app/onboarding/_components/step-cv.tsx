"use client";
import Link from "next/link";
import { useState } from "react";
import { FileText } from "lucide-react";
import { saveCV, type FormState } from "@/lib/actions/onboarding";
import { CvInput } from "../../check/_components/cv-input";
import { useActionForm } from "../../_components/use-action-form";
import { FormAlert } from "./shared";

export function StepCV({ hasCv, cvText, cvFileName, factCount }: { hasCv: boolean; cvText: string; cvFileName: string; factCount: number }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveCV, undefined);
  const [chars, setChars] = useState(cvText.trim().length);
  const [replace, setReplace] = useState(!hasCv);

  return (
    <div className="glass-strong flex flex-col gap-6 p-5 sm:p-7">
      {hasCv && !replace ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-2xl border border-green/20 bg-green-soft/60 p-4">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-green"><FileText className="size-5" strokeWidth={1.7} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14.5px] font-medium text-head">{cvFileName || "CV загружено"}</div>
              <div className="text-[12.5px] text-ink-3">{factCount} фактов в Truth Layer</div>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/onboarding?step=2" className="inline-flex h-11 items-center justify-center rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">Продолжить с этим CV →</Link>
            <button type="button" onClick={() => setReplace(true)} className="inline-flex h-11 items-center justify-center rounded-full px-5 text-[14.5px] text-head hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green">Загрузить новое</button>
          </div>
          <p className="text-[12.5px] text-ink-3">При повторной загрузке подтверждённые вами факты сохранятся — заменятся только неподтверждённые.</p>
        </div>
      ) : (
        <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending}>
          <fieldset disabled={pending} className="contents">
            <CvInput initialText={hasCv ? cvText : ""} initialFileName={hasCv ? cvFileName : ""} onTextChange={(t) => setChars(t.trim().length)} />
          </fieldset>
          <FormAlert error={state?.error} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending || chars < 120} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.98] disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
              {pending ? <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />Разбираем CV…</> : "Разобрать CV →"}
            </button>
            <span className="text-[12.5px] text-ink-3" aria-live="polite">{pending ? "Извлекаем опыт, навыки и контакты" : chars < 120 ? "Добавьте CV, чтобы продолжить" : "Ничего не придумываем — только то, что написано в CV"}</span>
          </div>
        </form>
      )}
    </div>
  );
}
