"use client";
import { useActionState } from "react";
import { Check } from "lucide-react";
import { selectHhResume, type HhActionState } from "@/lib/actions/hh";
import { SubmitButton } from "@/components/client";
import { useT } from "@/lib/i18n/client";

type Resume = { id: string; title: string; updated: string; visibility: string; visible: boolean };

/** Radio list of the user's hh resumes; the chosen one is what the agent applies with. */
export function HhResumeForm({ resumes, selected }: { resumes: Resume[]; selected: string }) {
  const [state, action] = useActionState<HhActionState, FormData>(selectHhResume, undefined);
  const t = useT();
  return (
    <form action={action} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 text-[13px] text-ink-3">{t("agentPage.hh.resumeLegend")}</legend>
        {resumes.map((r) => (
          <label key={r.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-white/50 px-3.5 py-3 transition-colors hover:bg-white has-[:checked]:border-green/30 has-[:checked]:bg-green-soft/40">
            <input type="radio" name="resumeId" value={r.id} defaultChecked={r.id === selected} required className="mt-1 size-4 accent-[#1a6e48]" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="break-words text-[14.5px] text-head">{r.title}</span>
              <span className="text-[12.5px] text-ink-3">
                {r.updated && <>{t("agentPage.hh.updated", { date: r.updated })} · </>}
                <span lang="ru" className={r.visible ? undefined : "text-amber"}>{r.visibility}</span>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="glass" size="sm" pendingText={t("common.saving")} className="!h-10">{t("agentPage.hh.chooseResume")}</SubmitButton>
        <span role="status" aria-live="polite" className="text-[13px]">
          {state?.error ? <span className="text-rose">{state.error}</span> : state?.ok ? <span className="inline-flex items-center gap-1 text-green"><Check className="size-3.5" aria-hidden />{t("agentPage.hh.saved")}</span> : null}
        </span>
      </div>
    </form>
  );
}
