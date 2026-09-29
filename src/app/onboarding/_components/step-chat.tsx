"use client";
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Pencil, X, Check } from "lucide-react";
import { answerTurn, completeStep, deleteFact, updateFactBasics, type FormState } from "@/lib/actions/onboarding";
import type { ChatTurn } from "@/lib/onboarding";
import { SubmitButton } from "@/components/client";
import { cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { BackLink, FormAlert } from "./shared";
import { fmtFactPeriod } from "@/lib/ru";
import { useT } from "@/lib/i18n/client";
import type { T } from "@/lib/i18n/translator";

type Position = { id: string; kind: string; title: string; org: string; startDate: string; endDate: string };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// Option labels built in lib that still carry English; mapped here until the source is fixed.
const optionLabel = (label: string, t: T) => (label === "Нет, только remote" ? t("onboarding.onlyRemote") : label);

/**
 * Step 2 as a conversation: the agent summarises what it parsed, lets the user fix it,
 * then asks one question at a time. Every answer is saved immediately (answerTurn).
 */
export function StepChat({ name, years, skills, skillCount, positions, turns }: { name: string; years: number; skills: string[]; skillCount: number; positions: Position[]; turns: ChatTurn[] }) {
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const [interacted, setInteracted] = useState(false); // move focus only after the user starts answering, not on page load
  const t = useT();
  /** Questions come from src/lib/onboarding.ts in Russian for now: marked lang="ru" in other languages. */
  const engine = t.locale === "ru" ? undefined : "ru";
  const answerOf = (x: ChatTurn) => (x.id in local ? local[x.id] : x.answer);
  const firstOpen = turns.findIndex((x) => answerOf(x) === null);
  const current = editing ?? (firstOpen >= 0 ? turns[firstOpen].id : null);
  const visible = firstOpen >= 0 ? turns.slice(0, firstOpen + 1) : turns;
  const answeredCount = turns.filter((x) => answerOf(x) !== null).length;
  const allDone = firstOpen < 0;

  // "Typing…" before each new question (skipped with reduced motion).
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set(visible.map((x) => x.id)));
  useEffect(() => {
    if (!current || revealed.has(current)) return;
    const delay = reduced() ? 0 : 650;
    const timer = setTimeout(() => setRevealed((r) => new Set(r).add(current)), delay);
    return () => clearTimeout(timer);
  }, [current, revealed]);

  const send = (turn: ChatTurn, value: string) => {
    setInteracted(true);
    setError(null);
    setSavingId(turn.id);
    const prev = local[turn.id];
    setLocal((l) => ({ ...l, [turn.id]: value }));
    setEditing(null);
    start(async () => {
      try {
        const res = await answerTurn(turn.id, value);
        if (!res.ok) throw new Error(res.error);
      } catch (e) {
        setLocal((l) => { const n = { ...l }; if (prev === undefined) delete n[turn.id]; else n[turn.id] = prev; return n; });
        setEditing(turn.id);
        setError({ id: turn.id, text: e instanceof Error && e.message ? e.message : t("onboarding.saveFailed") });
      } finally {
        setSavingId(null);
      }
    });
  };

  const works = positions.filter((p) => p.kind !== "education");

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-strong p-4 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
          <span className="flex items-center gap-2 text-[13px] text-ink-2"><AgentMark />{t("onboarding.agentName")}</span>
          <span className="num text-[12px] text-ink-3" aria-label={t("onboarding.answered", { n: String(answeredCount), total: String(turns.length) })}>{answeredCount}/{turns.length}</span>
        </div>

        <ol role="log" aria-live="polite" aria-label={t("onboarding.dialogAria")} className="flex flex-col gap-4">
          <AgentBubble>
            <p>{years > 0 ? t.rich("onboarding.helloYears", { name, years: t("onboarding.years", { n: Math.round(years * 10) / 10 }) }, { b: (c) => <b className="font-medium text-head">{c}</b> }) : t("onboarding.hello", { name })}</p>
            {skills.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {skills.map((s) => <span key={s} className="rounded-full border border-line bg-white/80 px-2.5 py-0.5 text-[12.5px] text-ink-2">{s}</span>)}
                {skillCount > skills.length && <span className="px-1 py-0.5 text-[12.5px] text-ink-3">+{skillCount - skills.length}</span>}
              </div>
            )}
          </AgentBubble>

          <AgentBubble>
            {positions.length ? (
              <>
                <p>{t("onboarding.foundExperience")}</p>
                <Positions items={positions} />
              </>
            ) : (
              <p>{t("onboarding.noExperience")}</p>
            )}
          </AgentBubble>

          {visible.map((turn) => {
            const a = answerOf(turn);
            const isCurrent = turn.id === current;
            if (!revealed.has(turn.id) && isCurrent) return <Typing key={turn.id} />;
            return (
              <li key={turn.id} className="flex flex-col gap-2.5">
                <AgentBubble as="div">
                  <p lang={engine}>{turn.prompt}</p>
                  {turn.hint && <p lang={engine} className="mt-1 text-[12.5px] text-ink-3">{turn.hint}</p>}
                </AgentBubble>
                {isCurrent && (editing !== null || a === null) ? (
                  <Composer turn={turn} autoFocus={interacted} initial={a ?? ""} busy={savingId === turn.id} error={error?.id === turn.id ? error.text : ""} onSend={(v) => send(turn, v)} onCancel={editing ? () => { setEditing(null); setError(null); } : undefined} />
                ) : a !== null ? (
                  <UserBubble onEdit={savingId ? undefined : () => { setInteracted(true); setError(null); setEditing(turn.id); }} saving={savingId === turn.id}>
                    {a === "" ? <span className="text-white/70">{t("onboarding.skipQuestion")}</span> : optionLabel(turn.options?.find((o) => o.value === a)?.label ?? a, t)}
                  </UserBubble>
                ) : null}
              </li>
            );
          })}

          {allDone && !editing && (
            <AgentBubble>
              <p>{works.length ? t("onboarding.thanksWorks") : t("onboarding.thanks")}</p>
            </AgentBubble>
          )}
        </ol>
      </div>

      <div className="flex flex-col-reverse items-stretch gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <BackLink step={2} />
        <form action={completeStep} className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-4">
          <input type="hidden" name="step" value={2} />
          {!allDone && <span className="text-[12.5px] text-ink-3 sm:text-right">{t("onboarding.finishLater")}</span>}
          <SubmitButton pendingText={t("common.saving")} variant={allDone ? "primary" : "glass"} className="w-full sm:w-auto">{allDone ? t("onboarding.toGoalArrow") : answeredCount > 0 ? t("onboarding.next") : t("onboarding.nextNoAnswers")}</SubmitButton>
        </form>
      </div>
    </div>
  );
}

