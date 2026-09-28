import type { Fact, Profile } from "@prisma/client";
import { BadgeCheck, FileText, Plus, X } from "lucide-react";
import { Card, Chip, Field } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { j } from "@/lib/db";
import { updateIdentity, updateConditions, addSkill, removeSkill, reparseCV } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "./action-form";
import { Check, Disclosure } from "./bits";

export function IdentityForm({ name, email, profile: p }: { name: string; email: string; profile: Profile }) {
  return (
    <Card>
      <ActionForm action={updateIdentity} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Имя *"><input name="name" required minLength={2} autoComplete="name" defaultValue={name} className="field" /></Field>
          <Field label="Email" hint="Логин аккаунта — меняется через поддержку"><input value={email} readOnly aria-readonly className="field !bg-white/40 text-ink-3" /></Field>
          <Field label="Headline" className="sm:col-span-2"><input name="headline" defaultValue={p.headline} className="field" placeholder="Data Analyst · SQL, Python, Power BI" /></Field>
          <Field label="Город"><input name="city" autoComplete="address-level2" defaultValue={p.city || p.location} className="field" placeholder="Алматы" /></Field>
          <Field label="Страна (код)"><input name="country" maxLength={2} autoComplete="country" defaultValue={p.country} className="field uppercase" placeholder="KZ" /></Field>
          <Field label="Телефон"><input name="phone" type="tel" autoComplete="tel" defaultValue={p.phone} className="field" placeholder="+7 ..." /></Field>
          <Field label="LinkedIn"><input name="linkedin" type="text" inputMode="url" defaultValue={p.linkedin} className="field" placeholder="linkedin.com/in/…" /></Field>
          <Field label="GitHub"><input name="github" type="text" inputMode="url" defaultValue={p.github} className="field" placeholder="github.com/…" /></Field>
          <Field label="Портфолио"><input name="portfolio" type="text" inputMode="url" defaultValue={p.portfolio} className="field" placeholder="https://…" /></Field>
          <Field label="Summary" className="sm:col-span-2" hint="Коротко о себе. Агент адаптирует подачу под вакансию, но не добавит того, чего здесь нет."><textarea name="summary" rows={3} defaultValue={p.summary} className="field resize-y" /></Field>
        </div>
        <div><FormSubmit pendingText="Сохраняем…">Сохранить контакты</FormSubmit></div>
      </ActionForm>
    </Card>
  );
}

