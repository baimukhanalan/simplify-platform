"use client";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowLeft, Check, AlertCircle } from "lucide-react";
import { cx } from "@/components/ui";
import { ROLE_SUGGESTIONS, SALARY_PRESETS, WHERE_OPTIONS, fmtUsd, intentQuery, storeIntent, type Intent, type WhereKey } from "./campaign-intent";

const QUESTIONS = ["Кем ты хочешь работать?", "Где?", "Минимальная зарплата?"] as const;

/**
 * First screen: three questions, one at a time, then one button.
 * Answers go to /login?mode=signup&… (or /onboarding?… when signed in) and into sessionStorage,
 * so onboarding can turn them into the Goal after the signup redirect.
 */
export function IntentFlow({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const uid = useId();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState("");
  const [where, setWhere] = useState<WhereKey[]>([]);
  const [salary, setSalary] = useState("");
  const [error, setError] = useState("");
  const [going, setGoing] = useState(false);
  const headRef = useRef<HTMLHeadingElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const salaryRef = useRef<HTMLInputElement>(null);
  const moved = useRef(false);

  // Move focus to the new question after the first interaction (not on page load).
  useEffect(() => {
    if (!moved.current) return;
    if (step === 0) roleRef.current?.focus();
    else if (step === 2) salaryRef.current?.focus();
    else headRef.current?.focus();
  }, [step]);

  const go = (n: number) => { moved.current = true; setError(""); setStep(n); };
  const salaryNum = Number(salary.replace(/\D/g, "")) || 0;

  const validate = (s: number) => {
    if (s === 0 && role.trim().length < 2) return "Напиши роль — например, Product Manager";
    if (s === 1 && !where.length) return "Выбери хотя бы один вариант";
    return "";
  };
  const next = () => {
    const e = validate(step);
    if (e) { setError(e); return; }
    go(step + 1);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (going) return;
    for (const s of [0, 1]) {
      const err = validate(s);
      if (err) { go(s); setError(err); return; }
    }
    const intent: Intent = { role: role.trim().slice(0, 100), where, salary: salaryNum };
    storeIntent(intent);
    const q = intentQuery(intent);
    setGoing(true);
    if (signedIn) router.push(`/onboarding?${q}`);
    else { q.set("mode", "signup"); router.push(`/login?${q}`); }
  };

  const toggle = (k: WhereKey) => { setError(""); setWhere((w) => (w.includes(k) ? w.filter((x) => x !== k) : [...w, k])); };
  const onRoleKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); next(); } };

  const answered = [
    role.trim() || null,
    where.length ? where.map((w) => WHERE_OPTIONS.find((o) => o.key === w)?.label).join(", ") : null,
    salaryNum ? `${fmtUsd(salaryNum)}+` : null,
  ];

  return (
    <form onSubmit={submit} noValidate aria-labelledby={`${uid}-q`} className="glass-strong relative flex w-full flex-col gap-6 p-5 text-left sm:p-8">
      {/* progress */}
      <div className="flex items-center gap-3">
        <ol className="grid flex-1 grid-cols-3 gap-1.5" aria-label="Вопросы">
          {QUESTIONS.map((q, i) => (
            <li key={q} aria-current={i === step ? "step" : undefined}>
              <span className="sr-only">{`Вопрос ${i + 1}: ${q}${i < step ? " — отвечено" : ""}`}</span>
              <span aria-hidden className={cx("block h-1 rounded-full transition-colors duration-500", i < step ? "bg-green" : i === step ? "bg-cta" : "bg-head/10")} />
            </li>
          ))}
        </ol>
        <span className="num text-[12px] text-ink-3" aria-hidden>{step + 1} / 3</span>
      </div>

      {/* answered so far — tap to edit */}
      {step > 0 && (
        <ul className="flex flex-col gap-1.5">
          {answered.slice(0, step).map((a, i) => (
            <li key={QUESTIONS[i]}>
              <button type="button" onClick={() => go(i)} className="group flex w-full items-center gap-3 rounded-2xl border border-line bg-white/55 px-3.5 py-2.5 text-left transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-green">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-green text-white"><Check className="size-3" strokeWidth={3} aria-hidden /></span>
                <span className="min-w-0 flex-1 truncate text-[14px] text-head"><span className="sr-only">{QUESTIONS[i]} </span>{a ?? "—"}</span>
                <span className="text-[12px] text-ink-3 group-hover:text-head">Изменить</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div key={step} className="flex flex-col gap-4 animate-rise">
        <h2 id={`${uid}-q`} ref={headRef} tabIndex={-1} className="h-serif text-[clamp(26px,4vw,36px)] outline-none">{QUESTIONS[step]}</h2>

        {step === 0 && (
          <div className="flex flex-col gap-3">
            <label htmlFor={`${uid}-role`} className="sr-only">Роль</label>
            <input
              ref={roleRef} id={`${uid}-role`} value={role} onChange={(e) => { setRole(e.target.value); setError(""); }} onKeyDown={onRoleKey}
              maxLength={100} autoComplete="organization-title" placeholder="Например, Product Manager"
              aria-invalid={Boolean(error)} aria-describedby={error ? `${uid}-err` : undefined}
              className="field !h-14 !rounded-2xl !px-5 !text-[18px]"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Популярные роли">
              {ROLE_SUGGESTIONS.map((r) => (
                <button key={r} type="button" onClick={() => { setRole(r); setError(""); }} aria-pressed={role === r}
                  className={cx("inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", role === r ? "border-green/40 bg-green-soft text-green" : "border-line bg-white/60 text-ink-2 hover:border-teal/40 hover:text-head")}
                >{r}</button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div role="group" aria-labelledby={`${uid}-q`} aria-describedby={error ? `${uid}-err` : `${uid}-multi`} className="flex flex-col gap-3">
            <span id={`${uid}-multi`} className="text-[13px] text-ink-3">Можно выбрать несколько.</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WHERE_OPTIONS.map((o) => {
                const on = where.includes(o.key);
                return (
                  <button key={o.key} type="button" onClick={() => toggle(o.key)} aria-pressed={on}
                    className={cx("flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-2xl border px-4 py-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green active:scale-[.98]", on ? "border-cta bg-cta text-white shadow-(--shadow-cta)" : "border-line bg-white/65 text-head hover:bg-white")}
                  >
                    <span className="flex w-full items-center justify-between gap-2 text-[15px] font-medium">{o.label}{on && <Check className="size-4" strokeWidth={2.4} aria-hidden />}</span>
                    <span className={cx("text-[12px]", on ? "text-white/70" : "text-ink-3")}>{o.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            <label htmlFor={`${uid}-sal`} className="sr-only">Минимальная зарплата, USD в год</label>
            <div className="relative">
              <span aria-hidden className="num pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-[18px] text-ink-3">$</span>
              <input
                ref={salaryRef} id={`${uid}-sal`} inputMode="numeric" autoComplete="off" placeholder="70,000"
                value={salaryNum ? salaryNum.toLocaleString("en-US") : ""} onChange={(e) => setSalary(e.target.value.replace(/\D/g, "").slice(0, 7))}
                aria-describedby={`${uid}-sal-hint`} className="field num !h-14 !rounded-2xl !pl-9 !pr-28 !text-[18px]"
              />
              <span aria-hidden className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3">в год, до налогов</span>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Быстрый выбор">
              {SALARY_PRESETS.map((n) => (
                <button key={n} type="button" onClick={() => setSalary(String(n))} aria-pressed={salaryNum === n}
                  className={cx("num inline-flex min-h-10 items-center rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-green", salaryNum === n ? "border-green/40 bg-green-soft text-green" : "border-line bg-white/60 text-ink-2 hover:border-teal/40 hover:text-head")}
                >{fmtUsd(n)}+</button>
              ))}
            </div>
            <span id={`${uid}-sal-hint`} className="text-[12.5px] text-ink-3">Необязательно. Simplify не будет тратить заявки на вакансии ниже этой суммы.</span>
          </div>
        )}

        <div aria-live="polite" className="min-h-0">
          {error && <p id={`${uid}-err`} className="flex items-center gap-1.5 text-[13px] text-rose animate-fade"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{error}</p>}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {step > 0 ? (
          <button type="button" onClick={() => go(step - 1)} className="inline-flex h-11 items-center justify-center gap-1.5 rounded-full px-4 text-[14px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
            <ArrowLeft className="size-4" aria-hidden />Назад
          </button>
        ) : <span className="hidden sm:block" />}
        {step < 2 ? (
          <button key="next" type="button" onClick={next} className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta px-7 text-[15px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            Дальше<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        ) : (
          // Distinct key: reusing the "Дальше" element would flip its type mid-click and submit early.
          <button key="submit" type="submit" disabled={going} aria-busy={going} className="group inline-flex h-13 w-full items-center justify-center gap-2 rounded-full bg-cta px-7 text-[15.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.98] disabled:cursor-wait disabled:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green sm:w-auto">
            {going ? <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />Запускаем…</> : <>Запустить мою карьерную кампанию<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></>}
          </button>
        )}
      </div>
    </form>
  );
}
