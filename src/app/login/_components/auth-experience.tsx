"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, AlertCircle, Check, TicketPercent, Target } from "lucide-react";
import { checkReferral, login, signup, type AuthState, type ReferralCheck } from "@/lib/actions/auth";
import { Logo, Script, cx } from "@/components/ui";
import { Atmosphere } from "./atmosphere";
import { AgentPreview } from "./agent-preview";
import { storeIntent, type Intent, type WhereKey } from "../../_components/campaign-intent";
import { RememberPlan } from "../../_components/remember-plan";
import { DocLink, LegalFooter } from "../../_components/legal-page";
import type { PlanKey } from "../../_components/plan-pref";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useT } from "@/lib/i18n/client";
import type { NsKey } from "@/lib/i18n/translator";

type Mode = "login" | "signup";
type FieldKey = "name" | "email" | "password" | "terms";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function strength(pw: string) {
  if (!pw) return { score: 0 };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-zа-я]/.test(pw) && /[A-ZА-Я]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
  const score = pw.length < 8 ? 1 : Math.min(4, Math.max(1, s - 1));
  return { score };
}

const STRENGTH: NsKey<"auth">[] = ["weak", "weak", "medium", "good", "strong"];
const WHERE_KEY: Record<WhereKey, NsKey<"auth">> = { europe: "whereEurope", us: "whereUs", remote: "whereRemote", kz: "whereKz", relocation: "whereRelocation" };

