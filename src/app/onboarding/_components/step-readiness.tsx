import { applyAdjustment } from "@/lib/actions/onboarding";
import { getT } from "@/lib/i18n/server";
import { marketLine, seniorityName } from "@/lib/i18n/labels";
import { SubmitButton } from "@/components/client";
import { goalTitle, readinessView, type ReadinessData } from "../../app/readiness/_components/model";
import { BlockersAndPlan, ParamTable, ReadinessHero } from "../../app/readiness/_components/readiness-view";
import { ContinueBar } from "./shared";

export async function StepReadiness({ data }: { data: ReadinessData }) {
  const t = await getT();
  const { readiness: r, goal, range } = data;
  const view = readinessView(data, t);
  const bad = (key: string) => r.checks.some((c) => c.key === key && c.status === "bad");
  const fixes: { kind: string; label: string; extra?: Record<string, string> }[] = [];
  if (r.suggestedSeniority !== goal.seniority && bad("seniority")) fixes.push({ kind: "seniority", label: t("onboarding.fixLevel", { level: seniorityName(t, r.suggestedSeniority) }) });
  if (bad("salary")) fixes.push({ kind: "salary", label: t("onboarding.fixSalary", { amount: t.money(range.mid, range.currency), period: range.period === "month" ? t("onboarding.perMonthSuffix") : "" }) });
  if (bad("geo") && !goal.workModes.includes("remote")) fixes.push({ kind: "remote", label: t("onboarding.fixRemote") });
  for (const role of r.suggestedRoles.filter((x) => x !== goal.primaryRole && !goal.extraRoles.includes(x)).slice(0, r.verdict === "unrealistic" ? 2 : 1)) fixes.push({ kind: "role", label: t("onboarding.fixRole", { role }), extra: { role } });

  return (
    <div className="flex flex-col gap-4">
      <ReadinessHero score={view.score} verdict={r.verdict} goal={<>{goalTitle(goal.primaryRole)} <span className="text-ink-3">· {seniorityName(t, goal.seniority)}</span></>} market={marketLine(t, goal.countries)} />
      <ParamTable params={view.params} />
      <BlockersAndPlan blockers={view.blockers} actions={view.actions} />

      {fixes.length > 0 && (
        <section aria-labelledby="fixes-h" className="glass flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="fixes-h" className="text-[15.5px] font-medium text-head">{r.verdict === "unrealistic" ? t("onboarding.fixesUnrealistic") : t("onboarding.fixesFaster")}</h2>
            <p className="text-[13px] text-ink-3">{t("onboarding.fixesHint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {fixes.map((fx) => (
              <form key={fx.kind + fx.label} action={applyAdjustment}>
                <input type="hidden" name="kind" value={fx.kind} />
                {fx.extra && Object.entries(fx.extra).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                <SubmitButton variant={r.verdict === "unrealistic" ? "primary" : "glass"} size="sm" pendingText={t("onboarding.applying")}>{fx.label}</SubmitButton>
              </form>
            ))}
          </div>
        </section>
      )}

      <ContinueBar step={4} label={r.verdict === "unrealistic" ? t("onboarding.continueAnyway") : t("onboarding.toLaunch")} />
    </div>
  );
}
