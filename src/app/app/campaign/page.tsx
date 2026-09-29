import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowRight, Check, CircleAlert, Pause, Play, ShieldCheck, TicketPercent } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { isOverdue, pendingApprovalsCount, pendingHandoffsCount, settleGuaranteesOnce } from "@/lib/ops-data";
import { readAutonomy } from "@/lib/engine/autonomy";
import { ButtonLink, Card, Chip, Label, PageHeader, Progress, Ring, Script, cx } from "@/components/ui";
import { PaymentHistory } from "./_components/payment-history";
import { GuaranteeCard } from "./_components/guarantee";
import { guaranteeView, type GuaranteeView } from "@/lib/engine/guarantee";
import { SubmitButton } from "@/components/client";
import { checkout, setCampaignStatus } from "@/lib/actions/campaign";
import { PLANS } from "@/lib/engine/taxonomy";
import { Disclosure } from "../profile/_components/bits";
import { AgentStatus } from "../../_components/agent-status";
import { OfferAcceptance } from "../../_components/legal-page";
import { PLAN_COOKIE, cleanPlan, type PlanKey } from "../../_components/plan-pref";
import { referralOfferFor, referralPrice, type ReferralOffer } from "@/lib/referral";
import { ReferralCta } from "../referral/_components/cta";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("campaignPage.meta") };
}

/** campaignPage.included.i1 … i17 — what every plan includes. */
const INCLUDED = ["i1", "i2", "i3", "i4", "i5", "i6", "i7", "i8", "i9", "i10", "i11", "i12", "i13", "i14", "i15", "i16", "i17"] as const;
const PLAN_COPY = {
  local: { regions: "regionsLocal", perDay: PLANS.local.dailyLimit },
  international: { regions: "regionsIntl", perDay: PLANS.international.dailyLimit },
} as const;
const STATUS_TONE = { active: "green", paused: "amber", hired: "green", expired: "neutral", draft: "neutral" } as const;
type StatusKey = keyof typeof STATUS_TONE;
const isStatus = (s: string): s is StatusKey => s in STATUS_TONE;
const statusLabel = (t: T, s: string) => (isStatus(s) ? t(`campaignPage.status.${s}`) : s);
const statusTone = (s: string) => (isStatus(s) ? STATUS_TONE[s] : "neutral");
const num = (c: React.ReactNode) => <span className="num">{c}</span>;
const numHead = (c: React.ReactNode) => <span className="num text-head">{c}</span>;
const DAY = 86400000;
/** Request-time clock for a campaign window (server-rendered per request). */
function campaignClock(startedAt: Date | null, endsAt: Date | null, days: number) {
  const now = Date.now();
  const start = startedAt?.getTime() ?? now;
  const total = endsAt ? Math.max(1, Math.round((endsAt.getTime() - start) / DAY)) : days;
  // Same math as Today (campaignDay in today-data.ts): day 1 is the start day; «осталось» = total − day.
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / DAY) + 1));
  const left = Math.max(0, total - day);
  return { total, day, left };
}

