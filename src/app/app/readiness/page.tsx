import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Plus, Target } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { ButtonLink, Empty, PageHeader, Script } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { applyReadinessFix } from "@/lib/actions/profile";
import { SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { runningCampaign } from "@/lib/ops-data";
import { AgentStatus, type Need } from "../../_components/agent-status";
import { loadReadiness } from "./_components/data";
import { goalTitle, kUsd, readinessView, fmtYears } from "./_components/model";
import { BlockersAndPlan, ParamTable, ReadinessHero } from "./_components/readiness-view";

export const metadata: Metadata = { title: "Readiness" };

export default async function ReadinessPage() {
  const user = await requireUser();
  const [data, campaign] = await Promise.all([
    loadReadiness(user.id),
    runningCampaign(user.id),
  ]);

  if (!data) {
    return (
      <>
        <PageHeader eyebrow="Readiness" title={<>Где ты <Script>сейчас</Script></>} />
        <Empty title="Сначала задай цель" sub="Readiness сравнивает твой Career Profile с конкретной целью: ролью, уровнем, страной и зарплатой." action={<ButtonLink href="/app/goal">Задать цель</ButtonLink>} />
      </>
    );
  }

  const { readiness: r, range, goal } = data;
  const view = readinessView(data);
  const fixSeniority = r.suggestedSeniority !== goal.seniority;
  const fixSalary = goal.currency === "USD" && goal.minSalary > range.mid;
  const roles = r.suggestedRoles.filter((x) => x !== goal.primaryRole && !goal.extraRoles.includes(x)).slice(0, 2);

  const needs: Need[] = [];
  if (r.verdict === "unrealistic") needs.push({ text: "Поправь цель — с текущей почти не будет интервью", href: "/app/goal" });
  if (!data.hasLinkedin) needs.push({ text: "Добавь ссылку на LinkedIn", href: "/app/profile#basics" });
  if (data.withMetrics === 0) needs.push({ text: "Добавь хотя бы один результат в цифрах", href: "/app/profile#experience" });

  return (
    <>
      <PageHeader
        eyebrow="Readiness"
        title={<>Где ты <Script>сейчас</Script></>}
        sub="Насколько твой профиль готов к цели — и что агент сделает, чтобы усилить его."
        actions={<ButtonLink href="/app/goal" variant="glass"><Target className="size-4" strokeWidth={1.7} aria-hidden />Моя цель</ButtonLink>}
      />

      <div className="flex flex-col gap-5">
        <AgentStatus needs={needs} idle={!campaign} working={campaign ? "Агент использует это, чтобы выбирать вакансии и готовить заявки." : "Когда кампания запустится, агент начнёт с самых вероятных вакансий."} className="animate-rise" />

        <div className="animate-rise [animation-delay:60ms]">
          <ReadinessHero score={view.score} verdict={r.verdict} goal={<>{goalTitle(goal.primaryRole, goal.countries)} <span className="text-ink-3">· {SENIORITY_LABEL[goal.seniority] ?? goal.seniority}</span></>} />
        </div>

        <div className="animate-rise [animation-delay:120ms]"><ParamTable params={view.params} /></div>
        <div className="animate-rise [animation-delay:180ms]"><BlockersAndPlan blockers={view.blockers} actions={view.actions} /></div>

        {(fixSeniority || fixSalary || roles.length > 0) && (
          <section aria-labelledby="fix-h" className="glass flex flex-col gap-3 p-5 animate-rise [animation-delay:240ms] sm:p-6">
            <div className="flex flex-col gap-1">
              <h2 id="fix-h" className="text-[15.5px] font-medium text-head">Можно ускорить</h2>
              <p className="text-[13px] text-ink-3">Меняется только цель. Readiness пересчитается сразу.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {fixSeniority && <FixForm fix="seniority" title={`Уровень: ${SENIORITY_LABEL[goal.seniority]} → ${SENIORITY_LABEL[r.suggestedSeniority]}`} note={`Под твои ${fmtYears(data.yearsExperience)} опыта`} cta="Применить" />}
              {fixSalary && <FixForm fix="salary" title={`Минимум: ${kUsd(goal.minSalary)} → ${kUsd(range.mid)}`} note="Медиана рынка для цели" cta="Применить" />}
              {roles.map((role) => (
                <FixForm key={role} fix="role" role={role} title={`Добавить роль: ${role}`} note="Твои навыки уже подходят" cta={<><Plus className="size-3.5" strokeWidth={1.8} aria-hidden />Добавить</>} />
              ))}
            </div>
          </section>
        )}

        {!campaign && (
          <div className="flex justify-end">
            <ButtonLink href="/app/campaign" size="lg">Запустить кампанию</ButtonLink>
          </div>
        )}
      </div>
    </>
  );
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