/** `serverErrors`: the auth actions answer in Russian; the page passes {Russian text → current language} to show them translated. */
export function AuthExperience({ initialMode, refCode, next, intent = null, plan = null, serverErrors = {} }: { initialMode: Mode; refCode: string; next: string; intent?: Intent | null; plan?: PlanKey | null; serverErrors?: Record<string, string> }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [loginState, loginAction, loginPending] = useActionState<AuthState, FormData>(login, undefined);
  const [signupState, signupAction, signupPending] = useActionState<AuthState, FormData>(signup, undefined);
  const pending = loginPending || signupPending;
  const rawServerError = (mode === "login" ? loginState : signupState)?.error;
  const serverError = rawServerError ? serverErrors[rawServerError] ?? rawServerError : undefined;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [ref, setRef] = useState(refCode);
  const [refOpen, setRefOpen] = useState(Boolean(refCode));
  // The badge reflects the server's answer for exactly the code in the field; anything else shows nothing yet.
  const [refCheck, setRefCheck] = useState<(ReferralCheck & { code: string }) | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  const errors = useMemo(() => {
    const e: Partial<Record<FieldKey, string>> = {};
    if (mode === "signup" && name.trim().length < 2) e.name = t("auth.errName");
    if (!EMAIL.test(email.trim())) e.email = email ? t("auth.errEmailFormat") : t("auth.errEmail");
    if (mode === "signup" ? password.length < 8 : !password) e.password = mode === "signup" ? (password ? t("auth.errPwShort", { n: 8 - password.length }) : t("auth.errPwCreate")) : t("auth.errPw");
    if (mode === "signup" && !terms) e.terms = t("auth.errTerms");
    return e;
  }, [mode, name, email, password, terms, t]);

  const required: FieldKey[] = mode === "signup" ? ["name", "email", "password", "terms"] : ["email", "password"];
  const done = required.filter((k) => !errors[k]).length;
  const progress = pending ? 1 : (done / required.length) * 0.9;
  const pw = strength(password);

  // Check the partner code with the server (debounced) — «применён» only for a real partner's code.
  useEffect(() => {
    const code = ref.trim();
    if (!refOpen || code.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      checkReferral(code)
        .then((r) => { if (alive) setRefCheck({ ...r, code }); })
        .catch(() => { if (alive) setRefCheck(null); });
    }, 400);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [ref, refOpen]);
  const refStatus = refCheck && refCheck.code === ref.trim() && ref.trim().length >= 2 ? refCheck : null;

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

  const switchMode = (m: Mode) => { if (m !== mode && !pending) { setMode(m); setTouched({}); } };

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
      <RememberPlan plan={plan} />

      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link href="/" aria-label={t("common.homeAria")} className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
        <Link href="/check" className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] text-ink-2 transition-colors hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">
          {t("auth.freeCheck")}
        </Link>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-[1240px] items-center gap-6 px-4 pb-16 pt-2 sm:px-8 lg:min-h-[calc(100dvh-84px)] lg:grid-cols-[1.05fr_minmax(0,460px)] lg:gap-16 lg:pb-10">
        {/* Story + live preview */}
        <section className="flex min-w-0 flex-col gap-5 lg:gap-8" aria-label={t("auth.aboutAria")}>
          <div className="flex flex-col gap-3 animate-rise">
            <span className="label">{t("auth.eyebrow")}</span>
            <h1 className="h-serif text-[clamp(34px,5vw,64px)]">{t.rich("auth.hero", {}, { s: (c) => <Script>{c}</Script> })}</h1>
            <p className="max-w-md text-[15.5px] text-ink-2">{t("auth.heroSub")}</p>
          </div>
          <AgentPreview className="animate-rise [animation-delay:120ms] lg:max-w-[520px]" />
          <p className="hidden max-w-md text-[12.5px] text-ink-3 lg:block">{t("auth.heroNote")}</p>
        </section>

        {/* Form */}
        <section className={cx("relative min-w-0 animate-rise [animation-delay:80ms]", (intent || plan) && "order-first lg:order-none")} aria-labelledby={`${uid}-title`}>
          {mode === "signup" && <LoopStroke progress={progress} complete={pending} />}
          <div ref={cardRef} className="glass-strong relative p-5 sm:p-8">

            <ModeSwitch mode={mode} onChange={switchMode} />
            {intent && <IntentSummary intent={intent} />}

            <div className="mt-6">
              <div key={mode} className="flex flex-col gap-1.5 animate-rise">
                <h2 id={`${uid}-title`} className="h-serif text-[30px] sm:text-[34px]">
                  {t.rich(mode === "signup" ? "auth.signupTitle" : "auth.loginTitle", {}, { s: (c) => <Script>{c}</Script> })}
                </h2>
                <p className="text-[13.5px] text-ink-3">{mode === "signup" ? t("auth.signupSub") : t("auth.loginSub")}</p>
              </div>
            </div>

            <form ref={formRef} action={mode === "login" ? loginAction : signupAction} onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
              <input type="hidden" name="next" value={next} />
              {plan && <input type="hidden" name="plan" value={plan} />}

              <Collapse open={mode === "signup"}>
                <TextField
                  id={`${uid}-name`} field="name" label={t("auth.name")} name="name" autoComplete="name" value={name} onChange={setName}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))} error={show("name")} errId={errId("name")} valid={!errors.name}
                />
              </Collapse>

              <TextField
                id={`${uid}-email`} field="email" label={t("auth.email")} name="email" type="email" inputMode="email" autoComplete="email" value={email} onChange={setEmail}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))} error={show("email")} errId={errId("email")} valid={!errors.email} placeholder="name@gmail.com"
              />

              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`${uid}-pw`} className="label">{t("auth.password")}</label>
                  {mode === "signup" && password && <span className="label !text-[11px]" aria-live="polite">{t("auth.strength")} <span className={cx(pw.score >= 3 ? "text-green" : pw.score === 2 ? "text-amber" : "text-rose")}>{t(`auth.${STRENGTH[pw.score]}`)}</span></span>}
                </div>
                <div className="relative">
                  <input
                    id={`${uid}-pw`} data-field="password" name="password" type={showPw ? "text" : "password"}
                    autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password}
                    onChange={(e) => setPassword(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                    onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
                    aria-invalid={Boolean(show("password"))} aria-describedby={cx(show("password") && errId("password"), caps && `${uid}-caps`, mode === "signup" && !show("password") && `${uid}-pwhint`) || undefined}
                    className={cx("field !pr-12", show("password") && "!border-rose/60")}
                    placeholder={mode === "signup" ? t("auth.pwPlaceholder") : ""}
                  />
                  <button
                    type="button" onClick={() => setShowPw((v) => !v)} aria-pressed={showPw} aria-label={showPw ? t("auth.hidePw") : t("auth.showPw")}
                    className="absolute right-1 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full text-ink-3 transition-colors hover:bg-mint-2 hover:text-head focus-visible:outline-2 focus-visible:outline-green"
                  >
                    {showPw ? <EyeOff className="size-4" strokeWidth={1.7} /> : <Eye className="size-4" strokeWidth={1.7} />}
                  </button>
                </div>
                {/* After the field in the DOM: Tab goes email → password → «Не помнишь пароль?». */}
                {mode === "login" && (
                  <Link href="/reset" className="-my-1 inline-flex min-h-10 items-center self-end rounded text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("auth.forgot")}</Link>
                )}
                {mode === "signup" && (
                  <div className="grid grid-cols-4 gap-1" aria-hidden>
                    {[1, 2, 3, 4].map((k) => (
                      <span key={k} className={cx("h-1 rounded-full transition-colors duration-300", pw.score >= k ? (pw.score >= 3 ? "bg-green" : pw.score === 2 ? "bg-amber" : "bg-rose") : "bg-head/10")} />
                    ))}
                  </div>
                )}
                {mode === "signup" && <span id={`${uid}-pwhint`} className="sr-only">{t("auth.pwHint")}</span>}
                {caps && <span id={`${uid}-caps`} className="text-[12px] text-amber">{t("auth.caps")}</span>}
                {show("password") && <FieldError id={errId("password")}>{errors.password}</FieldError>}
              </div>

              <Collapse open={mode === "signup"}>
                <div className="flex flex-col gap-4">
                  {refOpen ? (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor={`${uid}-ref`} className="label">{t("auth.refLabel")}</label>
                      <div className="relative">
                        <TicketPercent className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-teal" strokeWidth={1.7} aria-hidden />
                        <input id={`${uid}-ref`} name="ref" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={32} autoComplete="off" aria-describedby={`${uid}-ref-status`} aria-invalid={refStatus && !refStatus.valid ? true : undefined} className="field !pl-10 font-mono uppercase tracking-[.06em]" />
                      </div>
                      <p id={`${uid}-ref-status`} role="status" aria-live="polite" className="min-h-[18px] text-[12.5px]">
                        {refStatus?.valid && <span className="inline-flex items-center gap-1 text-green"><Check className="size-3.5" strokeWidth={2.4} aria-hidden />{t("auth.refApplied", { name: refStatus.partnerName ?? "" })}</span>}
                        {refStatus && !refStatus.valid && <span className="text-amber">{t("auth.refNotFound")}</span>}
                      </p>
                    </div>
                  ) : (
                    <>
                      <input type="hidden" name="ref" value="" />
                      <button type="button" onClick={() => setRefOpen(true)} className="inline-flex min-h-10 w-fit items-center rounded text-[13px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("auth.refAsk")}</button>
                    </>
                  )}

                  <fieldset className="flex flex-col gap-2.5 rounded-2xl border border-line bg-white/50 p-3.5">
                    <legend className="sr-only">{t("auth.consents")}</legend>
                    <Checkbox
                      name="terms" checked={terms} onChange={(v) => { setTerms(v); setTouched((t) => ({ ...t, terms: true })); }} field="terms"
                      invalid={Boolean(show("terms"))} describedBy={show("terms") ? errId("terms") : undefined}
                    >
                      {t.rich("auth.terms", {}, {
                        terms: (c) => <DocLink doc="terms" newTab>{c}</DocLink>,
                        consent: (c) => <DocLink doc="consent" newTab>{c}</DocLink>,
                        privacy: (c) => <DocLink doc="privacy" newTab>{c}</DocLink>,
                      })}
                    </Checkbox>
                    <Checkbox name="analytics" checked={analytics} onChange={setAnalytics}>
                      {t.rich("auth.analytics", {}, { m: (c) => <span className="text-ink-4">{c}</span> })}
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
                      {mode === "signup" && rawServerError && /уже есть/.test(rawServerError) && <> · <button type="button" onClick={() => switchMode("login")} className="underline underline-offset-2">{t("auth.login")}</button></>}
                    </span>
                  </div>
                )}
              </div>

              <button
                ref={submitRef} type="submit" disabled={pending} aria-disabled={pending}
                className="group relative mt-1 inline-flex h-13 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-cta text-[15.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.99] disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
              >
                {pending ? (
                  <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />{mode === "signup" ? t("auth.creating") : t("auth.signingIn")}</>
                ) : (
                  <>{mode === "signup" ? t("auth.submitSignup") : t("auth.login")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></>
                )}
              </button>
            </form>

            <div className="mt-5 flex flex-col items-center gap-3 text-[13px] text-ink-3">
              <p>
                {mode === "signup" ? t("auth.haveAccount") : t("auth.noAccount")}{" "}
                <button type="button" onClick={() => switchMode(mode === "signup" ? "login" : "signup")} className="inline-flex min-h-10 items-center text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">
                  {mode === "signup" ? t("auth.login") : t("auth.createAccount")}
                </button>
              </p>
            </div>
          </div>
        </section>
      </main>
      <div className="flex justify-center pb-1"><LocaleSwitcher /></div>
      <LegalFooter />
    </div>
  );
}

