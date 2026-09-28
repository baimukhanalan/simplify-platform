import type { Metadata } from "next";
import { CircleAlert, CircleCheck, Gauge, Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, PageHeader, Script } from "@/components/ui";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { goalTitle } from "../readiness/_components/model";
import { Facts } from "../profile/_components/editable";
import { GoalForm, type GoalValues } from "./_components/goal-form";

export const metadata: Metadata = { title: "Моя цель" };

const REGION_LABEL: Record<string, string> = { EU: "Europe", US: "US", UK: "UK", CA: "Canada", WORLD: "Remote worldwide", KZ: "Kazakhstan", CIS: "СНГ", MENA: "MENA" };
const MODE_LABEL: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "Onsite" };
const SIZE_LABEL: Record<string, string> = { any: "Любой", startup: "Стартап", scaleup: "Scale-up", corporate: "Корпорация" };
const CAMPAIGN_MODE: Record<string, string> = { autonomous: "Autonomous", target: "Target Mode", mass: "Mass hiring" };

function money(n: number, cur: string) {
  if (!n) return "";
  if (cur === "KZT") return `от ${n.toLocaleString("ru-RU")} ₸ / год`;
  return `от ${cur === "EUR" ? "€" : "$"}${n.toLocaleString("en-US")} / год`;
}

export default async function GoalPage({ searchParams }: { searchParams: Promise<{ need?: string; edit?: string; saved?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const [g, campaign] = await Promise.all([
    db.goal.findUnique({ where: { userId: user.id } }),
    db.campaign.findFirst({ where: { userId: user.id, status: { in: ["active", "paused"] } }, select: { status: true } }),
  ]);
  const initial: GoalValues = {
    primaryRole: g?.primaryRole ?? "",
    extraRoles: j(g?.extraRoles, []),
    seniority: g?.seniority ?? "junior",
    minSalary: g?.minSalary ?? 0,
    currency: g?.currency ?? "USD",
    countries: j(g?.countries, []),
    industries: j(g?.industries, []),
    workModes: j(g?.workModes, ["remote"]),
    relocation: g?.relocation ?? false,
    sponsorshipNeeded: g?.sponsorshipNeeded ?? true,
    dreamCompanies: j(g?.dreamCompanies, []),
    blockedCompanies: j(g?.blockedCompanies, []),
    companySize: g?.companySize ?? "any",
    mode: g?.mode ?? "autonomous",
  };
  const hasGoal = Boolean(initial.primaryRole);
  const editing = !hasGoal || sp.edit === "1" || sp.need === "goal";

  if (editing) {
    return (
      <>
        <PageHeader
          eyebrow="Моя цель"
          title={hasGoal ? <>Изменить <Script>цель</Script></> : <>Какую работу <Script>ищем?</Script></>}
          sub="Роль, страны, формат и деньги. Агент ищет только в этих рамках — цель можно менять в любой момент."
        />
        {sp.need === "goal" && (
          <div role="alert" className="mb-6 flex animate-rise items-start gap-3 rounded-2xl border border-amber/20 bg-amber-soft px-4 py-3.5 text-[14px] text-ink-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
            <p><span className="font-medium text-head">Сначала задай цель.</span> Без неё агенту нечего искать.</p>
          </div>
        )}
        <GoalForm initial={initial} cancelHref={hasGoal ? "/app/goal" : undefined} />
      </>
    );
  }

  const regions = initial.countries.map((c) => REGION_LABEL[c] ?? c).join(", ");
  const needs: Need[] = campaign ? [] : [{ text: "Запусти кампанию — и агент начнёт искать под эту цель", href: "/onboarding?step=5" }];

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 animate-rise sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <span className="label">Моя цель</span>
          <h1 className="h-serif text-[clamp(36px,5.6vw,68px)]">{goalTitle(initial.primaryRole, initial.countries)}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="dark">{SENIORITY_LABEL[initial.seniority] ?? initial.seniority}</Chip>
            {initial.extraRoles.length > 0 && <span className="text-[13.5px] text-ink-3">Также: {initial.extraRoles.join(", ")}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href="/app/readiness" variant="glass"><Gauge className="size-4" strokeWidth={1.7} aria-hidden />Readiness</ButtonLink>
          <ButtonLink href="/app/goal?edit=1"><Pencil className="size-4" strokeWidth={1.7} aria-hidden />Изменить</ButtonLink>
        </div>
      </div>

      {sp.saved === "1" && (
        <p role="status" className="mb-4 flex items-center gap-2 text-[13.5px] text-green animate-fade"><CircleCheck className="size-4" strokeWidth={1.8} aria-hidden />Цель сохранена. Агент учтёт её в следующем цикле.</p>
      )}

      <AgentStatus needs={needs} working={campaign?.status === "paused" ? "Кампания на паузе — цель сохранена и ждёт." : "Simplify ищет вакансии под эту цель каждый день."} className="mb-5 animate-rise [animation-delay:60ms]" />

      <section aria-labelledby="prefs-h" className="glass p-5 animate-rise [animation-delay:100ms] sm:p-7">
        <h2 id="prefs-h" className="h-serif mb-5 text-[clamp(21px,2.2vw,26px)]">Preferences</h2>
        <Facts cols={3} rows={[
          ["Salary", money(initial.minSalary, initial.currency) || "Не важно"],
          ["Location", regions],
          ["Format", initial.workModes.map((m) => MODE_LABEL[m] ?? m).join(", ")],
          ["Industries", initial.industries.join(", ") || "Любые"],
          ["Company size", SIZE_LABEL[initial.companySize] ?? initial.companySize],
          ["Relocation", initial.relocation ? "Готов(а) к переезду" : "Без переезда"],
        ]} />
        {(initial.dreamCompanies.length > 0 || initial.blockedCompanies.length > 0) && (
          <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            {initial.dreamCompanies.length > 0 && <MiniList label="Компании мечты" items={initial.dreamCompanies} />}
            {initial.blockedCompanies.length > 0 && <MiniList label="Не подавать в" items={initial.blockedCompanies} />}
          </div>
        )}
        <p className="mt-6 border-t border-line pt-4 text-[12.5px] text-ink-3">Режим кампании: {CAMPAIGN_MODE[initial.mode] ?? initial.mode}</p>
      </section>
    </>
  );
}

function MiniList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="label">{label}</span>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((x) => <li key={x} className="rounded-full border border-line bg-white/70 px-3 py-1 text-[13px] text-head">{x}</li>)}
      </ul>
    </div>
  );
}
