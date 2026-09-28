import type { Metadata } from "next";
import Link from "next/link";
import { Pause, Play, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { j } from "@/lib/db";
import { AUTONOMY_LABELS, readAutonomy } from "@/lib/engine/autonomy";
import { PLANS } from "@/lib/engine/taxonomy";
import { runAgentNow, setCampaignStatus, updateCampaignSettings } from "@/lib/actions/campaign";
import { pendingApprovalsCount, pendingHandoffsCount, runningCampaign } from "@/lib/ops-data";
import { demoToolsEnabled } from "@/lib/demo";
import { ago } from "@/lib/ops";
import { ButtonLink, Card, Field, PageHeader, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AutonomyForm } from "./_components/autonomy-form";
import { AgentStatus } from "../../_components/agent-status";
import { endSentence, handoffsWaiting, questionsWaiting } from "../../_components/ru";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage() {
  const user = await requireUser();
  const autonomy = readAutonomy(user.autonomy);
  const [campaign, approvals, handoffs] = await Promise.all([runningCampaign(user.id), pendingApprovalsCount(user.id), pendingHandoffsCount(user.id)]);
  const demo = demoToolsEnabled(user);
  const rows = AUTONOMY_LABELS; // Russian labels and hints live in the engine (src/lib/engine/autonomy.ts)
  // The agent submits on its own only with the auto-submit consent; a running campaign carries it as campaign.autoSubmit.
  const autoSubmitConsent = campaign ? campaign.autoSubmit : j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false;
  const paused = campaign?.status === "paused";
  const plan = campaign ? PLANS[campaign.plan as keyof typeof PLANS] ?? PLANS.local : null;
  const maxPerDay = plan?.dailyLimit ?? PLANS.local.dailyLimit;

  return (
    <>
      <PageHeader
        eyebrow="Agent"
        title={<>Autonomy — что агент делает <Script>сам</Script></>}
        sub="Ты задаёшь границы один раз. Всё, что внутри них, Simplify делает без тебя; всё, что за ними, — только с твоего разрешения."
      />

      <AgentStatus
        needs={[
          ...(approvals ? [{ text: questionsWaiting(approvals), href: "/app/approvals" }] : []),
          ...(handoffs ? [{ text: handoffsWaiting(handoffs), href: "/app/approvals#kind-handoff" }] : []),
        ]}
        idle={!campaign || paused}
        working={!campaign ? "Кампания не запущена — настройки применятся с первого цикла." : paused ? "Кампания на паузе — агент ничего не отправляет." : "Агент действует в этих границах."}
        className="-mt-3 mb-6"
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <AutonomyForm initial={autonomy} rows={rows} autoSubmitConsent={autoSubmitConsent} />

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card strong className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="label">Кампания</h2>
              {campaign && (
                <span className={cx("inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.08em]", paused ? "text-amber" : "text-green")}>
                  <span className={cx("size-2 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
                  {paused ? "На паузе" : "Активна"}
                </span>
              )}
            </div>
            {campaign ? (
              <>
                <p className="text-[14px] text-ink-2">
                  {paused ? "Агент на паузе: не ищет и не отправляет заявки. Интервью и ответы работодателей продолжают приходить." : "Агент работает каждый день в пределах дневного лимита."}
                  {campaign.lastRunAt && <span className="text-ink-3"> {endSentence(`Последний цикл ${ago(campaign.lastRunAt)}`)}</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={setCampaignStatus}>
                    <input type="hidden" name="status" value={paused ? "active" : "paused"} />
                    <SubmitButton variant={paused ? "green" : "glass"} size="sm" pendingText={paused ? "Возобновляем…" : "Ставим на паузу…"} className="!h-10">
                      {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />Возобновить</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />Пауза</>}
                    </SubmitButton>
                  </form>
                  {!paused && demo && (
                    <form action={runAgentNow}>
                      <SubmitButton variant="glass" size="sm" pendingText="Агент работает…" className="!h-10"><Zap className="size-4" strokeWidth={1.7} aria-hidden />Запустить цикл агента</SubmitButton>
                    </form>
                  )}
                </div>
                <form action={updateCampaignSettings} className="flex flex-col gap-3 border-t border-line pt-5">
                  <Field label="Лимит заявок в день" hint={`От 1 до ${maxPerDay} — максимум тарифа ${plan?.label}. Меньше заявок — каждая сильнее.`}>
                    <input name="dailyLimit" type="number" min={1} max={maxPerDay} required inputMode="numeric" defaultValue={Math.min(campaign.dailyLimit, maxPerDay)} className="field" />
                  </Field>
                  <div><SubmitButton variant="glass" size="sm" pendingText="Сохраняем…" className="!h-10">Сохранить лимит</SubmitButton></div>
                </form>
              </>
            ) : (
              <>
                <p className="text-[14px] text-ink-2">Кампания не запущена. Настройки автономии сохранятся и применятся с первого цикла.</p>
                <ButtonLink href="/app/campaign" size="sm" className="self-start">Начать кампанию</ButtonLink>
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <h2 className="label">Когда агент спрашивает тебя</h2>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Деликатные вопросы — пол, инвалидность, статус ветерана и похожие — агент по умолчанию оставляет тебе. Сам он отвечает на них, только если выбран вариант «Предпочитаю не указывать».
            </p>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Юридические декларации, спонсорство визы и нестандартные вопросы агент сам не решает: в первый раз они ждут тебя в <Link href="/app/approvals" className="inline-flex min-h-10 items-center rounded text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">Подтверждениях</Link>. Когда такой юридический вопрос или вопрос о спонсорстве повторится, агент повторит твой прошлый ответ.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
