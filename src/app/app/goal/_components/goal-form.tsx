"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Compass, Crosshair, Layers } from "lucide-react";
import { Card, Chip, Field, Label, cx } from "@/components/ui";
import { ROLE_FAMILIES, REGIONS, SENIORITY, SENIORITY_LABEL, classifyRole } from "@/lib/engine/taxonomy";
import { saveGoal } from "@/lib/actions/profile";
import { ActionForm, FormSubmit } from "../../profile/_components/action-form";
import { WORK_MODE_RU, count } from "../../../_components/ru";
import { goalRegion } from "./region";

export type GoalValues = {
  primaryRole: string; extraRoles: string[]; seniority: string; minSalary: number; currency: string; countries: string[];
  industries: string[]; workModes: string[]; relocation: boolean; sponsorshipNeeded: boolean; dreamCompanies: string[];
  blockedCompanies: string[]; companySize: string; mode: string;
};

const INDUSTRIES = ["Fintech", "SaaS", "E-commerce", "EdTech", "HealthTech", "AI / ML", "Banking", "Gaming", "Telecom", "Logistics", "Media", "Retail", "Consulting", "GovTech"];
const WORK_MODES = (["remote", "hybrid", "onsite"] as const).map((k) => [k, WORK_MODE_RU[k]] as const);
const SIZES = [["any", "Любой"], ["startup", "Стартап"], ["scaleup", "Растущая компания"], ["corporate", "Корпорация"]] as const;
const MODES = [
  { key: "autonomous", title: "Автономный", icon: Compass, text: "Агент сам находит вакансии, проверяет требования, ранжирует и подаёт в пределах дневного лимита. Тебя спрашивает только об исключениях: юридические вопросы, зарплата, незнакомые вопросы анкет." },
  { key: "target", title: "Точечный", icon: Crosshair, text: "Только компании мечты. Меньше заявок, но каждая глубже: CV и сопроводительное письмо под конкретную компанию, мониторинг новых позиций. Лучше всего работает при Readiness от 70." },
  { key: "mass", title: "Массовый найм", icon: Layers, text: "Быстрый параллельный поток в ролях массового найма — поддержка, продажи, операции, разметка данных, QA. Короткие формы и быстрые ответы: первый оффер как страховка, пока основная цель в работе." },
] as const;

