import type { Metadata } from "next";
import Link from "next/link";
import { Pause, Play, Zap } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { j } from "@/lib/db";
import { AUTONOMY_LABELS, readAutonomy } from "@/lib/engine/autonomy";
import { PLANS } from "@/lib/engine/taxonomy";
import { runAgentNow, setCampaignStatus, updateCampaignSettings } from "@/lib/actions/campaign";
import { runningCampaign } from "@/lib/ops-data";
import { ago } from "@/lib/ops";
import { ButtonLink, Card, Field, Label, PageHeader, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AutonomyForm } from "./_components/autonomy-form";

export const metadata: Metadata = { title: "Agent" };

export default async function AgentPage() {
  const user = await requireUser();
  const autonomy = readAutonomy(user.autonomy);
  const campaign = await runningCampaign(user.id);
  // The agent submits on its own only with the auto-submit consent; a running campaign carries it as campaign.autoSubmit.
  const autoSubmitConsent = campaign ? campaign.autoSubmit : j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false;
  const paused = campaign?.status === "paused";
  const plan = campaign ? PLANS[campaign.plan as keyof typeof PLANS] ?? PLANS.local : null;

  return (
    <>
      <PageHeader
        eyebrow="Agent"
        title={<>Autonomy — что агент делает <Script>сам</Script></>}
        sub="Ты задаёшь границы один раз. Всё, что внутри них, Simplify делает без тебя; всё, что за ними, — только с твоего разрешения."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <AutonomyForm initial={autonomy} rows={AUTONOMY_LABELS} autoSubmitConsent={autoSubmitConsent} />

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card strong className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <Label>Campaign</Label>
              {campaign && (
                <span className={cx("inline-flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[.08em]", paused ? "text-amber" : "text-green")}>
                  <span className={cx("size-2 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
                  {paused ? "Paused" : "Active"}
                </span>
              )}
            </div>
            {campaign ? (
              <>
                <p className="text-[14px] text-ink-2">
                  {paused ? "Агент на паузе: не ищет и не отправляет заявки. Интервью и ответы работодателей продолжают приходить." : "Агент работает каждый день в пределах дневного лимита."}
                  {campaign.lastRunAt && <span className="text-ink-3"> Последний цикл {ago(campaign.lastRunAt)}.</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={setCampaignStatus}>
                    <input type="hidden" name="status" value={paused ? "active" : "paused"} />
                    <SubmitButton variant={paused ? "green" : "glass"} size="sm" pendingText="…">
                      {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />Resume</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />Pause</>}
                    </SubmitButton>
                  </form>
                  {!paused && (
                    <form action={runAgentNow}>
                      <SubmitButton variant="glass" size="sm" pendingText="Агент работает…"><Zap className="size-4" strokeWidth={1.7} aria-hidden />Run now</SubmitButton>
                    </form>
                  )}
                </div>
                <form action={updateCampaignSettings} className="flex flex-col gap-3 border-t border-line pt-5">
                  {/* updateCampaignSettings also writes autoSubmit (the consent mirror): pass the current value through unchanged. */}
                  {campaign.autoSubmit && <input type="hidden" name="autoSubmit" value="on" />}
                  <Field label="Заявок в день" hint={`1–25. План ${plan?.label} рассчитан на ~${plan?.dailyLimit} в день: меньше — каждая заявка сильнее.`}>
                    <input name="dailyLimit" type="number" min={1} max={25} required inputMode="numeric" defaultValue={campaign.dailyLimit} className="field" />
                  </Field>
                  <div><SubmitButton variant="glass" size="sm" pendingText="Сохраняем…">Сохранить лимит</SubmitButton></div>
                </form>
              </>
            ) : (
              <>
                <p className="text-[14px] text-ink-2">Кампания не запущена. Настройки автономии сохранятся и применятся с первого цикла.</p>
                <ButtonLink href="/app/campaign" size="sm" className="self-start">Start your campaign</ButtonLink>
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <Label>Когда агент спрашивает тебя</Label>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Sensitive questions — пол, инвалидность, статус ветерана и похожие — агент по умолчанию <span className="text-head">всегда</span> оставляет тебе. Он может отвечать на них сам, только если ты выбрал «prefer not to say».
            </p>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              Юридические декларации, спонсорство визы и нестандартные вопросы всегда ждут тебя в <Link href="/app/approvals" className="text-teal underline-offset-2 hover:underline">Подтверждениях</Link>. На повторяющиеся юридические вопросы и вопросы о спонсорстве агент дальше отвечает твоим прошлым ответом.
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