/* ——— pieces ——— */

function IntentSummary({ intent }: { intent: Intent }) {
  const t = useT();
  const where = intent.where.map((w) => (WHERE_KEY[w] ? t(`auth.${WHERE_KEY[w]}`) : w));
  const salary = intent.salary ? t(intent.currency === "KZT" ? "auth.perMonth" : "auth.perYear", { amount: t.money(intent.salary, intent.currency) }) : "";
  return (
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-green/20 bg-green-soft/50 px-4 py-3 animate-fade">
      <Target className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="label !text-[11px] !text-green">{t("auth.yourCampaign")}</div>
        <div className="mt-0.5 text-[14.5px] font-medium text-head">{intent.role}</div>
        <div className="text-[12.5px] text-ink-3">{[where.join(", "), salary].filter(Boolean).join(" · ")}</div>
      </div>
      <Link href="/" className="inline-flex min-h-10 shrink-0 items-center rounded text-[12.5px] text-teal underline decoration-line underline-offset-4 hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("common.change")}</Link>
    </div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const t = useT();
  return (
    <div role="group" aria-label={t("auth.modeAria")} className="relative grid grid-cols-2 rounded-full border border-line bg-white/55 p-1">
      <span aria-hidden className={cx("absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-cta shadow-(--shadow-cta) transition-transform duration-500 ease-[cubic-bezier(.16,1,.3,1)]", mode === "signup" && "translate-x-full")} />
      {(["login", "signup"] as const).map((m) => (
        <button
          key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}
          className={cx("relative z-10 h-10 rounded-full text-[13.5px] transition-colors duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", mode === m ? "text-white" : "text-ink-2 hover:text-head")}
        >
          {m === "login" ? t("auth.login") : t("auth.createAccount")}
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
