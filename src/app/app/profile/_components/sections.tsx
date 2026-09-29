import Link from "next/link";
import type { Fact, Goal, Profile } from "@prisma/client";
import { FileText, TrendingUp } from "lucide-react";
import { Chip, Field } from "@/components/ui";
import { j } from "@/lib/db";
import { REGIONS } from "@/lib/engine/taxonomy";
import { toUSD } from "@/lib/engine/fx";
import { updateBasics, reparseCV } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Disclosure } from "./bits";
import { ConstraintsEditor, SkillsEditor } from "./section-editors";
import { Editable, Facts } from "./editable";
import { placeRu } from "@/lib/ru";
import { getT } from "@/lib/i18n/server";
import { regionName } from "@/lib/i18n/labels";
import type { T } from "@/lib/i18n/translator";
import type { Strength } from "./strengths";

/** Countries the profile names (citizenship choices, location); labels in profilePage.countries. */
const COUNTRIES = ["KZ", "UZ", "KG", "RU", "BY", "UA", "AM", "GE", "AZ", "US", "GB", "CA", "AE", "TR"] as const;
const AUTH_CODES = ["EU", "US", "GB", "CA", "AE", "KZ", "UZ", "KG", "RU", "GE", "AM"] as const;
type CountryKey = (typeof COUNTRIES)[number] | "EU";
const isCountry = (c: string): c is CountryKey => c === "EU" || (COUNTRIES as readonly string[]).includes(c);
const countryName = (t: T, c: string) => (isCountry(c) ? t(`profilePage.countries.${c}`) : c);
const WORK_MODES = ["remote", "hybrid", "onsite", "any"] as const;
const workModeName = (t: T, m: string) => ((WORK_MODES as readonly string[]).includes(m) ? t(`profilePage.workModes.${m as (typeof WORK_MODES)[number]}`) : m);
/** Notice choices of the editor (stored values stay English as before). */
const NOTICE_OPTIONS = [["Immediately", "immediately"], ["1 week", "week1"], ["2 weeks", "weeks2"], ["1 month", "month1"], ["2 months", "months2"]] as const;
/** A stored notice period in the current language: "Immediately" → «Сразу», "3 weeks" → «3 недели»; anything else as written. */
function noticeName(t: T, v: string) {
  const opt = NOTICE_OPTIONS.find(([k]) => k === v);
  if (opt) return t(`profilePage.notice.${opt[1]}`);
  const s = (v ?? "").trim();
  if (/^(immediately|asap|now|right away)$/i.test(s)) return t("profilePage.notice.immediately");
  const m = s.match(/^(\d+(?:[.,]\d+)?)\s*(day|week|month)s?$/i);
  return m ? t(`profilePage.notice.${m[2].toLowerCase() as "day" | "week" | "month"}`, { n: Number(m[1].replace(",", ".")) }) : s;
}
const yearsText = (t: T, y: number) => t("profilePage.years", { n: Math.round(y * 10) / 10 });
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

function Ext({ href }: { href: string }) {
  if (!href) return null;
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">{host(href)}</a>;
}

/* ───────────── Основное ───────────── */