/* ——— bubbles ——— */

function AgentMark() {
  return <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-cta font-serif text-[12px] leading-none text-white shadow-(--shadow-cta)">S</span>;
}

function AgentBubble({ children, as = "li" }: { children: ReactNode; as?: "li" | "div" }) {
  const Tag = as;
  return (
    <Tag className="flex max-w-[92%] items-start gap-2.5 animate-rise sm:max-w-[80%]">
      <span className="mt-1"><AgentMark /></span>
      <div className="min-w-0 rounded-[18px] rounded-tl-md border border-stroke bg-white/85 px-4 py-3 text-[14.5px] leading-relaxed text-ink-2 shadow-[0_1px_2px_rgb(0_0_0/.04)]">{children}</div>
    </Tag>
  );
}

function UserBubble({ children, onEdit, saving }: { children: ReactNode; onEdit?: () => void; saving?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-center justify-end gap-2 animate-fade">
      {onEdit && (
        <button type="button" onClick={onEdit} className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[12px] text-ink-3 hover:bg-white/70 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
          <Pencil className="size-3" aria-hidden />{t("onboarding.edit")}
        </button>
      )}
      <div className="max-w-[80%] rounded-[18px] rounded-tr-md bg-cta px-4 py-2.5 text-[14.5px] text-white shadow-(--shadow-cta)">
        {children}
        {saving && <span className="sr-only"> {t("onboarding.savingSr")}</span>}
      </div>
    </div>
  );
}

