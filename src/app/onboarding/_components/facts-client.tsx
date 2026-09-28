"use client";
import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Trash2, X, Plus, ChevronDown } from "lucide-react";
import { setFactVerified, deleteFact, updateSkills, addFact, type FormState } from "@/lib/actions/onboarding";
import { Chip, cx } from "@/components/ui";
import { useActionForm } from "../../_components/use-action-form";
import { FormAlert } from "./shared";

export type FactView = { id: string; kind: string; title: string; org: string; startDate: string; endDate: string; details: string; metrics: string; tech: string[]; source: string; verified: boolean };

const SOURCE: Record<string, string> = { cv: "из CV", user: "от вас", interview: "мини-интервью", linkedin: "LinkedIn" };

export function FactCard({ fact }: { fact: FactView }) {
  const [verified, setVerified] = useOptimistic(fact.verified);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [err, setErr] = useState("");
  const id = useId();
  const lines = fact.details.split("\n").filter(Boolean);
  const long = lines.length > 3 || fact.details.length > 260;

  const toggle = () => start(async () => {
    setErr("");
    setVerified(!verified);
    try { await setFactVerified(fact.id, !verified); } catch { setErr("Не удалось сохранить — попробуйте ещё раз"); }
  });
  const remove = () => start(async () => {
    try { setRemoved(true); await deleteFact(fact.id); } catch { setRemoved(false); setErr("Не удалось удалить"); }
  });
  if (removed) return null;

  return (
    <article aria-labelledby={`${id}-t`} aria-busy={pending} className={cx("rounded-[20px] border p-4 transition-all duration-300 sm:p-5", verified ? "border-green/25 bg-white/85 shadow-(--shadow-glass)" : "border-stroke bg-white/60")}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-t`} className="text-[15.5px] font-medium text-head">{fact.title || "Без названия"}</h3>
            <Chip tone={fact.source === "cv" ? "neutral" : "teal"}>{SOURCE[fact.source] ?? fact.source}</Chip>
          </div>
          {(fact.org || fact.startDate) && (
            <div className="text-[13px] text-ink-3">{[fact.org, [fact.startDate, fact.endDate].filter(Boolean).join(" – ")].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        <button
          type="button" role="switch" aria-checked={verified} onClick={toggle}
          className={cx("group inline-flex shrink-0 items-center gap-2.5 self-start rounded-full border py-1.5 pl-1.5 pr-3.5 text-[12.5px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", verified ? "border-green/30 bg-green-soft text-green" : "border-line bg-white/70 text-ink-2 hover:border-teal/40")}
        >
          <span className={cx("relative h-5 w-9 rounded-full transition-colors", verified ? "bg-green" : "bg-head/15")}>
            <span className={cx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform duration-300", verified ? "translate-x-[18px]" : "translate-x-0.5")} />
          </span>
          Подтверждаю — это правда
        </button>
      </div>

      {fact.details && (
        <div className="mt-3">
          <p className={cx("whitespace-pre-line text-[13.5px] leading-relaxed text-ink-2", !expanded && long && "line-clamp-3")}>{fact.details}</p>
          {long && (
            <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="mt-1 inline-flex items-center gap-1 text-[12.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
              {expanded ? "Свернуть" : "Показать всё"}<ChevronDown className={cx("size-3.5 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      )}

      {(fact.metrics || fact.tech.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fact.metrics && <Chip tone="green">{fact.metrics.length > 70 ? `${fact.metrics.slice(0, 68)}…` : fact.metrics}</Chip>}
          {fact.tech.slice(0, 8).map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line/70 pt-3">
        <span className="text-[12px] text-ink-3" aria-live="polite">{err ? <span className="text-rose">{err}</span> : verified ? "Агент может использовать этот факт" : "Не используется, пока не подтвердите"}</span>
        {confirm ? (
          <span className="flex items-center gap-1.5">
            <span className="text-[12.5px] text-ink-2">Удалить?</span>
            <button type="button" onClick={remove} className="rounded-full bg-rose px-3 py-1 text-[12.5px] text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose">Да</button>
            <button type="button" onClick={() => setConfirm(false)} className="rounded-full px-3 py-1 text-[12.5px] text-ink-2 hover:bg-white focus-visible:outline-2 focus-visible:outline-green">Отмена</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] text-ink-3 transition-colors hover:bg-rose-soft hover:text-rose focus-visible:outline-2 focus-visible:outline-green">
            <Trash2 className="size-3.5" aria-hidden />Это неверно
          </button>
        )}
      </div>
    </article>
  );
}

export function SkillsEditor({ initial }: { initial: string[] }) {
  const [skills, setSkills] = useState(initial);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState<"idle" | "saved" | "error">("idle");
  const [pending, start] = useTransition();
  const id = useId();
  const dirty = skills.join("|") !== initial.join("|");

  const add = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !skills.some((x) => x.toLowerCase() === v.toLowerCase())) setSkills((s) => [...s, v.slice(0, 60)]);
    setDraft("");
    setSaved("idle");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !draft && skills.length) setSkills((s) => s.slice(0, -1));
  };
  const save = () => start(async () => {
    try { await updateSkills(skills); setSaved("saved"); } catch { setSaved("error"); }
  });

  return (
    <section aria-labelledby={`${id}-h`} className="glass flex flex-col gap-3 p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${id}-h`} className="text-[15.5px] font-medium text-head">Навыки · {skills.length}</h2>
        <span className="text-[12.5px] text-ink-3">Оставьте только те, что реально применяли</span>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Список навыков">
        {skills.map((sk) => (
          <li key={sk} className="inline-flex items-center gap-1 rounded-full border border-stroke bg-white/80 py-1 pl-3 pr-1 text-[13px] text-head">
            {sk}
            <button type="button" onClick={() => { setSkills((s) => s.filter((x) => x !== sk)); setSaved("idle"); }} aria-label={`Удалить навык ${sk}`} className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-rose-soft hover:text-rose focus-visible:outline-2 focus-visible:outline-green">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
        {!skills.length && <li className="text-[13px] text-ink-3">Навыков пока нет.</li>}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-in`} className="sr-only">Добавить навык</label>
        <input id={`${id}-in`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Добавить навык и нажать Enter" className="field sm:max-w-xs" maxLength={60} />
        <div className="flex items-center gap-2">
          <button type="button" onClick={add} disabled={!draft.trim()} className="inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[14px] text-head hover:bg-white/70 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-green"><Plus className="size-4" />Добавить</button>
          <button type="button" onClick={save} disabled={!dirty || pending} className="inline-flex h-11 items-center gap-2 rounded-full bg-cta px-5 text-[14px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
            {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Сохранить
          </button>
        </div>
      </div>
      <span aria-live="polite" className="text-[12.5px]">
        {saved === "saved" && !dirty && <span className="text-green">Навыки сохранены</span>}
        {saved === "error" && <span className="text-rose">Не удалось сохранить</span>}
        {dirty && <span className="text-amber">Есть несохранённые изменения</span>}
      </span>
    </section>
  );
}

export function AddFactForm() {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(addFact, undefined);
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => { if (state?.ok) formRef.current?.reset(); }, [state]);

  return (
    <section className="glass p-0">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls={`${id}-body`} className="flex w-full items-center justify-between gap-3 rounded-[22px] px-5 py-4 text-left text-[14.5px] text-head focus-visible:outline-2 focus-visible:outline-green sm:px-6">
        <span className="inline-flex items-center gap-2"><Plus className="size-4 text-teal" />Добавить факт, которого нет в CV</span>
        <ChevronDown className={cx("size-4 text-ink-3 transition-transform", open && "rotate-180")} />
      </button>
      <div id={`${id}-body`} hidden={!open} className="px-5 pb-5 sm:px-6">
        <form ref={formRef} action={formAction} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5"><span className="label">Тип</span>
            <select name="kind" className="field" defaultValue="employment">
              <option value="employment">Работа</option><option value="project">Проект</option><option value="education">Образование</option><option value="certification">Сертификат</option><option value="achievement">Достижение</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5"><span className="label">Название / должность</span><input name="title" required maxLength={200} className="field" /></label>
          <label className="flex flex-col gap-1.5"><span className="label">Компания / организация</span><input name="org" maxLength={200} className="field" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5"><span className="label">С</span><input name="startDate" placeholder="2023" maxLength={40} className="field" /></label>
            <label className="flex flex-col gap-1.5"><span className="label">По</span><input name="endDate" placeholder="Present" maxLength={40} className="field" /></label>
          </div>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="label">Что делали</span><textarea name="details" rows={3} maxLength={4000} className="field resize-y" /></label>
          <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center">
            <button type="submit" disabled={pending} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14px] font-medium text-white shadow-(--shadow-cta) disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
              {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}Добавить факт
            </button>
            <FormAlert error={state?.error} message={state?.message} />
          </div>
        </form>
      </div>
    </section>
  );
}
