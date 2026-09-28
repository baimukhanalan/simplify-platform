"use client";
import Link from "next/link";
import { useState } from "react";
import { Check } from "lucide-react";
import { saveAutonomy, type AutonomyState } from "@/lib/actions/agent";
import { useActionForm } from "@/app/_components/use-action-form";
import type { Autonomy } from "@/lib/engine/autonomy";
import { cx } from "@/components/ui";

type Row = { key: string; label: string; hint: string };

/**
 * Accessible on/off switch: a real checkbox (role=switch) with a visual track.
 * The invisible input fills a 48×44 hit area around the 48×28 track, so the tap target is ≥44px without a bigger visual.
 */
function Switch({ name, label, hint, checked, onChange, note }: { name: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; note?: string }) {
  const id = `sw-${name}`;
  return (
    <div className="flex items-start justify-between gap-4 py-3.5">
      <label htmlFor={id} className="flex min-w-0 cursor-pointer flex-col gap-0.5">
        <span className="text-[15px] text-head">{label}</span>
        <span id={`${id}-hint`} className="text-[13px] text-ink-3">{hint}</span>
        {note && <span className="text-[12.5px] text-amber">{note}</span>}
      </label>
      <span className="relative -mb-2 -mt-1.5 inline-flex h-11 w-12 shrink-0 items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          aria-describedby={`${id}-hint`}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
        />
        <span aria-hidden className="h-7 w-12 rounded-full bg-head/15 transition-colors peer-checked:bg-green peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-green" />
        <span aria-hidden className="pointer-events-none absolute left-1 top-3 size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </div>
  );
}

type Snapshot = string;
const snap = (v: Record<string, boolean>, sensitive: string, autoOn: boolean, threshold: number): Snapshot => JSON.stringify([v, sensitive, autoOn, threshold]);