export async function Basics({ name, email, profile: p, goal, currentRole, hh }: { name: string; email: string; profile: Profile; goal: Goal | null; currentRole: string; hh?: { connected: boolean; name: string; resume: string } | null }) {
  const t = await getT();
  const markets = [...new Set(j<string[]>(goal?.countries, []).map((c) => { const r = regionName(t, c); return r !== c ? r : REGIONS[c]?.label ?? c; }))].join(", ");
  // Stored city names are shown as written; the Russian UI spells known English names in Russian («Almaty» → «Алматы»).
  const city = p.city || p.location;
  const location = [t.locale === "ru" ? placeRu(city) : city, countryName(t, p.country)].filter(Boolean).join(", ");
  return (
    <Editable
      id="basics" title={t("profilePage.basics.title")}
      view={
        <div className="flex flex-col gap-5">
          <Facts cols={3} rows={[
            [t("profilePage.basics.currentRole"), currentRole],
            [t("profilePage.basics.experience"), p.yearsExperience ? yearsText(t, p.yearsExperience) : ""],
            [t("profilePage.basics.english"), p.englishLevel],
            [t("profilePage.basics.city"), location],
            [t("profilePage.basics.markets"), markets],
            [t("profilePage.basics.email"), email],
          ]} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[14px]">
            <span className="text-ink-3">LinkedIn: {p.linkedin ? <Ext href={p.linkedin} /> : <span className="text-amber">{t("profilePage.basics.notAdded")}</span>}</span>
            {p.github && <span className="text-ink-3">GitHub: <Ext href={p.github} /></span>}
            {p.portfolio && <span className="text-ink-3">{t("profilePage.basics.portfolio")}: <Ext href={p.portfolio} /></span>}
            {p.phone && <span className="text-ink-3">{t("profilePage.basics.phone")}: <span className="text-head">{p.phone}</span></span>}
            {hh && (
              <span className="text-ink-3">
                hh.kz:{" "}
                {hh.connected ? (
                  <span className="text-head">{hh.name || t("profilePage.basics.hhConnected")}{hh.resume ? ` · ${t("profilePage.basics.hhResume", { title: hh.resume })}` : <span className="text-amber"> · {t("profilePage.basics.hhNoResume")}</span>}</span>
                ) : (
                  <Link href="/app/agent#hh" className="inline-flex min-h-10 items-center rounded text-amber underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">{t("profilePage.basics.hhNotConnected")}</Link>
                )}
              </span>
            )}
          </div>
          {p.summary && <p className="max-w-3xl text-[14px] leading-relaxed text-ink-2">{p.summary}</p>}
        </div>
      }
      editor={
        <ActionForm action={updateBasics} closeDetailsOnSuccess className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("profilePage.basics.name")}><input name="name" required minLength={2} autoComplete="name" defaultValue={name} className="field" /></Field>
            <Field label={t("profilePage.basics.currentRole")} hint={t("profilePage.basics.headlineHint")}><input name="headline" defaultValue={p.headline || currentRole} className="field" placeholder="Product Analyst" /></Field>
            <Field label={t("profilePage.basics.yearsField")}><input name="yearsExperience" type="number" step="0.5" min={0} max={50} inputMode="decimal" defaultValue={p.yearsExperience} className="field" /></Field>
            <Field label={t("profilePage.basics.english")}>
              <select name="englishLevel" defaultValue={p.englishLevel} className="field">
                {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <Field label={t("profilePage.basics.city")}><input name="city" autoComplete="address-level2" defaultValue={p.city || p.location} className="field" placeholder={t("profilePage.basics.cityPlaceholder")} /></Field>
            <Field label={t("profilePage.basics.country")} hint={t("profilePage.basics.countryHint")}><input name="country" maxLength={2} autoComplete="country" defaultValue={p.country} className="field uppercase" /></Field>
            <Field label={t("profilePage.basics.phone")}><input name="phone" type="tel" autoComplete="tel" defaultValue={p.phone} className="field" placeholder="+7 …" /></Field>
            <Field label="LinkedIn"><input name="linkedin" inputMode="url" defaultValue={p.linkedin} className="field" placeholder="linkedin.com/in/…" /></Field>
            <Field label="GitHub"><input name="github" inputMode="url" defaultValue={p.github} className="field" placeholder="github.com/…" /></Field>
            <Field label={t("profilePage.basics.portfolio")}><input name="portfolio" inputMode="url" defaultValue={p.portfolio} className="field" placeholder="https://…" /></Field>
            <Field label={t("profilePage.basics.summary")} className="sm:col-span-2" hint={t("profilePage.basics.summaryHint")}><textarea name="summary" rows={3} defaultValue={p.summary} className="field resize-y" /></Field>
          </div>
          <div><FormSubmit pendingText={t("profilePage.saving")}>{t("profilePage.save")}</FormSubmit></div>
        </ActionForm>
      }
    />
  );
}

/* ───────────── Навыки ───────────── */

export async function Skills({ skills, facts }: { skills: string[]; facts: Fact[] }) {
  const t = await getT();
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const fromFacts = [...new Set(facts.flatMap((f) => j<string[]>(f.tech, [])))].filter((x) => !have.has(x.toLowerCase())).slice(0, 12);
  return (
    <Editable
      id="skills" title={t("profilePage.skills.title")}
      view={skills.length ? (
        <ul className="flex flex-wrap gap-2" aria-label={t("profilePage.skills.title")}>
          {skills.map((s) => <li key={s} className="rounded-full border border-line bg-white/80 px-3 py-1 text-[13.5px] text-head">{s}</li>)}
        </ul>
      ) : <p className="text-[14px] text-ink-3">{t("profilePage.skills.empty")}</p>}
      editor={<SkillsEditor skills={skills} fromFacts={fromFacts} />}
    />
  );
}

/* ───────────── Career strengths ───────────── */

export async function Strengths({ items }: { items: Strength[] }) {
  const t = await getT();
  return (
    <Editable
      id="strengths" title={t("profilePage.strengths.title")} sub={t("profilePage.strengths.sub")}
      view={items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <li key={s.key} className="flex flex-col gap-2 rounded-2xl border border-line bg-white/65 p-4">
              <div className="h-serif text-[19px]">{t(`profilePage.strengths.themes.${s.key}`)}</div>
              {s.metric && <div className="flex items-start gap-1.5 text-[13px] text-green"><TrendingUp className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden /><span className="line-clamp-2">{s.teamSize ? t("profilePage.strengths.teamUpTo", { n: s.teamSize }) : s.metric}</span></div>}
              {s.evidence.length > 0 && <div className="text-[12.5px] text-ink-3">{s.evidence.join(" · ")}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-ink-3">{t("profilePage.strengths.empty")}</p>
      )}
    />
  );
}

