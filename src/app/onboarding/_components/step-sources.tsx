"use client";
import { useEffect, useId, useState, type ReactNode } from "react";
import { FileText, Link2, FolderGit2, Globe, Award, Check } from "lucide-react";
import { saveSources, type FormState } from "@/lib/actions/onboarding";
import { cx } from "@/components/ui";
import { CvInput } from "../../check/_components/cv-input";
import { useActionForm } from "../../_components/use-action-form";
import { FieldErr, FormAlert } from "./shared";

type Links = { linkedin: string; github: string; portfolio: string };

const LINKS: { key: keyof Links; label: string; icon: typeof Link2; placeholder: string }[] = [
  { key: "linkedin", label: "LinkedIn", icon: Link2, placeholder: "linkedin.com/in/…" },
  { key: "github", label: "GitHub", icon: FolderGit2, placeholder: "github.com/…" },
  { key: "portfolio", label: "Портфолио", icon: Globe, placeholder: "https://…" },
];

export function StepSources({ hasCv, cvFileName, factCount, skillCount, links, certificates }: { hasCv: boolean; cvFileName: string; factCount: number; skillCount: number; links: Links; certificates: string[] }) {
  const { state, pending, formAction, onSubmit } = useActionForm<FormState>(saveSources, undefined);
  const [chars, setChars] = useState(0);
  const [replace, setReplace] = useState(!hasCv);
  const id = useId();
  const f = state?.fields ?? {};
  const willParse = replace && chars >= 120;

  return (
    <form action={formAction} onSubmit={onSubmit} noValidate aria-busy={pending} className="relative flex flex-col gap-4">
      <fieldset disabled={pending} className="contents">
        <Block icon={<FileText className="size-[18px]" strokeWidth={1.7} />} title="CV" hint="PDF или текст. Я вытащу опыт, достижения, навыки и контакты.">
          {!replace ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-green/20 bg-green-soft/50 p-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-green"><Check className="size-4" strokeWidth={2.4} aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium text-head">{cvFileName || "CV загружено"}</span>
                  <span className="block text-[12.5px] text-ink-3">{factCount} позиций · {skillCount} навыков</span>
                </span>
              </div>
              <button type="button" onClick={() => setReplace(true)} className="inline-flex h-11 items-center justify-center rounded-full px-4 text-[14px] text-head hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-green">Загрузить новое</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <CvInput onTextChange={(t) => setChars(t.trim().length)} />
              <FieldErr id={`${id}-cv`}>{f.cvText}</FieldErr>
            </div>
          )}
        </Block>

        <Block icon={<Link2 className="size-[18px]" strokeWidth={1.7} />} title="Ссылки" hint="Многие формы заявок требуют LinkedIn — я подставлю его сам.">
          <div className="grid gap-3 sm:grid-cols-3">
            {LINKS.map((l) => {
              const Icon = l.icon;
              return (
                <div key={l.key} className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-${l.key}`} className="label">{l.label}</label>
                  <div className="relative">
                    <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-4" strokeWidth={1.7} aria-hidden />
                    <input id={`${id}-${l.key}`} name={l.key} defaultValue={links[l.key]} inputMode="url" autoComplete="url" maxLength={200} placeholder={l.placeholder}
                      aria-invalid={Boolean(f[l.key])} aria-describedby={f[l.key] ? `${id}-${l.key}-err` : undefined} className="field !pl-10" />
                  </div>
                  <FieldErr id={`${id}-${l.key}-err`}>{f[l.key]}</FieldErr>
                </div>
              );
            })}
          </div>
        </Block>

        <Block icon={<Award className="size-[18px]" strokeWidth={1.7} />} title="Сертификаты" hint="Необязательно. По одному на строку — например, Google Data Analytics, IELTS 7.0.">
          <label htmlFor={`${id}-certs`} className="sr-only">Сертификаты, по одному на строку</label>
          <textarea id={`${id}-certs`} name="certificates" rows={3} maxLength={3000} defaultValue={certificates.join("\n")} placeholder={"Google Data Analytics Certificate\nIELTS 7.0"} className="field resize-y !text-[14px]" />
        </Block>
      </fieldset>

      <FormAlert error={state?.error && !f.cvText ? state.error : undefined} />

      <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        {replace && !hasCv ? (
          <button type="submit" name="noCv" value="1" disabled={pending} className="order-2 inline-flex h-11 items-center justify-center rounded-full px-4 text-[13.5px] text-ink-3 hover:bg-white/60 hover:text-head disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-green sm:order-1">
            Нет CV под рукой — продолжить
          </button>
        ) : <span className="hidden sm:block" />}
        <button type="submit" disabled={pending} className="order-1 inline-flex h-12 items-center justify-center gap-2 rounded-full bg-cta px-6 text-[15px] font-medium text-white shadow-(--shadow-cta) transition-all hover:bg-[#2f2c2c] active:scale-[.98] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green sm:order-2">
          {pending && <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden />}
          {willParse ? "Разобрать и продолжить" : "Дальше"}
        </button>
      </div>

      {pending && willParse && <Reading />}
    </form>
  );
}

function Block({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children: ReactNode }) {
  return (
    <section className="glass flex flex-col gap-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-green-soft text-green" aria-hidden>{icon}</span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[16px] font-medium text-head">{title}</h2>
          <p className="text-[13px] text-ink-3">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const LINES = ["Читаю CV", "Нахожу места работы и проекты", "Ищу результаты в цифрах", "Собираю навыки", "Готовлю вопросы"];

/** The agent-is-reading moment while the CV is parsed. */
function Reading() {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setN((v) => Math.min(LINES.length - 1, v + 1)), 1400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="absolute inset-0 z-10 grid place-items-center rounded-[22px] bg-mint-2/70 backdrop-blur-sm animate-fade">
      <div role="status" className="glass-strong flex w-[min(340px,90%)] flex-col gap-3 p-5">
        <span className="label">Simplify работает</span>
        <ul className="flex flex-col gap-2">
          {LINES.map((l, i) => (
            <li key={l} className={cx("flex items-center gap-2.5 text-[14px] transition-opacity duration-500", i <= n ? "opacity-100" : "opacity-30")}>
              {i < n ? <Check className="size-4 text-green" strokeWidth={2.4} aria-hidden /> : i === n ? <span className="size-4 animate-spin rounded-full border-2 border-green border-t-transparent" aria-hidden /> : <span className="size-4 rounded-full border border-line" aria-hidden />}
              <span className={i === n ? "text-head" : "text-ink-3"}>{l}{i === n ? "…" : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
