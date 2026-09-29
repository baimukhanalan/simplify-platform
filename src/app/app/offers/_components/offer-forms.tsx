"use client";
import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import type { Offer } from "@prisma/client";
import { Field } from "@/components/ui";
import { PendingButton, submitVia } from "../../interviews/_components/pending-button";
import { addOffer, updateOffer, type OfferFormState } from "@/lib/actions/offer";
import { useT } from "@/lib/i18n/client";

const CURRENCIES = ["USD", "EUR", "GBP", "KZT", "CAD", "AED"];

function TermsFields({ o }: { o?: Partial<Offer> }) {
  const t = useT();
  const benefits = (() => {
    try {
      return (JSON.parse(o?.benefits ?? "[]") as string[]).join(", ");
    } catch {
      return "";
    }
  })();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field label={t("offersPage.form.baseYear")} hint={t("offersPage.form.baseHint")}>
          <input name="base" type="number" inputMode="numeric" min={1000} step={500} required defaultValue={o?.base ?? ""} className="field num" placeholder="68000" />
        </Field>
        <Field label={t("offersPage.form.currency")}>
          <select name="currency" defaultValue={o?.currency ?? "USD"} className="field">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("offersPage.form.bonusYear")}><input name="bonus" type="number" inputMode="numeric" min={0} defaultValue={o?.bonus ?? 0} className="field num" /></Field>
        <Field label={t("offersPage.form.signing")}><input name="signingBonus" type="number" inputMode="numeric" min={0} defaultValue={o?.signingBonus ?? 0} className="field num" /></Field>
        <Field label={t("offersPage.form.equity")}><input name="equity" defaultValue={o?.equity ?? ""} className="field" placeholder={t("offersPage.form.equityPlaceholder")} /></Field>
      </div>
      <Field label={t("offersPage.form.benefits")} hint={t("offersPage.form.benefitsHint")}>
        <input name="benefits" defaultValue={benefits} className="field" placeholder={t("offersPage.form.benefitsPlaceholder")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("offersPage.form.vacationDays")}><input name="vacationDays" type="number" min={0} max={365} defaultValue={o?.vacationDays ?? 0} className="field num" /></Field>
        <Field label={t("offersPage.form.probationMonths")}><input name="probationMonths" type="number" min={0} max={24} defaultValue={o?.probationMonths ?? 0} className="field num" /></Field>
        <Field label={t("offersPage.form.format")}>
          <select name="remote" defaultValue={o?.remote ?? "remote"} className="field">
            {(["remote", "hybrid", "onsite"] as const).map((m) => <option key={m} value={m}>{t(`offersPage.workMode.${m}`)}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("offersPage.form.relocation")}><input name="relocation" defaultValue={o?.relocation ?? ""} className="field" placeholder={t("offersPage.form.relocationPlaceholder")} /></Field>
        <Field label={t("offersPage.form.notice")}><input name="noticePeriod" defaultValue={o?.noticePeriod ?? ""} className="field" placeholder={t("offersPage.form.noticePlaceholder")} /></Field>
      </div>
    </>
  );
}

function Status({ state, okText, id }: { state: OfferFormState; okText: string; id: string }) {
  if (state?.error) return <p id={id} role="alert" className="rounded-xl bg-rose-soft px-3 py-2 text-[13.5px] text-rose">{state.error}</p>;
  if (state?.ok) return <p role="status" className="rounded-xl bg-green-soft px-3 py-2 text-[13.5px] text-green">{okText}</p>;
  return null;
}

export function AddOfferForm({ opportunities }: { opportunities: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<OfferFormState, FormData>(addOffer, undefined);
  const uid = useId();
  const form = useRef<HTMLFormElement>(null);
  const t = useT();
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} onSubmit={submitVia(action, startTransition)} className="flex flex-col gap-4" aria-describedby={state?.error ? uid : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("offersPage.form.company")}><input name="company" required maxLength={120} className="field" placeholder="Brightwave Learning" /></Field>
        <Field label={t("offersPage.form.role")}><input name="role" required maxLength={160} className="field" placeholder="Junior Data Analyst" /></Field>
      </div>
      {opportunities.length > 0 && (
        <Field label={t("offersPage.form.link")} hint={t("offersPage.form.linkHint")}>
          <select name="opportunityId" defaultValue="" className="field">
            <option value="">{t("offersPage.form.noLink")}</option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      )}
      <TermsFields />
      <Status state={state} okText={t("offersPage.form.added")} id={uid} />
      <div><PendingButton pending={pending} pendingText={t("offersPage.form.adding")}>{t("offersPage.form.add")}</PendingButton></div>
    </form>
  );
}

export function EditTermsForm({ offer }: { offer: Offer }) {
  const [state, action, pending] = useActionState<OfferFormState, FormData>(updateOffer, undefined);
  const uid = useId();
  const t = useT();
  return (
    <form onSubmit={submitVia(action, startTransition)} className="mt-4 flex flex-col gap-4" aria-describedby={state?.error ? uid : undefined}>
      <input type="hidden" name="offerId" value={offer.id} />
      <TermsFields o={offer} />
      <Status state={state} okText={t("offersPage.form.updated")} id={uid} />
      <div><PendingButton size="sm" pending={pending} pendingText={t("offersPage.form.saving")} className="!h-10">{t("offersPage.form.save")}</PendingButton></div>
    </form>
  );
}