export default async function CampaignPage() {
  const user = await requireUser();
  // Interview guarantee: an overdue campaign without interviews is extended before it could be shown as over.
  await settleGuaranteesOnce(user.id);
  const [rows, payments, approvals, handoffs, jar, t] = await Promise.all([
    db.campaign.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { _count: { select: { opportunities: { where: { submittedAt: { not: null } } } } } } }),
    db.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { campaign: { select: { plan: true } } } }),
    pendingApprovalsCount(user.id),
    pendingHandoffsCount(user.id),
    cookies(),
    getT(),
  ]);
  // A campaign past endsAt is over even before an agent cycle writes status="expired": no Pause/Run, show the buy form.
  const campaigns = rows.map((c) => (isOverdue(c) ? { ...c, status: "expired" } : c));
  const active = campaigns.find((c) => c.status === "active" || c.status === "paused");
  const guarantee = active ? await guaranteeView(active) : null;
  const past = campaigns.filter((c) => c !== active && c.status !== "draft");
  const last = past[0];
  const consents = j<{ autoSubmit?: boolean }>(user.consents, {});
  const needs = active
    ? [
        ...(approvals ? [{ text: t("campaignPage.questionsWaiting", { n: approvals }), href: "/app/approvals" }] : []),
        ...(handoffs ? [{ text: t("campaignPage.handoffsWaiting", { n: handoffs }), href: "/app/approvals#kind-handoff" }] : []),
      ]
    : [];
  const autonomy = readAutonomy(user.autonomy);
  const offer = active ? null : await referralOfferFor(user.id);

  return (
    <>
      <PageHeader
        eyebrow={t("campaignPage.eyebrow")}
        title={t.rich(active ? "campaignPage.titleActive" : "campaignPage.titleNew", {}, { s: (c) => <Script>{c}</Script> })}
        sub={active ? undefined : t("campaignPage.sub")}
      />

      {!active && (
        <AgentStatus needs={[{ text: user.goal?.primaryRole ? t("campaignPage.needPlan") : t("campaignPage.needGoal"), href: user.goal?.primaryRole ? undefined : "/app/goal?need=goal" }]} className="mb-6 animate-rise" />
      )}
      {active && (
        <AgentStatus
          needs={needs}
          idle={active.status === "paused"}
          working={active.status === "paused" ? t("campaignPage.pausedWorking") : undefined}
          className="mb-6 animate-rise"
        />
      )}

      {active ? <ActiveCampaign t={t} c={active} guarantee={guarantee} autoSubmitConsent={consents.autoSubmit !== false} autoApply={autonomy.submitApplications} minMatch={autonomy.autoApplyMinMatch} /> : (
        <>
          {last && (last.status === "hired" || last.status === "expired") && (
            <div className="mb-6 flex animate-rise flex-col gap-2 rounded-2xl border border-line bg-white/70 px-4 py-3.5 text-[14px] text-ink-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 break-words">
                {t("campaignPage.prevEnded")} <Chip tone={statusTone(last.status)} className="mx-1">{statusLabel(t, last.status)}</Chip>
                {last.status === "hired" ? t("campaignPage.prevHired") : t("campaignPage.prevExpired")}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-[.06em] text-teal">{t("campaignPage.newCampaign")}</span>
            </div>
          )}
          <Checkout
            t={t}
            hasGoal={Boolean(user.goal?.primaryRole)}
            partner={user.referredByCode ?? ""}
            offer={offer}
            recommended={cleanPlan(jar.get(PLAN_COOKIE)?.value) ?? (j<string[]>(user.goal?.countries, []).some((c) => !["KZ", "CIS"].includes(c)) ? "international" : "local")}
          />
        </>
      )}

      <ReferralCta className="mt-6 animate-rise" />

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <PaymentHistory payments={payments} />
        <section aria-labelledby="past-h">
          <Card className="h-full">
            <Label className="mb-4"><span id="past-h">{t("campaignPage.pastTitle")}</span></Label>
            {past.length === 0 ? (
              <p className="text-[14px] text-ink-3">{t("campaignPage.pastEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {past.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-[14px] text-head">{PLANS[c.plan as keyof typeof PLANS]?.label ?? c.plan}</div>
                      <div className="text-[12.5px] text-ink-3">{t.date(c.startedAt, "dayMonthYear")} — {t.date(c.hiredAt ?? c.endsAt, "dayMonthYear")} · {t.rich("campaignPage.pastLine", { n: c._count.opportunities, r: c.readiness }, { b: num })}</div>
                    </div>
                    <Chip tone={statusTone(c.status)}>{statusLabel(t, c.status)}</Chip>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </>
  );
}

/** Plan picker. Partner attribution comes only from the signup referral — shown read-only, never typed here. */
function Checkout({ t, hasGoal, partner, recommended, offer = null }: { t: T; hasGoal: boolean; partner: string; recommended: PlanKey; offer?: ReferralOffer | null }) {
  return (
    <form action={checkout} className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-2">
        {(["local", "international"] as const).map((key, i) => {
          const plan = PLANS[key];
          const rec = key === recommended;
          return (
            <section key={key} aria-labelledby={`plan-${key}`} className={cx("relative flex animate-rise flex-col gap-5 p-6", rec ? "glass-strong outline-2 outline-green/60" : "glass")} style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label><span id={`plan-${key}`}>{plan.label}</span></Label>
                  {offer ? (
                    <>
                      <div className="flex flex-wrap items-baseline gap-x-2.5">
                        <span className="num text-[40px] leading-none text-head">{t.money(referralPrice(plan.priceKzt).amount)}</span>
                        <s className="num text-[16px] text-ink-3"><span className="sr-only">{t("campaignPage.withoutDiscount")}</span>{t.money(plan.priceKzt)}</s>
                      </div>
                      <div className="text-[12.5px] text-green">{t("campaignPage.inviteDiscount", { pct: offer.pct, name: offer.referrerName })}</div>
                    </>
                  ) : (
                    <div className="num text-[40px] leading-none text-head">{t.money(plan.priceKzt)}</div>
                  )}
                  <div className="text-[13px] text-ink-3">{t("campaignPage.perCampaign", { n: plan.days })}</div>
                </div>
                {rec && <Chip tone="green" dot className="shrink-0">{t("campaignPage.recommended")}</Chip>}
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-4 text-[14px] text-ink-2">
                <div><span className="text-ink-3">{t("campaignPage.markets")}</span>{t(`campaignPage.${PLAN_COPY[key].regions}`)}</div>
                <div><span className="text-ink-3">{t("campaignPage.pace")}</span>{t.rich("campaignPage.paceValue", { n: PLAN_COPY[key].perDay }, { b: numHead })}</div>
              </div>
              <div className="mt-auto pt-1">
                {hasGoal ? (
                  <SubmitButton name="plan" value={key} variant={rec ? "primary" : "glass"} size="lg" pendingText={t("campaignPage.creatingInvoice")} className="w-full" aria-describedby={`plan-${key}`}>
                    {t("campaignPage.payKaspi")}
                  </SubmitButton>
                ) : (
                  <ButtonLink href="/app/goal?need=goal" variant={rec ? "primary" : "glass"} size="lg" className="w-full">{t("campaignPage.setGoalFirst")}</ButtonLink>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <Card className="flex flex-col gap-5">
        <div>
          <Label className="mb-3">{t("campaignPage.includedAll")}</Label>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {INCLUDED.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13.5px] text-ink-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{t(`campaignPage.included.${f}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-start gap-2 border-t border-line pt-5 text-[13px] text-ink-2">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={1.8} aria-hidden />
          <span><span className="font-medium text-head">{t("campaignPage.guaranteeLead")}</span> {t("campaignPage.guarantee.promise")}</span>
        </p>
        {partner && (
          <p className="flex items-center gap-2 border-t border-line pt-5 text-[13px] text-ink-2">
            <TicketPercent className="size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
            <span className="min-w-0 break-words">{t.rich("campaignPage.partnerNote", { code: partner }, { c: (c) => <span className="font-mono text-head">{c}</span> })}</span>
          </p>
        )}
        <div className="flex items-start gap-2.5 rounded-2xl bg-head/[.04] px-4 py-3 text-[13px] text-ink-2">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.8} aria-hidden />
          <p><span className="font-medium text-head">{t("campaignPage.payNoteTitle")}</span> {t("campaignPage.payNote")} <OfferAcceptance /></p>
        </div>
      </Card>
    </form>
  );
}

function ActiveCampaign({ t, c, guarantee, autoSubmitConsent, autoApply, minMatch }: { t: T; guarantee: GuaranteeView | null; c: { id: string; plan: string; status: string; readiness: number; dailyLimit: number; autoSubmit: boolean; startedAt: Date | null; endsAt: Date | null; lastRunAt: Date | null }; autoSubmitConsent: boolean; autoApply: boolean; minMatch: number }) {
  // The agent sends on its own only with the consent (campaign.autoSubmit mirrors it) — and then either for roles above
  // the auto-apply threshold (Autonomy.submitApplications) or only for roles marked Apply / Auto.
  const autoLine = !c.autoSubmit || !autoSubmitConsent
    ? t("campaignPage.autoOff")
    : autoApply
      ? t("campaignPage.autoOnMatch", { n: minMatch })
      : t("campaignPage.autoMarkedOnly");
  const plan = PLANS[c.plan as keyof typeof PLANS] ?? PLANS.local;
  const { total, day, left } = campaignClock(c.startedAt, c.endsAt, plan.days);
  const paused = c.status === "paused";
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card strong className="flex animate-rise flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className={cx("size-2.5 rounded-full", paused ? "bg-amber" : "bg-green animate-pulse-dot")} aria-hidden />
            <span className="label !text-head">{plan.label}</span>
          </div>
          <Chip tone={paused ? "amber" : "green"}>{t(paused ? "campaignPage.status.paused" : "campaignPage.status.active")}</Chip>
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          <div>
            <div className="mb-1 text-[13px] text-ink-3">{t("campaignPage.left")}</div>
            <div className="num text-[64px] leading-none text-head">{left}</div>
            <div className="mt-1 text-[13px] text-ink-3">{t("campaignPage.daysOf", { n: left, total })}</div>
          </div>
          <div className="flex items-center gap-3">
            <Ring value={c.readiness} size={64} stroke={5} />
            <div className="text-[13px] text-ink-3">Readiness<br />{t("campaignPage.readinessAtStart")}</div>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Progress value={(day / total) * 100} />
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[.06em] text-ink-3">
            <span>{t.date(c.startedAt, "dayMonthShort")}</span><span>{t("campaignPage.dayOf", { day, total })}</span><span>{t.date(c.endsAt, "dayMonthShort")}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-5">
          <form action={setCampaignStatus}>
            <input type="hidden" name="status" value={paused ? "active" : "paused"} />
            <SubmitButton variant={paused ? "green" : "glass"} pendingText="…">
              {paused ? <><Play className="size-4" strokeWidth={1.7} aria-hidden />{t("campaignPage.resume")}</> : <><Pause className="size-4" strokeWidth={1.7} aria-hidden />{t("campaignPage.pause")}</>}
            </SubmitButton>
          </form>
        </div>
        {c.lastRunAt && <p className="-mt-3 text-[12.5px] text-ink-3">{t("campaignPage.lastRun", { when: t.date(c.lastRunAt, "dateTime") })}</p>}
        <Disclosure tone="ghost" summary={t("campaignPage.whatIncluded")}>
          <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {INCLUDED.map((f) => <li key={f} className="flex items-start gap-2 text-[13.5px] text-ink-2"><Check className="mt-0.5 size-3.5 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{t(`campaignPage.included.${f}`)}</li>)}
          </ul>
        </Disclosure>
      </Card>

      <div className="flex flex-col gap-6">
        {guarantee && <GuaranteeCard view={guarantee} style={{ animationDelay: "40ms" }} />}
        <Card className="animate-rise" style={{ animationDelay: "80ms" }}>
          <Label className="mb-3">{t("campaignPage.agentSettings")}</Label>
          <p className="text-[13.5px] text-ink-2">
            {t.rich("campaignPage.agentNow", { n: Math.min(c.dailyLimit, plan.dailyLimit), auto: autoLine }, { b: numHead })}{" "}
            {t("campaignPage.agentNowNote")}
          </p>
          <Link href="/app/agent" className="mt-3 inline-flex min-h-10 items-center gap-1.5 rounded text-[13.5px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">{t("campaignPage.openAgent")} <ArrowRight className="size-3.5" aria-hidden /></Link>
        </Card>
        <Card className="animate-rise" style={{ animationDelay: "140ms" }}>
          <Label className="mb-3">{t("campaignPage.fairUse")}</Label>
          <div className="flex flex-col gap-2 text-[13.5px] text-ink-2">
            <p>{t.rich("campaignPage.fairLimit", { plan: plan.label, n: plan.dailyLimit }, { b: numHead })}</p>
            <p>{t("campaignPage.fairNoDouble")}</p>
            <p className="text-ink-3">{t("campaignPage.fairPause")}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
