"use client";
import { useEffect, useState } from "react";
import { ArrowRight, AlertCircle, Check } from "lucide-react";
import { runCareerCheck, type FormState } from "@/lib/actions/onboarding";
import { cx } from "@/components/ui";
import { CvInput } from "./cv-input";
import { useActionForm } from "../../_components/use-action-form";
import { useT } from "@/lib/i18n/client";

const STAGES = ["stage1", "stage2", "stage3", "stage4"] as const;

export function CheckForm({ roles }: { roles: string[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(runCareerCheck, undefined);
  const [chars, setChars] = useState(0);
  const ready = chars >= 120;
  const t = useT();

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6" aria-busy={pending}>
      <fieldset disabled={pending} className="flex flex-col gap-6 disabled:opacity-60">
        <div role="group" aria-labelledby="cv-label" className="flex flex-col gap-2.5">
          <div id="cv-label" className="label">{t("check.formCv")}</div>
          <CvInput onTextChange={(t) => setChars(t.trim().length)} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="target" className="label">{t("check.formRole")} <span className="normal-case tracking-normal text-ink-4">{t("check.optional")}</span></label>
          <input id="target" name="target" list="check-roles" defaultValue={state?.fields?.target ?? ""} maxLength={120} placeholder={t("check.rolePlaceholder")} className="field" autoComplete="off" aria-describedby="target-hint" />
          <datalist id="check-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
          <span id="target-hint" className="text-[12px] text-ink-3">{t("check.roleHint")}</span>
        </div>
      </fieldset>

      {state?.error && (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[13.5px] text-rose"><AlertCircle className="mt-0.5 size-4 shrink-0" />{state.error}</p>
      )}

      {pending ? <Stages /> : (
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
          <button type="submit" disabled={!ready} className="inline-flex h-12 items-center gap-2 rounded-full bg-cta px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.98] disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            {t("check.submit")} <ArrowRight className="size-4" />
          </button>
          <span className="text-[12.5px] text-ink-3">{ready ? t("check.readyHint") : t("check.needCv")}</span>
        </div>
      )}
    </form>
  );
}

function Stages() {
  const t = useT();
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((v) => Math.min(STAGES.length - 1, v + 1)), 1600);
    return () => clearInterval(timer);
  }, []);
  return (
    <ol role="status" aria-live="polite" className="flex flex-col gap-2.5 rounded-2xl border border-line bg-white/60 p-4">
      {STAGES.map((st, k) => (
        <li key={st} className={cx("flex items-center gap-2.5 text-[13.5px] transition-colors", k < i ? "text-ink-3" : k === i ? "text-head" : "text-ink-4")}>
          <span className={cx("grid size-5 place-items-center rounded-full", k < i ? "bg-green text-white" : k === i ? "border-2 border-green border-t-transparent animate-spin" : "border border-line")} aria-hidden>
            {k < i && <Check className="size-3" strokeWidth={2.5} />}
          </span>
          {t(`check.${st}`)}
          {k === i && <span className="sr-only">{t("check.inProgress")}</span>}
        </li>
      ))}
    </ol>
  );
}