export function ConditionsForm({ profile: p }: { profile: Profile }) {
  const langs = j<{ lang: string; level: string }[]>(p.languages, []);
  return (
    <Card>
      <ActionForm action={updateConditions} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Гражданство (код)"><input name="citizenship" maxLength={2} defaultValue={p.citizenship} className="field uppercase" /></Field>
          <Field label="Право на работу" hint="Коды стран через запятую: KZ, DE"><input name="workAuth" defaultValue={j<string[]>(p.workAuth, []).join(", ")} className="field uppercase" /></Field>
          <Field label="Опыт, лет" hint="Реальный оплачиваемый опыт"><input name="yearsExperience" type="number" step="0.1" min={0} max={50} inputMode="decimal" defaultValue={p.yearsExperience} className="field" /></Field>
          <Field label="English level">
            <select name="englishLevel" defaultValue={p.englishLevel} className="field">
              {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Ожидание, USD / год"><input name="salaryExpectation" type="number" min={0} step={1000} inputMode="numeric" defaultValue={p.salaryExpectation || ""} className="field" placeholder="60000" /></Field>
          <Field label="Notice period"><input name="noticePeriod" defaultValue={p.noticePeriod} className="field" placeholder="2 weeks" /></Field>
          <Field label="Формат">
            <select name="remotePref" defaultValue={p.remotePref} className="field">
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
              <option value="any">Любой</option>
            </select>
          </Field>
          <Field label="Языки" className="sm:col-span-2" hint="По одному на строку: English — C1">
            <textarea name="languages" rows={3} defaultValue={langs.map((l) => `${l.lang} — ${l.level}`).join("\n")} className="field resize-y" />
          </Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Check name="needsSponsorship" defaultChecked={p.needsSponsorship} label="Нужно визовое спонсорство" hint="Агент будет блокировать onsite-вакансии без спонсорства." />
          <Check name="relocation" defaultChecked={p.relocation} label="Готов(а) к релокации" />
        </div>
        <p className="text-[12.5px] text-ink-3">Право на работу — юридический факт: агент никогда не изменит и не «округлит» его в анкетах.</p>
        <div><FormSubmit pendingText="Сохраняем…">Сохранить условия</FormSubmit></div>
      </ActionForm>
    </Card>
  );
}

export function SkillsEditor({ skills, facts }: { skills: string[]; facts: Fact[] }) {
  const evidence = (skill: string) => {
    const k = skill.toLowerCase();
    return facts.filter((f) => j<string[]>(f.tech, []).some((t) => t.toLowerCase() === k) || `${f.title} ${f.details} ${f.metrics}`.toLowerCase().includes(k));
  };
  const rows = skills.map((s) => ({ s, ev: evidence(s) }));
  const evidenced = rows.filter((r) => r.ev.length).length;
  const have = new Set(skills.map((s) => s.toLowerCase()));
  const fromFacts = [...new Set(facts.flatMap((f) => j<string[]>(f.tech, [])))].filter((t) => !have.has(t.toLowerCase()));
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-3">
        <span><span className="num text-head">{evidenced}</span> из <span className="num text-head">{skills.length}</span> навыков подтверждены фактами</span>
        <span className="inline-flex items-center gap-1.5"><BadgeCheck className="size-3.5 text-green" strokeWidth={1.8} aria-hidden />есть в опыте</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-amber" aria-hidden />только заявлен</span>
      </div>
      {skills.length === 0 ? (
        <p className="text-[14px] text-ink-3">Навыков пока нет — добавьте их ниже или из технологий в ваших фактах.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {rows.map(({ s, ev }) => (
            <li key={s}>
              <form action={removeSkill} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 py-1 pl-3 pr-1 text-[13.5px] text-head">
                {ev.length ? (
                  <BadgeCheck className="size-3.5 text-green" strokeWidth={1.8} aria-label="подтверждён фактами" />
                ) : (
                  <span className="size-1.5 rounded-full bg-amber" aria-label="не подтверждён фактами" role="img" />
                )}
                <span title={ev.length ? `Подтверждено: ${ev.map((f) => f.title).join(", ")}` : "Нет факта, где используется этот навык"}>{s}</span>
                <input type="hidden" name="skill" value={s} />
                <button type="submit" aria-label={`Удалить навык ${s}`} className="grid size-6 place-items-center rounded-full text-ink-4 transition-colors hover:bg-rose-soft hover:text-rose focus-visible:outline-2 focus-visible:outline-green">
                  <X className="size-3.5" strokeWidth={1.8} aria-hidden />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addSkill} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="add-skill">Новый навык</label>
        <input id="add-skill" name="skill" required className="field sm:max-w-sm" placeholder="Например: dbt, Looker (через запятую)" />
        <SubmitButton variant="glass" pendingText="Добавляем…"><Plus className="size-4" strokeWidth={1.7} aria-hidden />Добавить</SubmitButton>
      </form>
      {fromFacts.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <div className="label">Есть в фактах, но не в навыках</div>
          <div className="flex flex-wrap gap-2">
            {fromFacts.map((t) => (
              <form key={t} action={addSkill}>
                <input type="hidden" name="skill" value={t} />
                <button type="submit" className="inline-flex items-center gap-1 rounded-full border border-dashed border-green/35 px-3 py-1 text-[13px] text-green transition-colors hover:bg-green-soft focus-visible:outline-2 focus-visible:outline-green">
                  <Plus className="size-3" strokeWidth={2} aria-hidden />{t}
                </button>
              </form>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

export function CvSection({ profile: p }: { profile: Profile }) {
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-teal/10 text-teal"><FileText className="size-5" strokeWidth={1.7} aria-hidden /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] text-head">{p.cvFileName || (p.cvText ? "Текст CV" : "CV не загружено")}</div>
          <div className="text-[12.5px] text-ink-3"><span className="num">{p.cvText.length.toLocaleString("ru-RU")}</span> символов · обновлено {p.updatedAt.toLocaleDateString("ru-RU")}</div>
        </div>
        {p.cvText && <Chip tone="green">исходник сохранён</Chip>}
      </div>
      {p.cvText && (
        <Disclosure tone="ghost" summary="Показать текст CV">
          <pre className="scroll-thin max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-white/60 p-4 font-sans text-[13px] text-ink-2">{p.cvText}</pre>
        </Disclosure>
      )}
      <ActionForm action={reparseCV} resetOnSuccess className="flex flex-col gap-3 border-t border-line pt-4">
        <Field label="Разобрать CV заново" hint="Новые факты добавятся как Unverified. Существующие факты и ваши подтверждения не удаляются.">
          <textarea name="cvText" rows={6} required minLength={200} className="field resize-y text-[14px]" placeholder="Вставьте полный текст CV…" />
        </Field>
        <div><FormSubmit variant="glass" pendingText="Разбираем CV…">Разобрать и добавить факты</FormSubmit></div>
      </ActionForm>
    </Card>
  );
}
