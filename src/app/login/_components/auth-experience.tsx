"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, AlertCircle, Sparkles, Check, TicketPercent, Target } from "lucide-react";
import { login, signup, type AuthState } from "@/lib/actions/auth";
import { Logo, Script, cx } from "@/components/ui";
import { Atmosphere } from "./atmosphere";
import { AgentPreview } from "./agent-preview";
import { WHERE_OPTIONS, fmtUsd, storeIntent, type Intent } from "../../_components/campaign-intent";

type Mode = "login" | "signup";
type FieldKey = "name" | "email" | "password" | "terms";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DEMO = { email: "demo@simplify.kz", password: "simplify2026" };

function strength(pw: string) {
  if (!pw) return { score: 0, label: "" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-zа-я]/.test(pw) && /[A-ZА-Я]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
  const score = pw.length < 8 ? 1 : Math.min(4, Math.max(1, s - 1));
  return { score, label: ["", "Слабый", "Средний", "Хороший", "Сильный"][score] };
}

export function AuthExperience({ initialMode, refCode, next, intent = null }: { initialMode: Mode; refCode: string; next: string; intent?: Intent | null }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [loginState, loginAction, loginPending] = useActionState<AuthState, FormData>(login, undefined);
  const [signupState, signupAction, signupPending] = useActionState<AuthState, FormData>(signup, undefined);
  const pending = loginPending || signupPending;
  const serverError = (mode === "login" ? loginState : signupState)?.error;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [ref, setRef] = useState(refCode);
  const [refOpen, setRefOpen] = useState(Boolean(refCode));
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [demoHint, setDemoHint] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const errors = useMemo(() => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (mode === "signup" && name.trim().length < 2) e.name = "Введите имя — минимум 2 символа";
    if (!EMAIL.test(email.trim())) e.email = email ? "Проверьте формат email" : "Введите email";
    if (mode === "signup" ? password.length < 8 : !password) e.password = mode === "signup" ? "Минимум 8 символов" : "Введите пароль";
    if (mode === "signup" && !terms) e.terms = "Нужно согласие, чтобы создать аккаунт";
    return e;
  }, [mode, name, email, password, terms]);

  const required: FieldKey[] = mode === "signup" ? ["name", "email", "password", "terms"] : ["email", "password"];
  const done = required.filter((k) => !errors[k]).length;
  const progress = pending ? 1 : (done / required.length) * 0.9;
  const pw = strength(password);

  // The signup action always redirects to /onboarding — keep the first-screen answers for it.
  useEffect(() => { if (intent) storeIntent(intent); }, [intent]);

  // Keep the URL in sync so refresh/back keeps the mode (and the partner code).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (mode === "signup") url.searchParams.set("mode", "signup"); else url.searchParams.delete("mode");
    window.history.replaceState(window.history.state, "", url);
  }, [mode]);

  const nudge = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardRef.current?.animate([{ transform: "none" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 380, easing: "ease-out" });
  };
  // Each new server response object with an error nudges the card.
  useEffect(() => { if (loginState?.error || signupState?.error) nudge(); }, [loginState, signupState]);

  const switchMode = (m: Mode) => { if (m !== mode && !pending) { setMode(m); setTouched({}); setDemoHint(false); } };

  const fillDemo = () => {
    setMode("login");
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    setTouched({});
    setDemoHint(true);
    requestAnimationFrame(() => submitRef.current?.focus());
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const firstBad = required.find((k) => errors[k]);
    if (firstBad) {
      setTouched(Object.fromEntries(required.map((k) => [k, true])));
      nudge();
      formRef.current?.querySelector<HTMLElement>(`[data-field="${firstBad}"]`)?.focus();
      return;
    }
    const fd = new FormData(e.currentTarget);
    startTransition(() => (mode === "login" ? loginAction : signupAction)(fd));
  };

  const show = (k: FieldKey) => touched[k] && errors[k];
  const errId = (k: string) => `${uid}-${k}-err`;

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <Atmosphere progress={progress} />

      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link href="/" aria-label="Simplify — на главную" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
        <Link href="/check" className="rounded-full px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
          Бесплатный Career Check
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-[1240px] items-center gap-6 px-4 pb-16 pt-2 sm:px-8 lg:min-h-[calc(100dvh-84px)] lg:grid-cols-[1.05fr_minmax(0,460px)] lg:gap-16 lg:pb-10">
        {/* Story + live preview */}
        <section className="flex min-w-0 flex-col gap-5 lg:gap-8" aria-label="О Simplify">
          <div className="flex flex-col gap-3 animate-rise">
            <span className="label">AI Career Agent</span>
            <h1 className="h-serif text-[clamp(34px,5vw,64px)]">Stop applying. <Script>Start</Script> interviewing.</h1>
            <p className="max-w-md text-[15.5px] text-ink-2">Tell us what job you want. We handle the rest — поиск, адаптация CV, заявки, трекинг и подготовка к интервью.</p>
          </div>
          <AgentPreview className="animate-rise [animation-delay:120ms] lg:max-w-[520px]" />
          <p className="hidden max-w-md text-[12.5px] text-ink-3 lg:block">Один профиль — десятки персональных заявок. Вы подключаетесь только там, где нужно ваше решение.</p>
        </section>

        {/* Form */}
        <section className="relative min-w-0 animate-rise [animation-delay:80ms]" aria-labelledby={`${uid}-title`}>
          <LoopStroke progress={progress} complete={pending} />
          <div ref={cardRef} className="glass-strong relative p-5 sm:p-8">

            <ModeSwitch mode={mode} onChange={switchMode} />
            {intent && <IntentSummary intent={intent} />}

            <div className="mt-6 flex items-start justify-between gap-4">
              <div key={mode} className="flex flex-col gap-1.5 animate-rise">
                <h2 id={`${uid}-title`} className="h-serif text-[30px] sm:text-[34px]">
                  {mode === "signup" ? <>Начните <Script>кампанию</Script></> : <>С <Script>возвращением</Script></>}
                </h2>
                <p className="text-[13.5px] text-ink-3">{mode === "signup" ? "2 минуты — и агент начнёт собирать ваш Career Profile." : "Кампания продолжается — посмотрим, что нашёл агент."}</p>
              </div>
              <LoopBadge done={pending ? required.length : done} total={required.length} />
            </div>

            <form ref={formRef} action={mode === "login" ? loginAction : signupAction} onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
              <input type="hidden" name="next" value={next} />

              <Collapse open={mode === "signup"}>
                <TextField
                  id={`${uid}-name`} field="name" label="Имя" name="name" autoComplete="name" value={name} onChange={setName}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))} error={show("name")} errId={errId("name")} valid={!errors.name}
                />
              </Collapse>

              <TextField
                id={`${uid}-email`} field="email" label="Email" name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={show("email")} errId={errId("email")} valid={!errors.email} placeholder="you@example.com"
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor={`${uid}-pw`} className="label">Пароль</label>
                  {mode === "signup" && password && <span className="label !text-[10px]" aria-live="polite">Надёжность: <span className={cx(pw.score >= 3 ? "text-green" : pw.score === 2 ? "text-amber" : "text-rose")}>{pw.label}</span></span>}
                </div>
                <div className="relative">
                  <input
                    id={`${uid}-pw`} data-field="password" name="password" type={showPw ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password}
                    onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
                    aria-invalid={Boolean(show("password"))} aria-describedby={cx(show("password") && errId("password"), caps && `${uid}-caps`, mode === "signup" && `${uid}-pwhint`) || undefined}
                    className={cx("field !pr-12", show("password") && "!border-rose/60")}
                    placeholder={mode === "signup" ? "Минимум 8 символов" : ""}
                  />
                  <button
                    type="button" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw} aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                    className="absolute right-1.5 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors hover:bg-mint-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green"
                  >
                    {showPw ? <EyeOff className="size-4" strokeWidth={1.7} /> : <Eye className="size-4" strokeWidth={1.7} />}
                  </button>
                </div>
                {mode === "signup" && (
                  <div className="grid grid-cols-4 gap-1" aria-hidden>
                    {[1, 2, 3, 4].map((k) => (
                      <span key={k} className={cx("h-1 rounded-full transition-colors duration-300", pw.score >= k ? (pw.score >= 3 ? "bg-green" : pw.score === 2 ? "bg-amber" : "bg-rose") : "bg-head/10")} />
                    ))}
                  </div>
                )}
                {mode === "signup" && <span id={`${uid}-pwhint`} className="sr-only">Минимум 8 символов; длиннее и с цифрами — надёжнее.</span>}
                {caps && <span id={`${uid}-caps`} className="text-[12px] text-amber">Включён Caps Lock</span>}
                {show("password") && <FieldError id={errId("password")}>{errors.password}</FieldError>}
              </div>

              <Collapse open={mode === "signup"}>
                <div className="flex flex-col gap-4">
                  {refOpen ? (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${uid}-ref`} className="label">Код партнёра</label>
                      <div className="relative">
                        <TicketPercent className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-teal" strokeWidth={1.7} aria-hidden />
                        <input id={`${uid}-ref`} name="ref" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={32} autoComplete="off" className="field !pl-10 font-mono uppercase tracking-[.06em]" />
                        {refCode && ref === refCode && <span className="absolute right-3 top-1/2 -translate-y-1/2"><span className="inline-flex items-center gap-1 rounded-full bg-green-soft px-2 py-0.5 font-mono text-[10px] uppercase text-green"><Check className="size-3" strokeWidth={2.4} />применён</span></span>}
                      </div>
                    </div>
                  ) : (
                    <>
                      <input type="hidden" name="ref" value="" />
                      <button type="button" onClick={() => setRefOpen(true)} className="w-fit rounded text-[13px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Есть код партнёра?</button>
                    </>
                  )}

                  <fieldset className="flex flex-col gap-2.5 rounded-2xl border border-line bg-white/50 p-3.5">
                    <legend className="sr-only">Согласия</legend>
                    <Checkbox
                      name="terms" checked={terms} onChange={(v) => { setTerms(v); setTouched((t) => ({ ...t, terms: true })); }} field="terms"
                      invalid={Boolean(show("terms"))} describedBy={show("terms") ? errId("terms") : undefined}
                    >
                      Принимаю условия сервиса и политику обработки данных. Агент подаёт заявки от моего имени только в рамках кампании — это можно изменить в настройках.
                    </Checkbox>
                    <Checkbox name="analytics" checked={analytics} onChange={setAnalytics}>
                      Разрешаю обезличенную аналитику для улучшения продукта <span className="text-ink-4">(необязательно)</span>
                    </Checkbox>
                    {show("terms") && <FieldError id={errId("terms")}>{errors.terms}</FieldError>}
                  </fieldset>
                </div>
              </Collapse>

              <div aria-live="assertive">
                {serverError && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[13.5px] text-rose animate-fade">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" />
                    <span className="flex-1">
                      {serverError}
                      {mode === "signup" && /уже есть/.test(serverError) && <> · <button type="button" onClick={() => switchMode("login")} className="underline underline-offset-2">Войти</button></>}
                    </span>
                  </div>
                )}
              </div>

              {demoHint && mode === "login" && (
                <p className="flex items-center gap-2 rounded-2xl bg-amber-soft px-4 py-2.5 text-[12.5px] text-amber animate-fade">
                  <Sparkles className="size-3.5 shrink-0" />Демо-аккаунт: кампания с тестовыми данными. Нажмите «Войти».
                </p>
              )}

              <button
                ref={submitRef} type="submit" disabled={pending} aria-disabled={pending}
                className="group relative mt-1 inline-flex h-13 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-cta text-[15.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.99] disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
              >
                {pending ? (
                  <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />{mode === "signup" ? "Создаём аккаунт…" : "Входим…"}</>
                ) : (
                  <>{mode === "signup" ? "Start your campaign" : "Войти"}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>
                )}
              </button>
            </form>

            <div className="mt-5 flex flex-col items-center gap-3 text-[13px] text-ink-3">
              <div className="flex w-full items-center gap-3"><span className="h-px flex-1 bg-line" /><span className="label !text-[10px]">или</span><span className="h-px flex-1 bg-line" /></div>
              <button type="button" onClick={fillDemo} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-white/60 px-4 text-[13.5px] text-head transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-green disabled:opacity-50">
                <Sparkles className="size-3.5 text-teal" strokeWidth={1.7} />Войти в демо
              </button>
              <p>
                {mode === "signup" ? "Уже есть аккаунт? " : "Нет аккаунта? "}
                <button type="button" onClick={() => switchMode(mode === "signup" ? "login" : "signup")} className="text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">
                  {mode === "signup" ? "Войти" : "Создать аккаунт"}
                </button>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ——— pieces ——— */

function IntentSummary({ intent }: { intent: Intent }) {
  const where = intent.where.map((w) => WHERE_OPTIONS.find((o) => o.key === w)?.label ?? w);
  return (
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-green/20 bg-green-soft/50 px-4 py-3 animate-fade">
      <Target className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="label !text-[10px] !text-green">Твоя кампания</div>
        <div className="mt-0.5 text-[14.5px] font-medium text-head">{intent.role}</div>
        <div className="text-[12.5px] text-ink-3">{[where.join(", "), intent.salary ? `от ${fmtUsd(intent.salary)}` : ""].filter(Boolean).join(" · ")}</div>
      </div>
      <Link href="/" className="shrink-0 rounded text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Изменить</Link>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="group" aria-label="Режим" className="relative grid grid-cols-2 rounded-full border border-line bg-white/55 p-1">
      <span aria-hidden className={cx("absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-cta shadow-(--shadow-cta) transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)]", mode === "signup" && "translate-x-full")} />
      {(["login", "signup"] as const).map((m) => (
        <button
          key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}
          className={cx("relative z-10 h-9 rounded-full text-[13.5px] transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", mode === m ? "text-white" : "text-ink-2 hover:text-head")}
        >
          {m === "login" ? "Войти" : "Создать аккаунт"}
        </button>
      ))}
    </div>
  );
}

function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={cx("grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.16,1,.3,1)]", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 -mb-4")} inert={!open} aria-hidden={!open}>
      <div className="min-h-0 overflow-hidden p-0.5 -m-0.5">{children}</div>
    </div>
  );
}

function TextField({ id, field, label, error, errId, valid, onChange, ...p }: { id: string; field: FieldKey; label: string; error: string | false | undefined; errId: string; valid: boolean; onChange: (v: string) => void } & Omit<ComponentProps<"input">, "onChange" | "id">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input id={id} data-field={field} {...p} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? errId : undefined} className={cx("field", valid && p.value ? "!pr-10" : "", error && "!border-rose/60")} />
        {valid && p.value ? <Check className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-green animate-fade" strokeWidth={2.2} aria-hidden /> : null}
      </div>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="flex items-center gap-1.5 text-[12.5px] text-rose animate-fade"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{children}</span>;
}

function Checkbox({ name, checked, onChange, children, field, invalid, describedBy }: { name: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode; field?: FieldKey; invalid?: boolean; describedBy?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-ink-2">
      <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
        <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} data-field={field} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cx("peer size-[18px] cursor-pointer appearance-none rounded-[6px] border bg-white transition-colors checked:border-green checked:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", invalid ? "border-rose" : "border-line")} />
        <Check className="pointer-events-none absolute size-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** "Close the loop": a hand-drawn loop around the form that draws in as the form fills. */
function LoopStroke({ progress, complete }: { progress: number; complete: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 400 520" preserveAspectRatio="none" className="pointer-events-none absolute -inset-3 h-[calc(100%+24px)] w-[calc(100%+24px)] overflow-visible sm:-inset-5 sm:h-[calc(100%+40px)] sm:w-[calc(100%+40px)]">
      <path
        d="M214 6 C 336 2, 396 96, 394 258 C 392 418, 318 514, 198 514 C 78 514, 4 420, 6 258 C 8 98, 82 10, 206 12 C 246 13, 272 22, 292 38"
        fill="none" pathLength={1} strokeLinecap="round"
        stroke={complete || progress >= 0.9 ? "var(--color-green)" : "var(--color-teal)"}
        strokeOpacity={0.55} strokeWidth={1.3}
        strokeDasharray="1 1" strokeDashoffset={1 - progress}
        style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.16,1,.3,1), stroke 400ms" }}
      />
    </svg>
  );
}

function LoopBadge({ done, total }: { done: number; total: number }) {
  const r = 17, c = 2 * Math.PI * r, p = done / total;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1" role="img" aria-label={`Заполнено ${done} из ${total}`}>
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(35 59 59 / .1)" strokeWidth="3" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={p >= 1 ? "var(--color-green)" : "var(--color-teal)"} strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: "stroke-dashoffset .7s cubic-bezier(.16,1,.3,1)" }} />
      </svg>
      <span className="label !text-[9px] whitespace-nowrap">Close the loop</span>
    </div>
  );
}