function Typing() {
  const t = useT();
  return (
    <li className="flex items-center gap-2.5" aria-label={t("onboarding.typing")}>
      <AgentMark />
      <span className="flex gap-1 rounded-full border border-stroke bg-white/85 px-3.5 py-3" aria-hidden>
        {[0, 1, 2].map((i) => <span key={i} className="size-1.5 animate-pulse rounded-full bg-teal" style={{ animationDelay: `${i * 160}ms` }} />)}
      </span>
    </li>
  );
}

/* ——— answer composer ——— */

function Composer({ turn, initial, busy, error, onSend, onCancel, autoFocus }: { turn: ChatTurn; initial: string; busy: boolean; error: string; onSend: (v: string) => void; onCancel?: () => void; autoFocus: boolean }) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const t = useT();
  useEffect(() => { if (autoFocus) ref.current?.querySelector<HTMLElement>("textarea, button[data-first]")?.focus(); }, [autoFocus]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) onSend(text.trim()); }
  };

  return (
    <div ref={ref} className="flex flex-col items-end gap-2 animate-fade">
      {turn.kind === "choice" ? (
        <div role="group" aria-label={turn.prompt} className="flex max-w-full flex-wrap justify-end gap-1.5 sm:max-w-[85%]">
          {turn.options!.map((o, i) => {
            const picked = initial === o.value;
            const suggested = !initial && turn.suggested === o.value;
            return (
              <button key={o.value} type="button" data-first={i === 0 ? "" : undefined} disabled={busy} onClick={() => onSend(o.value)}
                className={cx("inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 py-2 text-[14px] transition-all active:scale-[.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
                  picked ? "border-cta bg-cta text-white" : suggested ? "border-green/40 bg-green-soft text-green hover:bg-green-soft/80" : "border-line bg-white/80 text-head hover:bg-white")}
              >
                {picked && <Check className="size-3.5" strokeWidth={2.4} aria-hidden />}
                <span lang={t.locale === "ru" || o.label === "Нет, только remote" ? undefined : "ru"}>{optionLabel(o.label, t)}</span>
                {suggested && <span className="font-mono text-[11px] uppercase tracking-wide opacity-70">{t("onboarding.fromProfile")}</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex w-full flex-col gap-1.5 sm:max-w-[85%]">
          <label htmlFor={`${id}-t`} className="sr-only">{t("onboarding.yourAnswer")}</label>
          <div className="relative">
            <textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={2} maxLength={1000} placeholder={turn.placeholder ?? t("onboarding.yourAnswer")} disabled={busy}
              aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-e` : undefined}
              className="field block resize-none !rounded-[18px] !pr-14 !text-[14.5px]" />
            <button type="button" onClick={() => text.trim() && onSend(text.trim())} disabled={busy || !text.trim()} aria-label={t("onboarding.send")}
              className="absolute bottom-2 right-2 grid size-9 place-items-center rounded-full bg-cta text-white shadow-(--shadow-cta) transition-opacity disabled:opacity-35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              <ArrowUp className="size-4" strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <span className="text-right text-[11.5px] text-ink-3">{t("onboarding.enterHint")}</span>
        </div>
      )}
      <div className="flex items-center gap-1">
        {onCancel && <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-full px-3 text-[12.5px] text-ink-3 hover:bg-white/70 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("common.cancel")}</button>}
        <button type="button" onClick={() => onSend("")} disabled={busy} className="inline-flex h-10 items-center rounded-full px-3 text-[12.5px] text-ink-3 hover:bg-white/70 hover:text-head disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-green">{t("onboarding.skip")}</button>
      </div>
      {error && <p id={`${id}-e`} role="alert" className="text-[12.5px] text-rose">{error}</p>}
    </div>
  );
}

/* ——— parsed experience review ——— */

function Positions({ items }: { items: Position[] }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <div className="mt-2.5 flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1.5">
        {shown.map((p) => <PositionRow key={p.id} p={p} />)}
      </ul>
      {items.length > 5 && (
        <button type="button" onClick={() => setAll((v) => !v)} aria-expanded={all} className="w-fit rounded text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
          {all ? t("onboarding.collapse") : t("onboarding.showAll", { n: String(items.length) })}
        </button>
      )}
    </div>
  );
}

function PositionRow({ p }: { p: Position }) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm" | "gone">("view");
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const t = useT();
  const { state, pending: saving, formAction, onSubmit } = useActionForm<FormState>(updateFactBasics, undefined);
  const [editBase, setEditBase] = useState<FormState>(undefined);
  const [title, setTitle] = useState(p.title);
  const [org, setOrg] = useState(p.org);
  if (mode === "gone") return null;
  // A successful save (a new state object since editing began) closes the editor.
  const editing = mode === "edit" && !(state?.ok && state !== editBase);
  const dates = fmtFactPeriod(p.startDate, p.endDate);

  if (editing) {
    return (
      <li className="rounded-2xl border border-line bg-white p-3">
        <form action={formAction} onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="id" value={p.id} />
          <label className="flex flex-col gap-1"><span className="label !text-[11px]">{t("onboarding.jobTitle")}</span><input name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="field !py-2 !text-[14px]" /></label>
          <label className="flex flex-col gap-1"><span className="label !text-[11px]">{t("onboarding.company")}</span><input name="org" value={org} onChange={(e) => setOrg(e.target.value)} maxLength={200} className="field !py-2 !text-[14px]" /></label>
          <label className="flex flex-col gap-1"><span className="label !text-[11px]">{t("onboarding.from")}</span><input name="startDate" defaultValue={p.startDate} maxLength={40} className="field !py-2 !text-[14px]" /></label>
          <label className="flex flex-col gap-1"><span className="label !text-[11px]">{t("onboarding.to")}</span><input name="endDate" defaultValue={p.endDate} maxLength={40} className="field !py-2 !text-[14px]" /></label>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-cta px-4 text-[13px] font-medium text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {saving && <span className="size-3 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}{t("common.save")}
            </button>
            <button type="button" onClick={() => setMode("view")} className="inline-flex h-10 items-center rounded-full px-3 text-[13px] text-ink-2 hover:bg-mint-2 focus-visible:outline-2 focus-visible:outline-green">{t("common.cancel")}</button>
            <FormAlert error={state?.error} />
          </div>
        </form>
      </li>
    );
  }

  return (
    <li aria-busy={pending} className="flex flex-col gap-1 rounded-2xl border border-line bg-white/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <span className="min-w-0">
        <span className="block text-[14px] text-head">{title}{org && <span className="text-ink-3"> · {org}</span>}</span>
        {(dates || p.kind !== "employment") && <span className="block text-[12px] text-ink-3">{[p.kind === "project" ? t("onboarding.project") : p.kind === "education" ? t("onboarding.education") : "", dates].filter(Boolean).join(" · ")}</span>}
      </span>
      {mode === "confirm" ? (
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[12.5px] text-ink-2">{t("onboarding.removeQ")}</span>
          <button type="button" disabled={pending} onClick={() => start(async () => { try { await deleteFact(p.id); setMode("gone"); } catch { setErr(t("onboarding.failed")); setMode("view"); } })} className="inline-flex h-10 items-center rounded-full bg-rose px-3 text-[12.5px] text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose">{t("common.yes")}</button>
          <button type="button" onClick={() => setMode("view")} className="inline-flex h-10 items-center rounded-full px-3 text-[12.5px] text-ink-2 hover:bg-mint-2 focus-visible:outline-2 focus-visible:outline-green">{t("common.no")}</button>
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-0.5">
          {err && <span className="mr-1 text-[12px] text-rose" role="alert">{err}</span>}
          <button type="button" onClick={() => { setEditBase(state); setMode("edit"); }} aria-label={t("onboarding.fixAria", { title })} className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-ink-3 hover:bg-mint-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green"><Pencil className="size-3" aria-hidden />{t("onboarding.fix")}</button>
          <button type="button" onClick={() => setMode("confirm")} aria-label={t("onboarding.removeAria", { title })} className="inline-flex h-10 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-ink-3 hover:bg-rose-soft hover:text-rose focus-visible:outline-2 focus-visible:outline-green"><X className="size-3" aria-hidden />{t("onboarding.remove")}</button>
        </span>
      )}
    </li>
  );
}