/* ───────────── Ограничения ───────────── */

export async function Constraints({ profile: p, goal }: { profile: Profile; goal: Goal | null }) {
  const t = await getT();
  const auth = j<string[]>(p.workAuth, []);
  const hasEU = REGIONS.EU.countries.every((c) => auth.includes(c));
  const authLabels = [...(hasEU ? [countryName(t, "EU")] : []), ...auth.filter((c) => !(hasEU && REGIONS.EU.countries.includes(c))).map((c) => countryName(t, c))];
  const minSalary = goal?.minSalary ? t.money(goal.minSalary, goal.currency) : p.salaryExpectation ? t.money(p.salaryExpectation, "USD") : "";
  const yesNo = (v: boolean) => (v ? t("common.yes") : t("common.no"));
  // Work format lives in the goal (the agent searches by it) — show it exactly as the Goal page does.
  const goalModes = j<string[]>(goal?.workModes, []);
  const workFormat = goalModes.length ? goalModes.map((m) => workModeName(t, m)).join(", ") : workModeName(t, p.remotePref);
  return (
    <Editable
      id="constraints" title={t("profilePage.constraints.title")} sub={t("profilePage.constraints.sub")}
      view={
        <Facts cols={3} rows={[
          [t("profilePage.constraints.visa"), yesNo(p.needsSponsorship)],
          [t("profilePage.constraints.relocation"), yesNo(goal?.relocation ?? p.relocation)],
          [t("profilePage.constraints.workFormat"), workFormat],
          [t("profilePage.constraints.minSalary"), minSalary ? t("profilePage.constraints.perYear", { amount: minSalary }) : ""],
          [t("profilePage.constraints.workAuth"), authLabels.join(", ")],
          [t("profilePage.constraints.notice"), noticeName(t, p.noticePeriod)],
        ]} />
      }
      editor={
        <ConstraintsEditor d={{
          citizenship: p.citizenship, citizenshipOptions: COUNTRIES.map((c) => [c, countryName(t, c)]),
          remotePref: p.remotePref, remoteOptions: WORK_MODES.map((m) => [m, workModeName(t, m)]), workFormat: goalModes.length ? workFormat : null,
          minSalary: goal?.minSalary ? toUSD(goal.minSalary, goal.currency) : p.salaryExpectation || "",
          minSalaryHint: goal?.minSalary && goal.currency !== "USD" ? t("profilePage.constraints.minSalaryHintConverted", { amount: t.money(goal.minSalary, goal.currency) }) : t("profilePage.constraints.minSalaryHint"),
          noticePeriod: p.noticePeriod, noticeOptions: NOTICE_OPTIONS.map(([k, key]) => [k, t(`profilePage.notice.${key}`)]),
          authOptions: AUTH_CODES.map((c) => [c, countryName(t, c)]), authChecked: AUTH_CODES.filter((c) => (c === "EU" ? hasEU : auth.includes(c))),
          authHidden: auth.filter((c) => !(AUTH_CODES as readonly string[]).includes(c) && !REGIONS.EU.countries.includes(c)),
          needsSponsorship: p.needsSponsorship, relocation: goal?.relocation ?? p.relocation,
        }} />
      }
    />
  );
}

/* ───────────── CV source ───────────── */

export async function CvSection({ profile: p }: { profile: Profile }) {
  const t = await getT();
  return (
    <Editable
      id="cv" title={t("profilePage.cv.title")}
      view={
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><FileText className="size-5" strokeWidth={1.7} aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] text-head">{p.cvFileName || (p.cvText ? t("profilePage.cv.text") : t("profilePage.cv.none"))}</div>
            <div className="text-[12.5px] text-ink-3">{t("profilePage.cv.updated", { date: t.date(p.updatedAt, "dayMonthYear") })}</div>
          </div>
          {p.cvText && <Chip>{t("profilePage.cv.sourceSaved")}</Chip>}
          {p.cvText && (
            <Disclosure tone="ghost" summary={t("profilePage.cv.showText")} className="w-full">
              <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13px] text-ink-2">{p.cvText}</pre>
            </Disclosure>
          )}
        </div>
      }
      editor={
        <ActionForm action={reparseCV} resetOnSuccess className="flex flex-col gap-3">
          <Field label={t("profilePage.cv.newText")} hint={t("profilePage.cv.newTextHint")}>
            <textarea name="cvText" rows={6} required minLength={200} className="field resize-y text-[14px]" placeholder={t("profilePage.cv.placeholder")} />
          </Field>
          <div><FormSubmit variant="glass" pendingText={t("profilePage.cv.parsing")}>{t("profilePage.cv.parse")}</FormSubmit></div>
        </ActionForm>
      }
    />
  );
}