const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€" };
function money(n: number, cur: string) {
  if (!n) return "";
  if (cur === "KZT") return `${n.toLocaleString("ru-RU")} ₸+`;
  return `${CURRENCY_SIGN[cur] ?? ""}${n >= 1000 ? `${Math.round(n / 1000)}k` : n}+`;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function readForm(form: HTMLFormElement): GoalValues {
  const fd = new FormData(form);
  const all = (k: string) => fd.getAll(k).map(String);
  const txt = (k: string) => String(fd.get(k) ?? "");
  const lst = (k: string) => txt(k).split(/[,\n;]/).map((x) => x.trim()).filter(Boolean);
  return {
    primaryRole: txt("primaryRole").trim(), extraRoles: all("extraRoles"), seniority: txt("seniority"), minSalary: Number(txt("minSalary")) || 0,
    currency: txt("currency"), countries: all("countries"), industries: all("industries"), workModes: all("workModes"), relocation: fd.get("relocation") === "on",
    sponsorshipNeeded: fd.get("sponsorshipNeeded") === "on", dreamCompanies: lst("dreamCompanies"), blockedCompanies: lst("blockedCompanies"), companySize: txt("companySize"), mode: txt("mode"),
  };
}

export function GoalForm({ initial, cancelHref }: { initial: GoalValues; cancelHref?: string }) {
  const [v, setV] = useState(initial);
  const roleLabels = Object.entries(ROLE_FAMILIES).filter(([k]) => k !== "other").map(([, f]) => f.label);
  const extraOptions = [...new Set([...roleLabels, ...initial.extraRoles])];
  const industryOptions = [...new Set([...INDUSTRIES, ...initial.industries])];
  const family = classifyRole(v.primaryRole);

  return (
    <ActionForm action={saveGoal} onChange={(e) => setV(readForm(e.currentTarget))} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <input type="hidden" name="after" value="goal" />
      <div className="flex min-w-0 flex-col gap-5">
        <Card className="flex flex-col gap-5">
          <Label>01 · Роль и уровень</Label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Основная роль *" hint={v.primaryRole ? (family !== "other" ? `Распознано: ${ROLE_FAMILIES[family].label}` : "Роль не распознана — поиск будет по ключевым словам") : undefined}>
              <input name="primaryRole" required minLength={2} list="role-options" defaultValue={initial.primaryRole} className="field" placeholder="Data Analyst" />
              <datalist id="role-options">{roleLabels.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="label mb-1.5">Уровень</legend>
              <div className="flex flex-wrap gap-1.5">
                {SENIORITY.map((s) => <Pill key={s} type="radio" name="seniority" value={s} defaultChecked={initial.seniority === s}>{SENIORITY_LABEL[s]}</Pill>)}
              </div>
            </fieldset>
          </div>
          <fieldset>
            <legend className="label mb-2">Дополнительные роли <span className="normal-case tracking-normal">(до 6)</span></legend>
            <div className="flex flex-wrap gap-1.5">
              {extraOptions.map((r) => <Pill key={r} name="extraRoles" value={r} defaultChecked={initial.extraRoles.includes(r)}>{r}</Pill>)}
            </div>
          </fieldset>
        </Card>

        <Card className="flex flex-col gap-5">
          <Label>02 · Деньги и география</Label>
          <div className="grid grid-cols-[1fr_110px] gap-3 sm:max-w-md">
            <Field label="Минимум, в год"><input name="minSalary" type="number" min={0} step={1000} inputMode="numeric" defaultValue={initial.minSalary || ""} className="field" placeholder="60000" /></Field>
            <Field label="Валюта">
              <select name="currency" defaultValue={initial.currency} className="field">
                <option>USD</option><option>EUR</option><option>KZT</option>
              </select>
            </Field>
          </div>
          <fieldset>
            <legend className="label mb-2">Регионы *</legend>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(REGIONS).map(([k, r]) => <Pill key={k} name="countries" value={k} defaultChecked={initial.countries.includes(k)}>{goalRegion(k) === k ? r.label : goalRegion(k)}</Pill>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label mb-2">Формат работы *</legend>
            <div className="flex flex-wrap gap-1.5">
              {WORK_MODES.map(([k, l]) => <Pill key={k} name="workModes" value={k} defaultChecked={initial.workModes.includes(k)}>{l}</Pill>)}
            </div>
          </fieldset>
          <div className="grid gap-2 sm:grid-cols-2">
            <Toggle name="relocation" defaultChecked={initial.relocation} label="Переезд возможен" />
            <Toggle name="sponsorshipNeeded" defaultChecked={initial.sponsorshipNeeded} label="Нужно визовое спонсорство" hint="Без спонсорства вакансии в офисе за рубежом будут недоступны" />
          </div>
        </Card>

        <Card className="flex flex-col gap-5">
          <Label>03 · Компании</Label>
          <fieldset>
            <legend className="label mb-2">Индустрии</legend>
            <div className="flex flex-wrap gap-1.5">
              {industryOptions.map((i) => <Pill key={i} name="industries" value={i} defaultChecked={initial.industries.includes(i)}>{i}</Pill>)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="label mb-2">Размер компании</legend>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map(([k, l]) => <Pill key={k} type="radio" name="companySize" value={k} defaultChecked={initial.companySize === k}>{l}</Pill>)}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Компании мечты" hint="Через запятую. Обязательны для точечного режима."><textarea name="dreamCompanies" rows={3} defaultValue={initial.dreamCompanies.join(", ")} className="field resize-y" placeholder="Kaspi, Revolut, Wise" /></Field>
            <Field label="Не подавать в" hint="Текущий работодатель, компании из чёрного списка"><textarea name="blockedCompanies" rows={3} defaultValue={initial.blockedCompanies.join(", ")} className="field resize-y" /></Field>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <Label>04 · Режим кампании</Label>
          <fieldset className="grid gap-3 md:grid-cols-3">
            <legend className="sr-only">Режим кампании</legend>
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <label key={m.key} className="group/m relative flex cursor-pointer flex-col gap-2 rounded-2xl border border-line bg-white/60 p-4 transition-all hover:bg-white has-[:checked]:border-green/45 has-[:checked]:bg-white has-[:checked]:shadow-(--shadow-glass) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
                  <input type="radio" name="mode" value={m.key} defaultChecked={initial.mode === m.key} className="sr-only" />
                  <span className="flex items-center justify-between">
                    <Icon className="size-5 text-teal" strokeWidth={1.7} aria-hidden />
                    <span className="size-4 rounded-full border border-line bg-white transition-all group-has-[:checked]/m:border-[5px] group-has-[:checked]/m:border-green" aria-hidden />
                  </span>
                  <span className="h-serif text-[19px]">{m.title}</span>
                  <span className="text-[13px] leading-relaxed text-ink-3">{m.text}</span>
                </label>
              );
            })}
          </fieldset>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-8" aria-label="Сводка цели">
        <Card strong className="flex flex-col gap-4">
          <Label>Моя цель</Label>
          <p className="h-serif text-[24px] leading-tight">
            {v.primaryRole || <span className="text-ink-3">Роль не выбрана</span>}
            <span className="text-ink-4"> · </span>
            {SENIORITY_LABEL[v.seniority] ?? cap(v.seniority)}
          </p>
          <SummaryLine text={[
            v.workModes.map((m) => WORK_MODE_RU[m] ?? cap(m)).join(" / ") || "—",
            [...new Set(v.countries.map(goalRegion))].join(" / ") || "—",
            money(v.minSalary, v.currency),
            v.industries.join(" / "),
          ].filter(Boolean).join(" · ")} />
          <div className="flex flex-wrap gap-1.5">
            <Chip tone="dark">{MODES.find((m) => m.key === v.mode)?.title ?? "Автономный"}</Chip>
            {v.relocation && <Chip tone="teal">переезд</Chip>}
            {v.sponsorshipNeeded && <Chip tone="amber">нужна виза</Chip>}
            {v.extraRoles.length > 0 && <Chip>+{count(v.extraRoles.length, ["роль", "роли", "ролей"])}</Chip>}
          </div>
          {v.mode === "target" && (
            <p className={cx("text-[12.5px]", v.dreamCompanies.length ? "text-ink-3" : "text-amber")}>
              {v.dreamCompanies.length ? `Компании: ${v.dreamCompanies.slice(0, 4).join(", ")}${v.dreamCompanies.length > 4 ? "…" : ""}` : "Для точечного режима добавь компании мечты."}
            </p>
          )}
          <FormSubmit size="lg" pendingText="Сохраняем…" className="w-full">Сохранить цель</FormSubmit>
          {cancelHref && <Link href={cancelHref} className="inline-flex h-10 items-center justify-center rounded-full text-[14px] text-ink-2 hover:bg-white/60 hover:text-head focus-visible:outline-2 focus-visible:outline-green">Отмена</Link>}
          <p className="text-[12px] text-ink-3">Агент учтёт новую цель в следующем цикле поиска.</p>
        </Card>
      </aside>
    </ActionForm>
  );
}

function SummaryLine({ text }: { text: string }) {
  return <p className="font-mono text-[12px] uppercase leading-relaxed tracking-[.06em] text-teal">{text}</p>;
}

function Pill({ children, type = "checkbox", ...p }: { children: ReactNode; type?: "checkbox" | "radio"; name: string; value: string; defaultChecked?: boolean }) {
  return (
    <label className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-white/70 px-3.5 text-[13.5px] text-ink-2 transition-colors select-none hover:bg-white has-[:checked]:border-cta has-[:checked]:bg-cta has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-green">
      <input type={type} {...p} className="sr-only" />
      {children}
    </label>
  );
}

function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint?: string; defaultChecked?: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white/60 px-3.5 py-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-green">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-head/15 transition-colors peer-checked:bg-green after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" aria-hidden />
      <span className="flex flex-col gap-0.5">
        <span className="text-[14px] text-head">{label}</span>
        {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
      </span>
    </label>
  );
}
