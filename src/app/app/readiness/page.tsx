import type { ReactNode } from "react";
import { Plus, Target } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ButtonLink, Empty, PageHeader, Script } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { applyReadinessFix } from "@/lib/actions/profile";
import { getT } from "@/lib/i18n/server";
import { marketLine, seniorityName } from "@/lib/i18n/labels";
import type { T } from "@/lib/i18n/translator";
import { marketRange } from "@/lib/engine/market";
import { toUSD, usdToGoalAmount } from "@/lib/engine/fx";
import { runningCampaign } from "@/lib/ops-data";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { loadReadiness } from "./_components/data";
import { MIN_ADJACENT_SKILLS, adjacentSkills, goalTitle, readinessView, yearsText } from "./_components/model";
import { BlockersAndPlan, ParamTable, ReadinessHero } from "./_components/readiness-view";

export async function generateMetadata() {
  return { title: (await getT())("readinessPage.metaTitle") };
}

export default async function ReadinessPage() {
  const user = await requireUser();
  const t = await getT();
  const title = t.rich("readinessPage.title", {}, { s: (c) => <Script>{c}</Script> });
  const [data, campaign] = await Promise.all([
    loadReadiness(user.id),
    runningCampaign(user.id),
  ]);

  if (!data) {
    return (
      <>
        <PageHeader eyebrow={t("readinessPage.eyebrow")} title={title} />
        <Empty title={t("readinessPage.emptyTitle")} sub={t("readinessPage.emptySub")} action={<ButtonLink href="/app/goal">{t("readinessPage.emptyCta")}</ButtonLink>} />
      </>
    );
  }

  const { readiness: r, goal, family } = data;
  const view = readinessView(data, t);
  const fixSeniority = r.suggestedSeniority !== goal.seniority;
  // The market model is yearly USD; the fix lowers the minimum to that median in the goal's own currency (₸ stays ₸).
  const usdMid = marketRange(family, goal.seniority, goal.countries).mid;
  const salaryTarget = usdToGoalAmount(usdMid, goal.currency);
  // An offer at or above the minimum already proves it: never suggest lowering it then.
  const fixSalary = toUSD(goal.minSalary, goal.currency) > usdMid && salaryTarget > 0 && !data.offerMeetsMinimum;
  const roles = r.suggestedRoles.filter((x) => x !== goal.primaryRole && !goal.extraRoles.includes(x)).slice(0, 2);

  const needs: Need[] = [];
  if (r.verdict === "unrealistic") needs.push({ text: t("readinessPage.needUnrealistic"), href: "/app/goal" });
  if (!data.hasLinkedin) needs.push({ text: t("readinessPage.needLinkedin"), href: "/app/profile#basics" });
  if (data.withMetrics === 0) needs.push({ text: t("readinessPage.needMetric"), href: "/app/profile#experience" });

  return (
    <>
      <PageHeader
        eyebrow={t("readinessPage.eyebrow")}
        title={title}
        sub={t("readinessPage.sub")}
        actions={<ButtonLink href="/app/goal" variant="glass"><Target className="size-4" strokeWidth={1.7} aria-hidden />{t("readinessPage.myGoal")}</ButtonLink>}
      />

      <div className="flex flex-col gap-5">
        <AgentStatus needs={needs} idle={!campaign} working={campaign ? t("readinessPage.workingActive") : t("readinessPage.workingIdle")} className="animate-rise" />

        <div className="animate-rise [animation-delay:60ms]">
          <ReadinessHero score={view.score} verdict={r.verdict} goal={<>{goalTitle(goal.primaryRole)} <span className="text-ink-3">· {seniorityName(t, goal.seniority)}</span></>} market={marketLine(t, goal.countries)} />
        </div>

        <div className="animate-rise [animation-delay:120ms]"><ParamTable params={view.params} /></div>
        <div className="animate-rise [animation-delay:180ms]"><BlockersAndPlan blockers={view.blockers} actions={view.actions} /></div>

        {(fixSeniority || fixSalary || roles.length > 0) && (
          <section aria-labelledby="fix-h" className="glass flex flex-col gap-3 p-5 animate-rise [animation-delay:240ms] sm:p-6">
            <div className="flex flex-col gap-1">
              <h2 id="fix-h" className="text-[15.5px] font-medium text-head">{t("readinessPage.fixTitle")}</h2>
              <p className="text-[13px] text-ink-3">{t("readinessPage.fixSub")}</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {fixSeniority && <FixForm fix="seniority" title={t("readinessPage.fixLevel", { from: seniorityName(t, goal.seniority), to: seniorityName(t, r.suggestedSeniority) })} note={t("readinessPage.fixLevelNote", { years: yearsText(t, data.yearsExperience) })} cta={t("readinessPage.apply")} />}
              {fixSalary && <FixForm fix="salary" title={t("readinessPage.fixSalary", { from: t.money(goal.minSalary, goal.currency), to: t.money(salaryTarget, goal.currency) })} note={t("readinessPage.fixSalaryNote")} cta={t("readinessPage.apply")} />}
              {roles.map((role) => (
                <FixForm key={role} fix="role" role={role} title={t("readinessPage.addRole", { role })} note={adjacentNote(t, role, data.skills)} cta={<><Plus className="size-3.5" strokeWidth={1.8} aria-hidden />{t("readinessPage.add")}</>} />
              ))}
            </div>
          </section>
        )}

        {!campaign && (
          <div className="flex justify-end">
            <ButtonLink href="/app/campaign" size="lg">{t("readinessPage.launch")}</ButtonLink>
          </div>
        )}
      </div>
    </>
  );
}

/** «Твои навыки уже подходят: SQL, Python» only with evidence from the profile; otherwise a softer suggestion. */
function adjacentNote(t: T, role: string, skills: string[]) {
  const matched = adjacentSkills(role, skills);
  if (matched.length >= MIN_ADJACENT_SKILLS) return t("readinessPage.adjFits", { skills: matched.slice(0, 3).join(", ") });
  if (matched.length === 1) return t("readinessPage.adjOne", { skill: matched[0] });
  return t("readinessPage.adjSoft");
}

function FixForm({ fix, role, title, note, cta }: { fix: string; role?: string; title: string; note: string; cta: ReactNode }) {
  return (
    <form action={applyReadinessFix} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white/60 px-3.5 py-3">
      <input type="hidden" name="fix" value={fix} />
      {role && <input type="hidden" name="role" value={role} />}
      <div className="min-w-0">
        <div className="text-[14px] text-head">{title}</div>
        <div className="text-[12px] text-ink-3">{note}</div>
      </div>
      <SubmitButton size="sm" variant="glass" pendingText="…" className="!h-10 shrink-0">{cta}</SubmitButton>
    </form>
  );
}
