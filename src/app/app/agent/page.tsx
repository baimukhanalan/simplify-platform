import type { Metadata } from "next";
import Link from "next/link";
import { Pause, Play } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { j } from "@/lib/db";
import { AUTONOMY_LABELS, readAutonomy } from "@/lib/engine/autonomy";
import { PLANS } from "@/lib/engine/taxonomy";
import { setCampaignStatus, updateCampaignSettings } from "@/lib/actions/campaign";
import { pendingApprovalsCount, pendingHandoffsCount, runningCampaign } from "@/lib/ops-data";
import { hhEnabled } from "@/lib/hh/client";
import { isSimulation } from "@/lib/mode";
import { ButtonLink, Card, Field, PageHeader, Script, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { AutonomyForm } from "./_components/autonomy-form";
import { HhCard } from "./_components/hh-card";
import { AgentStatus } from "../../_components/agent-status";
import { getT } from "@/lib/i18n/server";
import { I18nScope } from "@/lib/i18n/scope";
import type { MessageKey } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("agentPage.metaTitle") };
}

export default async function AgentPage({ searchParams }: { searchParams: Promise<{ hh?: string | string[] }> }) {
  const user = await requireUser();
  const hhParam = (await searchParams).hh;
  const hhNotice = typeof hhParam === "string" ? hhParam : undefined;
  const autonomy = readAutonomy(user.autonomy);
  const [campaign, approvals, handoffs] = await Promise.all([runningCampaign(user.id), pendingApprovalsCount(user.id), pendingHandoffsCount(user.id)]);
  const t = await getT();
  // Labels and hints per language (the engine keeps the Russian originals for its event log).
  const rows = AUTONOMY_LABELS.map(({ key }) => ({ key, label: t(`agentPage.rows.${key}.label` as MessageKey), hint: t(`agentPage.rows.${key}.hint` as MessageKey) }));
  // The agent submits on its own only with the auto-submit consent; a running campaign carries it as campaign.autoSubmit.
  const autoSubmitConsent = campaign ? campaign.autoSubmit : j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false;
  const paused = campaign?.status === "paused";
  const plan = campaign ? PLANS[campaign.plan as keyof typeof PLANS] ?? PLANS.local : null;
  const maxPerDay = plan?.dailyLimit ?? PLANS.local.dailyLimit;

  return (
    <>
      <PageHeader
        eyebrow={t("agentPage.eyebrow")}
        title={t.rich("agentPage.title", {}, { s: (c) => <Script>{c}</Script> })}
        sub={isSimulation()
          ? t("agentPage.subSimulation")
          : t("agentPage.sub")}
      />

      <AgentStatus
        needs={[
          ...(approvals ? [{ text: t("agentPage.status.questions", { n: approvals }), href: "/app/approvals" }] : []),
          ...(handoffs ? [{ text: t("agentPage.status.handoffs", { n: handoffs }), href: "/app/approvals#kind-handoff" }] : []),
        ]}
        idle={!campaign || paused}
        working={!campaign ? t("agentPage.status.notStarted") : paused ? t("agentPage.status.paused") : t("agentPage.status.active")}
        className="-mt-3 mb-6"
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <I18nScope ns={["agentPage"]}>
          <AutonomyForm initial={autonomy} rows={rows} autoSubmitConsent={autoSubmitConsent} standing={isSimulation()} />
        </I18nScope>

        <div className="flex flex-col gap-6 lg:sticky lg:top-6">
          <Card strong className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="label">{t("agentPage.campaign.title")}</h2>
              {campaign && (
                <span className={cx("inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[.08em]", paused ? "text-amber" : "text-green")}>
                  <span className={cx("size-2 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
                  {paused ? t("agentPage.campaign.badgePaused") : t("agentPage.campaign.badgeActive")}
                </span>
              )}
            </div>
            {campaign ? (
              <>
                <p className="text-[14px] text-ink-2">
                  {paused ? t("agentPage.campaign.pausedText") : t("agentPage.campaign.activeText")}
                  {campaign.lastRunAt && <span className="text-ink-3"> {t("agentPage.campaign.lastRun", { ago: t.ago(campaign.lastRunAt) })}</span>}
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={setCampaignStatus}>
                    <input type="hidden" name="status" value={paused ? "active" : "paused"} />
                    <SubmitButton variant={paused ? "green" : "glass"} size="sm" pendingText={paused ? t("agentPage.campaign.resuming") : t("agentPage.campaign.pausing")} className="!h-10">
                      {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />{t("agentPage.campaign.resume")}</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />{t("agentPage.campaign.pause")}</>}
                    </SubmitButton>
                  </form>
                </div>
                <form action={updateCampaignSettings} className="flex flex-col gap-3 border-t border-line pt-5">
                  <Field label={t("agentPage.campaign.limitLabel")} hint={t("agentPage.campaign.limitHint", { max: maxPerDay, plan: plan?.label ?? "" })}>
                    <input name="dailyLimit" type="number" min={1} max={maxPerDay} required inputMode="numeric" defaultValue={Math.min(campaign.dailyLimit, maxPerDay)} className="field" />
                  </Field>
                  <div><SubmitButton variant="glass" size="sm" pendingText={t("common.saving")} className="!h-10">{t("agentPage.campaign.saveLimit")}</SubmitButton></div>
                </form>
              </>
            ) : (
              <>
                <p className="text-[14px] text-ink-2">{t("agentPage.campaign.notStartedText")}</p>
                <ButtonLink href="/app/campaign" size="sm" className="self-start">{t("agentPage.campaign.start")}</ButtonLink>
              </>
            )}
          </Card>

          {/* hh.kz only when the integration is configured on the server — no «coming soon» placeholder. */}
          {hhEnabled() && <HhCard userId={user.id} notice={hhNotice} />}

          {!isSimulation() && <Card className="flex flex-col gap-2">
            <h2 className="label">{t("agentPage.extensionCard.title")}</h2>
            <p className="text-[13.5px] leading-relaxed text-ink-2">{t("agentPage.extensionCard.text")}</p>
            <Link href="/app/extension" className="self-start text-[13.5px] text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-green">{t("agentPage.extensionCard.link")}</Link>
          </Card>}

          {!isSimulation() && <Card className="flex flex-col gap-3">
            <h2 className="label">{t("agentPage.askCard.title")}</h2>
            <p className="text-[13.5px] leading-relaxed text-ink-2">
              {t.rich("agentPage.askCard.text", {}, { link: (c) => <Link href="/app/approvals" className="inline-flex min-h-10 items-center rounded text-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-green sm:min-h-0">{c}</Link> })}
            </p>
          </Card>}
        </div>
      </div>
    </>
  );
}
