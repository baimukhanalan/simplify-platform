"use client";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowRight, Check, ChevronDown, Clock3, MessageCircle, ShieldCheck, Target } from "lucide-react";
import { submitApplication, type ApplyState } from "@/lib/actions/apply";
import { ENGLISH_LEVELS, SPECIALIZATIONS, maskPhone, normalizePhone, normalizeTelegram, type EnglishLevel } from "@/lib/lead-options";
import { Logo, Script, cx } from "@/components/ui";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { useT } from "@/lib/i18n/client";
import { Atmosphere } from "../../login/_components/atmosphere";
import { DocLink, LegalFooter } from "../../_components/legal-page";

type Field = "fullName" | "email" | "phone" | "telegram" | "englishLevel" | "specialization" | "specializationOther" | "consent";
type Code = "required" | "invalid";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ORDER: Field[] = ["fullName", "email", "phone", "telegram", "englishLevel", "specialization", "specializationOther", "consent"];

export function ApplyForm({ token, from, refCode }: { token: string; from: string; refCode: string }) {
  const t = useT();
  const uid = useId();
  const [state, action, pending] = useActionState<ApplyState, FormData>(submitApplication, undefined);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [telegram, setTelegram] = useState("");
  const [level, setLevel] = useState<EnglishLevel | "">("");
  const [spec, setSpec] = useState("");
  const [specOther, setSpecOther] = useState("");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  // Fields edited since a given server answer: that answer's error for the field is no longer shown.
  const [edits, setEdits] = useState<{ of: ApplyState; keys: Field[] }>({ of: undefined, keys: [] });
  const formRef = useRef<HTMLFormElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const errors = useMemo(() => {
    const e: Partial<Record<Field, Code>> = {};
    const name = fullName.trim();
    if (!name) e.fullName = "required"; else if (name.length < 2 || name.length > 120 || !/\p{L}/u.test(name)) e.fullName = "invalid";
    if (!email.trim()) e.email = "required"; else if (!EMAIL.test(email.trim()) || email.trim().length > 254) e.email = "invalid";
    if (!phone.trim()) e.phone = "required"; else if (!normalizePhone(phone)) e.phone = "invalid";
    if (normalizeTelegram(telegram) === undefined) e.telegram = "invalid";
    if (!level) e.englishLevel = "required";
    if (!spec) e.specialization = "required";
    if (spec === "other") { const o = specOther.trim(); if (o.length < 2) e.specializationOther = "required"; else if (o.length > 120) e.specializationOther = "invalid"; }
    if (!consent) e.consent = "required";
    return e;
  }, [fullName, email, phone, telegram, level, spec, specOther, consent]);

  const done = ORDER.filter((k) => !errors[k]).length;
  const progress = state?.ok ? 1 : pending ? 1 : (done / ORDER.length) * 0.9;

  const nudge = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    cardRef.current?.animate([{ transform: "none" }, { transform: "translateX(-5px)" }, { transform: "translateX(5px)" }, { transform: "none" }], { duration: 380, easing: "ease-out" });
  };

  // A new server answer: field errors are shown on their fields; success moves focus to the thank-you heading.
  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      doneRef.current?.focus();
      doneRef.current?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (state.errors) {
      const first = ORDER.find((k) => state.errors?.[k]);
      if (first) formRef.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
    }
    nudge();
  }, [state]);

  const serverErrs = state && !state.ok ? state.errors ?? {} : {};
  const edited = edits.of === state ? edits.keys : [];
  const edit = (k: Field) => setEdits((e) => (e.of === state ? (e.keys.includes(k) ? e : { of: state, keys: [...e.keys, k] }) : { of: state, keys: [k] }));
  // After a server answer with field errors every field shows its state, as after a blocked submit.
  const show = (k: Field): Code | undefined => (edited.includes(k) ? undefined : serverErrs[k]) ?? (touched[k] || state?.ok === false ? errors[k] : undefined);
  const msg = (k: Field) => { const c = show(k); return c ? t(`apply.err.${k}.${c}`) : undefined; };
  const errId = (k: Field) => `${uid}-${k}-err`;
  const blur = (k: Field) => () => setTouched((s) => ({ ...s, [k]: true }));

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const firstBad = ORDER.find((k) => errors[k]);
    if (firstBad) {
      setTouched(Object.fromEntries(ORDER.map((k) => [k, true])));
      nudge();
      formRef.current?.querySelector<HTMLElement>(`[data-field="${firstBad}"]`)?.focus();
      return;
    }
    const fd = new FormData(e.currentTarget);
    startTransition(() => action(fd));
  };

  const generalError = state && !state.ok ? (state.error === "rate" ? t("apply.errRate") : state.error === "server" ? t("apply.errServer") : state.errors ? t("apply.errFix") : null) : null;

  return (
    <div className="relative min-h-dvh overflow-x-clip">
      <Atmosphere progress={progress} />

      <header className="mx-auto flex w-full max-w-[1240px] items-center justify-between gap-3 px-4 py-5 sm:px-8">
        <Link href="/" aria-label={t("common.homeAria")} className="inline-flex min-h-10 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"><Logo /></Link>
        <LocaleSwitcher />
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto grid w-full max-w-[1240px] items-start gap-7 px-4 pb-14 pt-2 sm:px-8 lg:min-h-[calc(100dvh-84px)] lg:grid-cols-[1fr_minmax(0,520px)] lg:items-center lg:gap-16 lg:pb-10">
        <section className="flex min-w-0 flex-col gap-4 animate-rise lg:gap-7" aria-labelledby={`${uid}-h1`}>
          <span className="label">{t("apply.eyebrow")}</span>
          <h1 id={`${uid}-h1`} className="h-serif text-[clamp(36px,5.4vw,68px)]">{t.rich("apply.title", {}, { s: (c) => <Script>{c}</Script> })}</h1>
          <p className="max-w-md text-[15.5px] text-ink-2">{t("apply.sub")}</p>
          <ul className="hidden max-w-md flex-col gap-2.5 sm:flex">
            {([[Clock3, "apply.point1"], [Target, "apply.point2"], [ShieldCheck, "apply.point3"]] as const).map(([Icon, key]) => (
              <li key={key} className="flex items-center gap-3 text-[14px] text-ink-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-green-soft text-green"><Icon className="size-4" strokeWidth={1.7} aria-hidden /></span>
                {t(key)}
              </li>
            ))}
          </ul>
        </section>

        <section className="relative min-w-0 animate-rise [animation-delay:80ms]">
          <div ref={cardRef} className="glass-strong relative p-5 sm:p-8">
            {state?.ok ? (
              <div className="flex flex-col items-start gap-4 py-2 animate-rise" role="status">
                <span className="grid size-12 place-items-center rounded-2xl bg-green text-white shadow-(--shadow-cta)"><Check className="size-6" strokeWidth={2.2} aria-hidden /></span>
                <h2 ref={doneRef} tabIndex={-1} className="h-serif text-[32px] outline-none sm:text-[38px]">{t.rich("apply.successTitle", {}, { s: (c) => <Script>{c}</Script> })}</h2>
                <p className="text-[15px] text-ink-2">{t("apply.successText")}</p>
                <div className="flex w-full items-start gap-3 rounded-2xl border border-line bg-white/55 px-4 py-3.5 text-[13.5px] text-ink-2">
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
                  <span>{t("apply.successNext")}</span>
                </div>
                <div className="mt-1 flex w-full flex-col gap-2 sm:flex-row">
                  <Link href="/login?mode=signup" className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta sm:flex-1 px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) transition-colors hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                    {t("apply.createAccount")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                  <Link href="/" className="inline-flex h-12 items-center justify-center rounded-full px-5 text-[14px] text-head hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green">{t("apply.toHome")}</Link>
                </div>
              </div>
            ) : (
              <form ref={formRef} action={action} onSubmit={onSubmit} noValidate aria-label={t("apply.formAria")} aria-busy={pending || undefined} className="flex flex-col gap-4">
                <input type="hidden" name="t" value={token} />
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="ref" value={refCode} />
                {/* Honeypot: invisible to people and screen readers, bots fill it in. */}
                <div aria-hidden className="absolute -left-[10000px] top-auto size-px overflow-hidden">
                  <label>Website<input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
                </div>

                <TextField id={`${uid}-name`} field="fullName" label={t("apply.fullName")} name="fullName" autoComplete="name" maxLength={120} placeholder={t("apply.fullNamePh")}
                  value={fullName} onChange={(v) => { setFullName(v); edit("fullName"); }} onBlur={blur("fullName")} error={msg("fullName")} errId={errId("fullName")} ok={!errors.fullName} />

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField id={`${uid}-email`} field="email" label={t("apply.email")} name="email" type="email" inputMode="email" autoComplete="email" maxLength={254} placeholder="name@gmail.com" spellCheck={false} autoCapitalize="none"
                    value={email} onChange={(v) => { setEmail(v); edit("email"); }} onBlur={blur("email")} error={msg("email")} errId={errId("email")} ok={!errors.email} />
                  <TextField id={`${uid}-phone`} field="phone" label={t("apply.phone")} name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={24} placeholder="+7 (701) 123-45-67"
                    value={phone} onChange={(v) => { setPhone((p) => maskPhone(v, p)); edit("phone"); }} onBlur={blur("phone")} error={msg("phone")} errId={errId("phone")} ok={!errors.phone}
                    hint={t("apply.phoneHint")} hintId={`${uid}-phone-hint`} />
                </div>

                <TextField id={`${uid}-tg`} field="telegram" label={<>{t("apply.telegram")} <span className="normal-case tracking-normal text-ink-4">· {t("apply.optional")}</span></>} name="telegram" autoComplete="off" maxLength={64} placeholder="@username" spellCheck={false} autoCapitalize="none"
                  value={telegram} onChange={(v) => { setTelegram(v); edit("telegram"); }} onBlur={blur("telegram")} error={msg("telegram")} errId={errId("telegram")} ok={Boolean(telegram.trim()) && !errors.telegram} />

                <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={cx(`${uid}-level-desc`, show("englishLevel") && errId("englishLevel"))}>
                  <legend className="label mb-1.5">{t("apply.english")}</legend>
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {ENGLISH_LEVELS.map((l, i) => (
                      <label key={l} className="relative">
                        <input
                          type="radio" name="englishLevel" value={l} checked={level === l} data-field={i === 0 ? "englishLevel" : undefined}
                          onChange={() => { setLevel(l); edit("englishLevel"); setTouched((s) => ({ ...s, englishLevel: true })); }}
                          aria-label={`${l === "native" ? t("apply.nativeShort") : l} — ${t(`apply.level.${l}`)}`}
                          className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                        />
                        <span className={cx(
                          "pointer-events-none flex h-11 items-center justify-center rounded-xl border text-[14px] transition-colors duration-200",
                          "peer-checked:border-cta peer-checked:bg-cta peer-checked:text-white peer-hover:border-teal/40",
                          show("englishLevel") ? "border-rose/60 bg-white/80 text-head" : "border-line bg-white/80 text-head",
                          l === "native" && "col-span-1 text-[13px]",
                        )}>
                          <span className="num">{l === "native" ? t("apply.nativeShort") : l}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {/* Fixed height: picking a level never moves the fields below. */}
                  <p id={`${uid}-level-desc`} aria-live="polite" className="h-[18px] text-[12.5px] text-ink-3">
                    {level ? <><span className="num text-head">{level === "native" ? t("apply.nativeShort") : level}</span> — {t(`apply.level.${level}`)}</> : null}
                  </p>
                  {show("englishLevel") && <FieldError id={errId("englishLevel")}>{msg("englishLevel")}</FieldError>}
                </fieldset>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${uid}-spec`} className="label">{t("apply.spec")}</label>
                  <div className="relative">
                    <select
                      id={`${uid}-spec`} name="specialization" data-field="specialization" value={spec}
                      onChange={(e) => { setSpec(e.target.value); edit("specialization"); setTouched((s) => ({ ...s, specialization: true })); }}
                      onBlur={blur("specialization")}
                      aria-invalid={Boolean(show("specialization")) || undefined} aria-describedby={show("specialization") ? errId("specialization") : undefined}
                      className={cx("field cursor-pointer appearance-none !pr-11", !spec && "text-ink-4", show("specialization") && "!border-rose/60")}
                    >
                      <option value="" disabled>{t("apply.specPh")}</option>
                      {SPECIALIZATIONS.map((s) => <option key={s} value={s} className="text-ink">{t(`apply.specs.${s}`)}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" strokeWidth={1.7} aria-hidden />
                  </div>
                  {show("specialization") && <FieldError id={errId("specialization")}>{msg("specialization")}</FieldError>}
                </div>

                <Collapse open={spec === "other"}>
                  <TextField id={`${uid}-other`} field="specializationOther" label={t("apply.specOther")} name="specializationOther" maxLength={120} placeholder={t("apply.specOtherPh")}
                    value={specOther} onChange={(v) => { setSpecOther(v); edit("specializationOther"); }} onBlur={blur("specializationOther")} error={msg("specializationOther")} errId={errId("specializationOther")} ok={!errors.specializationOther && Boolean(specOther.trim())} />
                </Collapse>

                <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white/50 p-3.5">
                  <label className="flex cursor-pointer items-start gap-3 text-[12.5px] leading-relaxed text-ink-2">
                    <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
                      <input type="checkbox" name="consent" checked={consent} data-field="consent"
                        onChange={(e) => { setConsent(e.target.checked); edit("consent"); setTouched((s) => ({ ...s, consent: true })); }}
                        aria-invalid={Boolean(show("consent")) || undefined} aria-describedby={show("consent") ? errId("consent") : undefined}
                        className={cx("peer size-[18px] cursor-pointer appearance-none rounded-[6px] border bg-white transition-colors checked:border-green checked:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green", show("consent") ? "border-rose" : "border-line")} />
                      <Check className="pointer-events-none absolute size-3 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden />
                    </span>
                    <span>{t.rich("apply.consent", {}, { consent: (c) => <DocLink doc="consent" newTab>{c}</DocLink>, privacy: (c) => <DocLink doc="privacy" newTab>{c}</DocLink> })}</span>
                  </label>
                  {show("consent") && <FieldError id={errId("consent")}>{msg("consent")}</FieldError>}
                </div>

                <div aria-live="assertive">
                  {generalError && (
                    <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-rose/15 bg-rose-soft px-4 py-3 text-[13.5px] text-rose animate-fade">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /><span className="flex-1">{generalError}</span>
                    </div>
                  )}
                </div>

                <button
                  type="submit" disabled={pending} aria-disabled={pending}
                  className="group relative mt-1 inline-flex h-13 w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-cta text-[15.5px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.99] disabled:cursor-wait focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
                >
                  {pending
                    ? <><span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />{t("apply.sending")}</>
                    : <>{t("apply.submit")}<ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></>}
                </button>
              </form>
            )}
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}

/* ——— pieces ——— */

type TextFieldProps = {
  id: string; field: Field; label: ReactNode; error?: string; errId: string; ok: boolean; hint?: string; hintId?: string;
  value: string; onChange: (v: string) => void;
} & Omit<React.ComponentProps<"input">, "onChange" | "id" | "value">;

function TextField({ id, field, label, error, errId, ok, hint, hintId, value, onChange, ...p }: TextFieldProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="label">{label}</label>
      <div className="relative">
        <input
          id={id} data-field={field} {...p} value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error) || undefined} aria-describedby={cx(error && errId, hint && hintId) || undefined}
          className={cx("field", ok && value ? "!pr-10" : "", error && "!border-rose/60")}
        />
        {ok && value ? <Check className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-green animate-fade" strokeWidth={2.2} aria-hidden /> : null}
      </div>
      {error ? <FieldError id={errId}>{error}</FieldError> : hint ? <span id={hintId} className="text-[12px] text-ink-4">{hint}</span> : null}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return <span id={id} className="flex items-center gap-1.5 text-[12.5px] text-rose animate-fade"><AlertCircle className="size-3.5 shrink-0" aria-hidden />{children}</span>;
}

function Collapse({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className={cx("grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.16,1,.3,1)]", open ? "grid-rows-[1fr] opacity-100" : "-mb-4 grid-rows-[0fr] opacity-0")} inert={!open} aria-hidden={!open}>
      <div className="-m-0.5 min-h-0 overflow-hidden p-0.5">{children}</div>
    </div>
  );
}