export function AutonomyForm({ initial, rows, autoSubmitConsent }: { initial: Autonomy; rows: Row[]; autoSubmitConsent: boolean }) {
  const { state, pending, formAction, onSubmit: submit } = useActionForm<AutonomyState>(saveAutonomy, {});
  const [v, setV] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.key, Boolean(initial[r.key as keyof Autonomy])])));
  const [sensitive, setSensitive] = useState(initial.sensitive);
  // One control for two fields (shared with the Opportunities switch): on/off = submitApplications, slider = threshold.
  const [autoOn, setAutoOn] = useState(initial.submitApplications);
  const [threshold, setThreshold] = useState(initial.autoApplyMinMatch);

  // Unsaved changes = the form differs from what was last saved (the page load, or the last successful submit).
  const current = snap(v, sensitive, autoOn, threshold);
  const [initialSnap] = useState(current);
  const [submitted, setSubmitted] = useState<Snapshot>(current);
  const saved = state.ok ? submitted : initialSnap;
  const dirty = current !== saved;
  const onSubmit: typeof submit = (e) => { setSubmitted(current); submit(e); };

  const selfRows = rows.filter((r) => ["findJobs", "personalizeCv", "answerStandard"].includes(r.key));
  const askRows = rows.filter((r) => !selfRows.includes(r));

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6" aria-describedby={state.error ? "autonomy-error" : undefined}>
      <fieldset aria-labelledby="self-h" className="glass p-5 sm:p-6">
        <h2 id="self-h" className="label mb-1">Агент делает сам</h2>
        <div className="divide-y divide-line">
          {selfRows.map((r) => (
            <Switch
              key={r.key} name={r.key} label={r.label} hint={r.hint} checked={v[r.key]} onChange={(x) => setV((p) => ({ ...p, [r.key]: x }))}
            />
          ))}
        </div>
      </fieldset>

      <fieldset id="auto-apply" aria-labelledby="auto-h" className="glass scroll-mt-24 p-5 sm:p-6">
        <h2 id="auto-h" className="label mb-1">Автоподача</h2>
        <p className="mb-1 text-[13px] text-ink-3">
          Здесь — какие роли агент отправляет сам. Отправлять вообще ему разрешает согласие{" "}
          <Link href="/app/settings#autosubmit" className="inline-flex min-h-10 items-center rounded text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">«Автоподача заявок» в Приватности</Link>
          {autoSubmitConsent ? " — оно включено." : " — сейчас оно выключено."}
        </p>
        <Switch
          name="submitApplications"
          label={`Автоподача на все вакансии с Match от ${threshold}%`}
          hint={
            autoOn
              ? `Агент сам подаёт на вакансии с Match ≥ ${threshold}%. Ниже порога пакет готов, а заявка ждёт твоего Apply или Auto в Opportunities.`
              : "Выключено: агент находит и готовит пакеты, но подаёт только на вакансии с отметкой Apply или Auto."
          }
          checked={autoOn}
          onChange={setAutoOn}
          note={!autoSubmitConsent ? "Автоподача выключена в настройках приватности (согласие): агент сам ничего не отправляет, даже вакансии с Auto. Подать можно кнопкой Apply." : undefined}
        />
        <div className={cx("flex flex-col gap-2 pb-1 pt-4 transition-opacity", !autoOn && "opacity-60")}>
          <div className="flex items-center justify-between">
            <label htmlFor="threshold" className="label !text-[11px]">Порог Match</label>
            <output htmlFor="threshold" className="num text-[22px] leading-none text-head">{threshold}%</output>
          </div>
          {/* Always submitted: the threshold is kept while auto-apply is off, so switching it back on restores it. */}
          <input
            id="threshold"
            name="autoApplyMinMatch"
            type="range"
            min={50}
            max={100}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            aria-valuetext={`${threshold}%`}
            className="w-full accent-[#1a6e48]"
          />
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[.06em] text-ink-3"><span>50% · больше заявок</span><span>100% · только идеальные</span></div>
        </div>
      </fieldset>

      <fieldset aria-labelledby="ask-h" className="glass p-5 sm:p-6">
        <h2 id="ask-h" className="label mb-1">Только с твоего разрешения</h2>
        <div className="divide-y divide-line">
          {askRows.map((r) => (
            <Switch key={r.key} name={r.key} label={r.label} hint={r.hint} checked={v[r.key]} onChange={(x) => setV((p) => ({ ...p, [r.key]: x }))} />
          ))}
        </div>
      </fieldset>

      <fieldset className="glass p-5 sm:p-6" aria-describedby="sensitive-help">
        <legend className="mb-1 float-left w-full"><h2 className="label">Деликатные вопросы</h2></legend>
        <p id="sensitive-help" className="clear-both mb-4 pt-1 text-[13px] text-ink-3">Пол, этническая принадлежность, инвалидность, статус ветерана — добровольные вопросы в анкетах.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {([
            { value: "ask", title: "Спросить меня", sub: "Агент остановится и спросит тебя в «Подтверждениях»." },
            { value: "decline", title: "Отвечать «Предпочитаю не указывать»", sub: "Агент сам выберет вариант «Предпочитаю не указывать» и продолжит." },
          ] as const).map((o) => (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green",
                sensitive === o.value ? "border-green/30 bg-green-soft/60" : "border-line bg-white/60 hover:bg-white",
              )}
            >
              <input type="radio" name="sensitive" value={o.value} checked={sensitive === o.value} onChange={() => setSensitive(o.value)} className="mt-1 size-4 accent-[#1a6e48]" />
              <span className="flex flex-col gap-0.5">
                <span className="text-[14.5px] text-head">{o.title}</span>
                <span className="text-[12.5px] text-ink-3">{o.sub}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* The save bar appears only with unsaved changes (or an error to show); otherwise just a quiet status line. */}
      <div
        className={cx(
          "flex flex-wrap items-center gap-3",
          (dirty || pending || state.error) && "sticky bottom-3 z-10 rounded-[28px] border border-stroke bg-white/90 py-2 pl-2 pr-4 shadow-(--shadow-glass) backdrop-blur-xl animate-fade",
        )}
      >
        {(dirty || pending || state.error) && (
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[14.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green disabled:opacity-60"
          >
            {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
            {pending ? "Сохраняем…" : "Сохранить настройки"}
          </button>
        )}
        <span role="alert" id="autonomy-error" className="text-[13px] text-rose empty:hidden">{state.error}</span>
        <span role="status" aria-live="polite" className="text-[13px]">
          {state.error ? null : dirty && !pending ? (
            <span className="text-ink-3">Есть несохранённые изменения</span>
          ) : state.ok && !pending ? (
            <span className="inline-flex items-center gap-1.5 text-green"><Check className="size-4" aria-hidden />Сохранено. Агент применит это в следующем цикле.</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
