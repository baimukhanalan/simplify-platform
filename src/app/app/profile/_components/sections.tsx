import Link from "next/link";
import type { Fact, Goal, Profile } from "@prisma/client";
import { FileText, TrendingUp } from "lucide-react";
import { Chip, Field } from "@/components/ui";
import { j } from "@/lib/db";
import { REGIONS, fmtMoney } from "@/lib/engine/taxonomy";
import { toUSD } from "@/lib/engine/fx";
import { updateBasics, reparseCV } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Disclosure } from "./bits";
import { ConstraintsEditor, SkillsEditor } from "./section-editors";
import { Editable, Facts } from "./editable";
import { WORK_MODE_RU, plural, regionRu } from "../../../_components/ru";
import { noticeRu, placeRu } from "@/lib/ru";
import type { Strength } from "./strengths";

const COUNTRY_LABEL: Record<string, string> = { KZ: "Казахстан", UZ: "Узбекистан", KG: "Кыргызстан", RU: "Россия", BY: "Беларусь", UA: "Украина", AM: "Армения", GE: "Грузия", AZ: "Азербайджан", US: "США", GB: "Великобритания", CA: "Канада", AE: "ОАЭ", TR: "Турция" };
const AUTH_OPTIONS: [string, string][] = [["EU", "Евросоюз"], ["US", "США"], ["GB", "Великобритания"], ["CA", "Канада"], ["AE", "ОАЭ"], ["KZ", "Казахстан"], ["UZ", "Узбекистан"], ["KG", "Кыргызстан"], ["RU", "Россия"], ["GE", "Грузия"], ["AM", "Армения"]];
const REMOTE_LABEL = WORK_MODE_RU;
/** Citizenship choices; anything else goes through «Другое» as an ISO code (the action accepts two letters only). */
const CITIZENSHIP_OPTIONS: [string, string][] = Object.entries(COUNTRY_LABEL);
const NOTICE_LABEL: Record<string, string> = { Immediately: "Сразу", "1 week": "Через неделю", "2 weeks": "Через 2 недели", "1 month": "Через месяц", "2 months": "Через 2 месяца" };
const usd = (n: number) => fmtMoney(n);
const yearsText = (y: number) => {
  const n = Math.round(y * 10) / 10;
  if (!Number.isInteger(n)) return `${n.toLocaleString("ru-RU")} года`;
  return `${n} ${plural(n, ["год", "года", "лет"])}`;
};
const host = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");

function Ext({ href }: { href: string }) {
  if (!href) return null;
  const url = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded text-head underline decoration-line underline-offset-4 hover:decoration-teal focus-visible:outline-2 focus-visible:outline-green">{host(href)}</a>;
}

/* ───────────── Основное ───────────── */

