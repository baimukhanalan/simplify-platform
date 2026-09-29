import { CircleAlert, CircleCheck, Gauge, Pencil } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { ButtonLink, Chip, PageHeader, Script } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import { marketLine, seniorityName } from "@/lib/i18n/labels";
import { runningCampaign } from "@/lib/ops-data";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { goalTitle } from "../readiness/_components/model";
import { Facts } from "../profile/_components/editable";
import { GoalForm, type GoalValues } from "./_components/goal-form";
import { goalRegion, industryLabel, modeLongLabel, sizeLabel, workModeLabel } from "./_components/region";

export async function generateMetadata() {
  return { title: (await getT())("goalPage.metaTitle") };
}

export default async function GoalPage({ searchParams }: { searchParams: Promise<{ need?: string; edit?: string; saved?: string }> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const [g, campaign, t] = await Promise.all([
    db.goal.findUnique({ where: { userId: user.id } }),
    runningCampaign(user.id),
    getT(),
  ]);
  const script = { s: (x: React.ReactNode) => <Script>{x}</Script> };
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
          eyebrow={t("goalPage.eyebrow")}
          title={t.rich(hasGoal ? "goalPage.titleEdit" : "goalPage.titleNew", {}, script)}
          sub={t("goalPage.sub")}
        />
        {sp.need === "goal" && (
          <div role="alert" className="mb-6 flex animate-rise items-start gap-3 rounded-2xl border border-amber/20 bg-amber-soft px-4 py-3.5 text-[14px] text-ink-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber" strokeWidth={1.8} aria-hidden />
            <p>{t.rich("goalPage.needGoal", {}, { b: (x) => <span className="font-medium text-head">{x}</span> })}</p>
          </div>
        )}
        <I18nScope ns={["goalPage", "regions", "seniority"]}>
          <GoalForm initial={initial} cancelHref={hasGoal ? "/app/goal" : undefined} />
        </I18nScope>
      </>
    );
  }

  const regions = [...new Set(initial.countries.map((k) => goalRegion(t, k)))].join(", ");
  const needs: Need[] = campaign ? [] : [{ text: t("goalPage.view.needStart"), href: "/onboarding?step=5" }];
  const salary = initial.minSalary ? t("goalPage.view.salaryFrom", { amount: t.money(initial.minSalary, initial.currency) }) : "";

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 animate-rise sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-3">
          <span className="label">{t("goalPage.eyebrow")}</span>
          <h1 className="h-serif text-[clamp(36px,5.6vw,68px)]">{goalTitle(initial.primaryRole)}</h1>
          {initial.countries.length > 0 && <p className="text-[15px] text-ink-2">{marketLine(t, initial.countries)}</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="dark">{seniorityName(t, initial.seniority)}</Chip>
            {initial.extraRoles.length > 0 && <span className="text-[13.5px] text-ink-3">{t("goalPage.view.also", { roles: initial.extraRoles.join(", ") })}</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href="/app/readiness" variant="glass"><Gauge className="size-4" strokeWidth={1.7} aria-hidden />Readiness</ButtonLink>
          <ButtonLink href="/app/goal?edit=1"><Pencil className="size-4" strokeWidth={1.7} aria-hidden />{t("goalPage.view.edit")}</ButtonLink>
        </div>
      </div>

      {sp.saved === "1" && (
        <p role="status" className="mb-4 flex items-center gap-2 text-[13.5px] text-green animate-fade"><CircleCheck className="size-4" strokeWidth={1.8} aria-hidden />{t("goalPage.view.saved")}</p>
      )}

      <AgentStatus needs={needs} idle={campaign?.status === "paused"} working={t(campaign?.status === "paused" ? "goalPage.view.paused" : "goalPage.view.working")} className="mb-5 animate-rise [animation-delay:60ms]" />

      <section aria-labelledby="prefs-h" className="glass p-5 animate-rise [animation-delay:100ms] sm:p-7">
        <h2 id="prefs-h" className="h-serif mb-5 text-[clamp(21px,2.2vw,26px)]">{t("goalPage.view.prefs")}</h2>
        <Facts cols={3} rows={[
          [t("goalPage.view.salary"), salary || t("goalPage.view.salaryAny")],
          [t("goalPage.view.regions"), regions || "—"],
          [t("goalPage.view.format"), initial.workModes.map((m) => workModeLabel(t, m)).join(", ")],
          [t("goalPage.view.industries"), initial.industries.map((x) => industryLabel(t, x)).join(", ") || t("goalPage.view.industriesAny")],
          [t("goalPage.view.size"), sizeLabel(t, initial.companySize)],
          [t("goalPage.view.relocation"), t(initial.relocation ? "goalPage.view.relocationYes" : "goalPage.view.relocationNo")],
        ]} />
        {(initial.dreamCompanies.length > 0 || initial.blockedCompanies.length > 0) && (
          <div className="mt-6 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            {initial.dreamCompanies.length > 0 && <MiniList label={t("goalPage.view.dream")} items={initial.dreamCompanies} />}
            {initial.blockedCompanies.length > 0 && <MiniList label={t("goalPage.view.blocked")} items={initial.blockedCompanies} />}
          </div>
        )}
        <p className="mt-6 border-t border-line pt-4 text-[12.5px] text-ink-3">{t("goalPage.view.campaignMode", { mode: modeLongLabel(t, initial.mode) })}</p>
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
