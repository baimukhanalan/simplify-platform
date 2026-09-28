"use client";
import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import type { Offer } from "@prisma/client";
import { Field } from "@/components/ui";
import { PendingButton, submitVia } from "../../interviews/_components/pending-button";
import { addOffer, updateOffer, type OfferFormState } from "@/lib/actions/offer";
import { WORK_MODE_RU } from "../../../_components/ru";

const CURRENCIES = ["USD", "EUR", "GBP", "KZT", "CAD", "AED"];

function TermsFields({ o }: { o?: Partial<Offer> }) {
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
        <Field label="Оклад в год" hint="Годовая сумма до налогов">
          <input name="base" type="number" inputMode="numeric" min={1000} step={500} required defaultValue={o?.base ?? ""} className="field num" placeholder="68000" />
        </Field>
        <Field label="Валюта">
          <select name="currency" defaultValue={o?.currency ?? "USD"} className="field">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Бонус в год"><input name="bonus" type="number" inputMode="numeric" min={0} defaultValue={o?.bonus ?? 0} className="field num" /></Field>
        <Field label="Бонус за подписание"><input name="signingBonus" type="number" inputMode="numeric" min={0} defaultValue={o?.signingBonus ?? 0} className="field num" /></Field>
        <Field label="Акции / опционы"><input name="equity" defaultValue={o?.equity ?? ""} className="field" placeholder="0.05%, 4 года" /></Field>
      </div>
      <Field label="Бонусы и льготы" hint="Через запятую">
        <input name="benefits" defaultValue={benefits} className="field" placeholder="Медстраховка, бюджет на обучение" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Отпуск, дней"><input name="vacationDays" type="number" min={0} max={365} defaultValue={o?.vacationDays ?? 0} className="field num" /></Field>
        <Field label="Испытательный срок, месяцев"><input name="probationMonths" type="number" min={0} max={24} defaultValue={o?.probationMonths ?? 0} className="field num" /></Field>
        <Field label="Формат">
          <select name="remote" defaultValue={o?.remote ?? "remote"} className="field">
            {(["remote", "hybrid", "onsite"] as const).map((m) => <option key={m} value={m}>{WORK_MODE_RU[m]}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Релокация"><input name="relocation" defaultValue={o?.relocation ?? ""} className="field" placeholder="Пакет, виза, билеты" /></Field>
        <Field label="Срок уведомления"><input name="noticePeriod" defaultValue={o?.noticePeriod ?? ""} className="field" placeholder="2 недели" /></Field>
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
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} onSubmit={submitVia(action, startTransition)} className="flex flex-col gap-4" aria-describedby={state?.error ? uid : undefined}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Компания"><input name="company" required maxLength={120} className="field" placeholder="Brightwave Learning" /></Field>
        <Field label="Должность"><input name="role" required maxLength={160} className="field" placeholder="Junior Data Analyst" /></Field>
      </div>
      {opportunities.length > 0 && (
        <Field label="Связать с вакансией" hint="Необязательно — тогда заявка перейдёт в статус «Оффер»">
          <select name="opportunityId" defaultValue="" className="field">
            <option value="">Не связывать</option>
            {opportunities.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </Field>
      )}
      <TermsFields />
      <Status state={state} okText="Оффер добавлен — он появился выше." id={uid} />
      <div><PendingButton pending={pending} pendingText="Добавляем…">Добавить оффер</PendingButton></div>
    </form>
  );
}

export function EditTermsForm({ offer }: { offer: Offer }) {
  const [state, action, pending] = useActionState<OfferFormState, FormData>(updateOffer, undefined);
  const uid = useId();
  return (
    <form onSubmit={submitVia(action, startTransition)} className="mt-4 flex flex-col gap-4" aria-describedby={state?.error ? uid : undefined}>
      <input type="hidden" name="offerId" value={offer.id} />
      <TermsFields o={offer} />
      <Status state={state} okText="Условия обновлены." id={uid} />
      <div><PendingButton size="sm" pending={pending} pendingText="Сохраняем…" className="!h-10">Сохранить условия</PendingButton></div>
    </form>
  );
}