export function Basics({ name, email, profile: p, goal, currentRole, hh }: { name: string; email: string; profile: Profile; goal: Goal | null; currentRole: string; hh?: { connected: boolean; name: string; resume: string } | null }) {
  const markets = [...new Set(j<string[]>(goal?.countries, []).map((c) => (regionRu(c) !== c ? regionRu(c) : REGIONS[c]?.label ?? c)))].join(", ");
  const location = [placeRu(p.city || p.location), COUNTRY_LABEL[p.country] ?? p.country].filter(Boolean).join(", ");
  return (
    <Editable
      id="basics" title="Основное"
      view={
        <div className="flex flex-col gap-5">
          <Facts cols={3} rows={[
            ["Текущая роль", currentRole],
            ["Опыт", p.yearsExperience ? yearsText(p.yearsExperience) : ""],
            ["Английский", p.englishLevel],
            ["Город", location],
            ["Регионы поиска", markets],
            ["Email", email],
          ]} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4 text-[14px]">
            <span className="text-ink-3">LinkedIn: {p.linkedin ? <Ext href={p.linkedin} /> : <span className="text-amber">не добавлен</span>}</span>
            {p.github && <span className="text-ink-3">GitHub: <Ext href={p.github} /></span>}
            {p.portfolio && <span className="text-ink-3">Портфолио: <Ext href={p.portfolio} /></span>}
            {p.phone && <span className="text-ink-3">Телефон: <span className="text-head">{p.phone}</span></span>}
            {hh && (
              <span className="text-ink-3">
                hh.kz:{" "}
                {hh.connected ? (
                  <span className="text-head">{hh.name || "подключён"}{hh.resume ? ` · резюме «${hh.resume}»` : <span className="text-amber"> · резюме не выбрано</span>}</span>
                ) : (
                  <Link href="/app/agent#hh" className="inline-flex min-h-10 items-center rounded text-amber underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">не подключён</Link>
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
            <Field label="Имя"><input name="name" required minLength={2} autoComplete="name" defaultValue={name} className="field" /></Field>
            <Field label="Текущая роль" hint="Как ты называешь свою роль сейчас"><input name="headline" defaultValue={p.headline || currentRole} className="field" placeholder="Product Analyst" /></Field>
            <Field label="Опыт, лет"><input name="yearsExperience" type="number" step="0.5" min={0} max={50} inputMode="decimal" defaultValue={p.yearsExperience} className="field" /></Field>
            <Field label="Английский">
              <select name="englishLevel" defaultValue={p.englishLevel} className="field">
                {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Город"><input name="city" autoComplete="address-level2" defaultValue={p.city || p.location} className="field" placeholder="Алматы" /></Field>
            <Field label="Страна (код)" hint="Например, KZ"><input name="country" maxLength={2} autoComplete="country" defaultValue={p.country} className="field uppercase" /></Field>
            <Field label="Телефон"><input name="phone" type="tel" autoComplete="tel" defaultValue={p.phone} className="field" placeholder="+7 …" /></Field>
            <Field label="LinkedIn"><input name="linkedin" inputMode="url" defaultValue={p.linkedin} className="field" placeholder="linkedin.com/in/…" /></Field>
            <Field label="GitHub"><input name="github" inputMode="url" defaultValue={p.github} className="field" placeholder="github.com/…" /></Field>
            <Field label="Портфолио"><input name="portfolio" inputMode="url" defaultValue={p.portfolio} className="field" placeholder="https://…" /></Field>
            <Field label="О себе" className="sm:col-span-2" hint="Пара предложений. Агент адаптирует подачу под вакансию."><textarea name="summary" rows={3} defaultValue={p.summary} className="field resize-y" /></Field>
          </div>
          <div><FormSubmit pendingText="Сохраняем…">Сохранить</FormSubmit></div>
        </ActionForm>
      }
    />
  );
}

/* ───────────── Навыки ───────────── */

export function Skills({ skills, facts }: { skills: string[]; facts: Fact[] }) {
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const fromFacts = [...new Set(facts.flatMap((f) => j<string[]>(f.tech, [])))].filter((t) => !have.has(t.toLowerCase())).slice(0, 12);
  return (
    <Editable
      id="skills" title="Навыки"
      view={skills.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Навыки">
          {skills.map((s) => <li key={s} className="rounded-full border border-line bg-white/80 px-3 py-1 text-[13.5px] text-head">{s}</li>)}
        </ul>
      ) : <p className="text-[14px] text-ink-3">Навыков пока нет — они появятся из CV или добавь их вручную.</p>}
      editor={<SkillsEditor skills={skills} fromFacts={fromFacts} />}
    />
  );
}

/* ───────────── Career strengths ───────────── */

export function Strengths({ items }: { items: Strength[] }) {
  return (
    <Editable
      id="strengths" title="Сильные стороны" sub="Что повторяется в твоём опыте. Агент строит на этом позиционирование в CV и на интервью."
      view={items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => (
            <li key={s.label} className="flex flex-col gap-2 rounded-2xl border border-line bg-white/65 p-4">
              <div className="h-serif text-[19px]">{s.label}</div>
              {s.metric && <div className="flex items-start gap-1.5 text-[13px] text-green"><TrendingUp className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden /><span className="line-clamp-2">{s.metric}</span></div>}
              {s.evidence.length > 0 && <div className="text-[12.5px] text-ink-3">{s.evidence.join(" · ")}</div>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-ink-3">Появятся, когда в опыте будет больше деталей. Лучше всего работают результаты в цифрах — добавь их в разделе «Опыт».</p>
      )}
    />
  );
}

/* ───────────── Ограничения ───────────── */

export function Constraints({ profile: p, goal }: { profile: Profile; goal: Goal | null }) {
  const auth = j<string[]>(p.workAuth, []);
  const hasEU = REGIONS.EU.countries.every((c) => auth.includes(c));
  const authLabels = [...(hasEU ? ["Евросоюз"] : []), ...auth.filter((c) => !(hasEU && REGIONS.EU.countries.includes(c))).map((c) => COUNTRY_LABEL[c] ?? c)];
  const minSalary = goal?.minSalary ? (goal.currency === "USD" ? usd(goal.minSalary) : fmtMoney(goal.minSalary, goal.currency)) : p.salaryExpectation ? usd(p.salaryExpectation) : "";
  const yesNo = (v: boolean) => (v ? "Да" : "Нет");
  // Work format lives in the goal (the agent searches by it) — show it exactly as the Goal page does.
  const goalModes = j<string[]>(goal?.workModes, []);
  const workFormat = goalModes.length ? goalModes.map((m) => WORK_MODE_RU[m] ?? m).join(", ") : REMOTE_LABEL[p.remotePref] ?? p.remotePref;
  return (
    <Editable
      id="constraints" title="Ограничения" sub="Агент не подаётся туда, где эти условия не выполняются."
      view={
        <Facts cols={3} rows={[
          ["Нужна рабочая виза", yesNo(p.needsSponsorship)],
          ["Переезд", yesNo(goal?.relocation ?? p.relocation)],
          ["Формат работы", workFormat],
          ["Минимальная зарплата", minSalary ? `${minSalary} / год` : ""],
          ["Право на работу", authLabels.join(", ")],
          ["Выход на работу", NOTICE_LABEL[p.noticePeriod] ?? noticeRu(p.noticePeriod)],
        ]} />
      }
      editor={
        <ConstraintsEditor d={{
          citizenship: p.citizenship, citizenshipOptions: CITIZENSHIP_OPTIONS,
          remotePref: p.remotePref, remoteOptions: Object.entries(REMOTE_LABEL), workFormat: goalModes.length ? workFormat : null,
          minSalary: goal?.minSalary ? toUSD(goal.minSalary, goal.currency) : p.salaryExpectation || "",
          minSalaryHint: goal?.minSalary && goal.currency !== "USD" ? `≈ ${fmtMoney(goal.minSalary, goal.currency)}; пусто — не менять` : "Пусто — не менять",
          noticePeriod: p.noticePeriod, noticeOptions: Object.entries(NOTICE_LABEL),
          authOptions: AUTH_OPTIONS, authChecked: AUTH_OPTIONS.map(([c]) => c).filter((c) => (c === "EU" ? hasEU : auth.includes(c))),
          authHidden: auth.filter((c) => !AUTH_OPTIONS.some(([k]) => k === c) && !REGIONS.EU.countries.includes(c)),
          needsSponsorship: p.needsSponsorship, relocation: goal?.relocation ?? p.relocation,
        }} />
      }
    />
  );
}

/* ───────────── CV source ───────────── */

export function CvSection({ profile: p }: { profile: Profile }) {
  return (
    <Editable
      id="cv" title="CV"
      view={
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><FileText className="size-5" strokeWidth={1.7} aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] text-head">{p.cvFileName || (p.cvText ? "Текст CV" : "CV не загружено")}</div>
            <div className="text-[12.5px] text-ink-3">Обновлено {p.updatedAt.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty" })}</div>
          </div>
          {p.cvText && <Chip>исходник сохранён</Chip>}
          {p.cvText && (
            <Disclosure tone="ghost" summary="Показать текст" className="w-full">
              <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13px] text-ink-2">{p.cvText}</pre>
            </Disclosure>
          )}
        </div>
      }
      editor={
        <ActionForm action={reparseCV} resetOnSuccess className="flex flex-col gap-3">
          <Field label="Новый текст CV" hint="Агент добавит новые позиции. То, что уже есть в профиле, не удаляется.">
            <textarea name="cvText" rows={6} required minLength={200} className="field resize-y text-[14px]" placeholder="Вставь полный текст CV…" />
          </Field>
          <div><FormSubmit variant="glass" pendingText="Разбираем CV…">Разобрать</FormSubmit></div>
        </ActionForm>
      }
    />
  );
}
