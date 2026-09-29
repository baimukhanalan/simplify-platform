import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Check, X, ArrowRight, MapPin, TrendingUp, AlertTriangle } from "lucide-react";
import { db, j } from "@/lib/db";
import type { CheckResult } from "@/lib/onboarding";
import { Card, Label, H, Script, Chip, Ring, Progress, ButtonLink, Divider, cx } from "@/components/ui";
import { fitVerdict } from "@/lib/engine/matching";
import { placeRu } from "@/lib/ru";
import { SiteHeader } from "../../_components/site-header";
import { LegalFooter } from "../../_components/legal-page";
import { placeWithFormat } from "../../_components/ru";
import { getT } from "@/lib/i18n/server";
import { seniorityName } from "@/lib/i18n/labels";
import type { NsKey } from "@/lib/i18n/translator";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("meta.checkResult"), robots: { index: false } };
}

type CheckKey = NsKey<"check">;
const VERDICT = {
  ready: { label: "verdictReady", tone: "green" as const, head: "headReady" },
  stretch: { label: "verdictStretch", tone: "teal" as const, head: "headStretch" },
  unrealistic: { label: "verdictUnrealistic", tone: "rose" as const, head: "headUnrealistic" },
} satisfies Record<string, { label: CheckKey; tone: string; head: CheckKey }>;
const ELIG = {
  eligible: { label: "eligEligible", tone: "green" as const, note: "eligEligibleNote" },
  soft: { label: "eligSoft", tone: "amber" as const, note: "eligSoftNote" },
  blocked: { label: "eligBlocked", tone: "rose" as const, note: "eligBlockedNote" },
} satisfies Record<string, { label: CheckKey; tone: string; note: CheckKey }>;
/** Readiness check names by key, in the current language (the notes under them are engine text). */
const CHECK_LABEL: Record<string, CheckKey> = {
  cv: "checkCv", experience: "checkExperience", skills: "checkSkills", seniority: "checkSeniority", language: "checkLanguage", salary: "checkSalary", geo: "checkGeo", portfolio: "checkPortfolio", interview: "checkInterview",
};
const WORK_MODE: Record<string, CheckKey> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };

export default async function CheckResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getT();
  const ru = t.locale === "ru";
  /** Engine-written text (strengths, notes, reasons) stays Russian for now: marked lang="ru" in other languages. */
  const engine = ru ? undefined : "ru";
  const S = (c: React.ReactNode) => <Script>{c}</Script>;
  const row = await db.careerCheck.findUnique({ where: { id }, select: { result: true, createdAt: true } });
  const r = row ? j<CheckResult | null>(row.result, null) : null;
  if (!r || r.v !== 1) notFound();
  const v = VERDICT[r.readiness.verdict];
  // The user's own target title (as typed) when the check stored it; older checks fall back to the role family.
  const title = r.targetTitle?.trim() || r.roleLabel;
  const jobFit = r.job ? fitVerdict({ eligibility: r.job.eligibility, match: r.job.match, blockers: r.job.blockers, pInterview: r.job.pInterview }) : null;

  return (
    <div className="min-h-dvh overflow-x-clip">
      <SiteHeader right={<><ButtonLink href="/check" variant="ghost" size="sm" className="max-sm:!hidden">{t("check.checkAnother")}</ButtonLink><ButtonLink href="/login?mode=signup" size="sm">{t("check.startCampaign")}</ButtonLink></>} />
      <main id="main-content" tabIndex={-1} className="mx-auto flex w-full max-w-[1100px] flex-col gap-6 px-4 pb-24 pt-4 sm:px-8 lg:pt-8">
        {/* Summary */}
        <section className="grid items-center gap-6 animate-rise md:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-3">
            <Label>{t("check.resultEyebrow", { title })}</Label>
            <h1 className="h-serif text-[clamp(32px,4.6vw,54px)]">{t.rich(`check.${v.head}`, {}, { s: S })}</h1>
            <div className="flex flex-wrap gap-2">
              <Chip tone={v.tone} dot>{t(`check.${v.label}`)}</Chip>
              <Chip>{t("check.chance", { p: r.readiness.probability })}</Chip>
              <Chip tone="teal">{t("check.yearsLevel", { years: t("check.years", { n: Math.round(r.years * 10) / 10 }), level: seniorityName(t, r.seniority) })}</Chip>
              <Chip>{t("check.english", { level: r.english })}</Chip>
            </div>
            <p className="max-w-2xl text-[14.5px] text-ink-2">
              {t("check.recognized", { skills: r.skills.length, facts: r.factsCount, metrics: r.metricsCount })}
            </p>
          </div>
          <Card strong className="flex items-center gap-5 md:flex-col md:px-8">
            <Ring value={r.readiness.score} size={120} stroke={8} label="Readiness" />
            <div className="flex flex-col gap-1.5 text-[13px] text-ink-3 md:items-center md:text-center">
              <span>{t.rich("check.of100", { title }, { b: (c) => <span className="text-head">{c}</span> })}</span>
              {/* The level is its own chip, never merged into the user's title («Middle Senior Data Analyst»). */}
              <Chip className="w-fit">{t("check.level", { level: seniorityName(t, r.readiness.suggestedSeniority) })}</Chip>
            </div>
          </Card>
        </section>

        {r.readiness.verdict === "unrealistic" && (
          <div role="note" className="flex items-start gap-3 rounded-[22px] border border-rose/15 bg-rose-soft p-5 text-[14px] text-rose animate-rise">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" strokeWidth={1.7} />
            <p>{t("check.honest")}</p>
          </div>
        )}

        {/* Strengths / weaknesses */}
        <section className="grid gap-4 md:grid-cols-2">
          <Card className="flex flex-col gap-4 animate-rise [animation-delay:60ms]">
            <Label>{t("check.strengths")}</Label>
            {r.strengths.length ? (
              <ul className="flex flex-col gap-2.5">
                {r.strengths.map((x) => <li key={x} className="flex gap-2.5 text-[14px] text-ink-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-label={t("check.plus")} /><span lang={engine}>{x}</span></li>)}
              </ul>
            ) : <p className="text-[14px] text-ink-3">{t("check.noStrengths")}</p>}
          </Card>
          <Card className="flex flex-col gap-4 animate-rise [animation-delay:120ms]">
            <Label>{t("check.weaknesses")}</Label>
            {r.weaknesses.length ? (
              <ul className="flex flex-col gap-2.5">
                {r.weaknesses.map((x) => <li key={x} className="flex gap-2.5 text-[14px] text-ink-2"><X className="mt-0.5 size-4 shrink-0 text-rose" strokeWidth={2.2} aria-label={t("check.minus")} /><span lang={engine}>{x}</span></li>)}
              </ul>
            ) : <p className="text-[14px] text-ink-3">{t("check.noWeaknesses")}</p>}
          </Card>
        </section>

        {/* Checks + suggestions */}
        <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
          <Card className="flex flex-col gap-4">
            <Label>{t("check.breakdown")}</Label>
            <ul className="flex flex-col gap-3.5">
              {r.readiness.checks.map((c) => (
                <li key={c.key} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                    <span className="text-head">{CHECK_LABEL[c.key] ? t(`check.${CHECK_LABEL[c.key]}`) : c.label}</span>
                    {/* «neutral» = the input was not given: no number, an empty neutral bar (not a red 0). */}
                    {c.status === "neutral" ? <span className="text-ink-3">{t("check.notGiven")}</span> : <span className="num text-ink-3">{c.score}</span>}
                  </div>
                  {c.status === "neutral" ? (
                    <div aria-hidden className="h-1.5 w-full rounded-full bg-head/10" />
                  ) : (
                    <Progress value={c.score} tone={c.status === "ok" ? "green" : c.status === "warn" ? "amber" : "rose"} />
                  )}
                  <span lang={engine} className="text-[12px] text-ink-3">{c.key === "salary" && r.market?.line ? r.market.line : c.note}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-4">
              <Label>{t("check.todo")}</Label>
              {r.readiness.suggestions.length ? (
                <ol className="flex flex-col gap-3">
                  {r.readiness.suggestions.slice(0, 5).map((x, i) => (
                    <li key={x} className="flex gap-3 text-[14px] text-ink-2"><span className="num grid size-6 shrink-0 place-items-center rounded-full bg-green-soft text-[12px] text-green">{i + 1}</span><span lang={engine}>{x}</span></li>
                  ))}
                </ol>
              ) : <p className="text-[14px] text-ink-3">{t("check.profileReady")}</p>}
            </Card>
            <Card className="flex flex-col gap-3">
              <Label>{t("check.roles")}</Label>
              {r.roles.length ? (
                <div className="flex flex-wrap gap-2">{r.roles.map((x) => <Chip key={x} tone="teal">{x}</Chip>)}</div>
              ) : <p className="text-[13.5px] text-ink-3">{t("check.noRoles")}</p>}
              <p className="text-[12.5px] text-ink-3">{t("check.rolesNote")}</p>
            </Card>
          </div>
        </section>

        {/* Sample vacancy */}
        {r.job && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <H size="m">{t.rich("check.jobTitle", {}, { s: S })}</H>
              <Label>{t("check.jobSample")}</Label>
            </div>
            <Card strong className="flex flex-col gap-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="text-[19px] font-medium text-head">{r.job.title}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-3">
                    <span className="text-ink-2">{r.job.company}</span>
                    {r.job.location ? <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{ru ? placeWithFormat(placeRu(r.job.location), r.job.remote) : [r.job.location, WORK_MODE[r.job.remote] ? t(`check.${WORK_MODE[r.job.remote]}`) : ""].filter(Boolean).join(" · ")}</span> : <span>{WORK_MODE[r.job.remote] ? t(`check.${WORK_MODE[r.job.remote]}`) : r.job.remote}</span>}
                    {r.job.salary && <span className="num">{r.job.salary}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Ring value={r.job.match} size={76} stroke={6} label="Match" />
                  <div className="flex flex-col gap-1.5">
                    {/* A blocked role gets the verdict and its reason, never a "≈ 0%" probability. */}
                    <Chip tone={ELIG[r.job.eligibility].tone} dot>{ru && jobFit?.headline ? jobFit.headline : t(`check.${ELIG[r.job.eligibility].label}`)}</Chip>
                    {jobFit?.blocked ? (
                      <span lang={engine} className="max-w-[16rem] text-[12px] leading-snug text-ink-3">{jobFit.reason}</span>
                    ) : (
                      <span className="num text-[12px] text-ink-3">{t("check.pInterview", { p: String(Math.round(r.job.pInterview * 100)) })}</span>
                    )}
                  </div>
                </div>
              </div>
              <Divider />
              <div className="grid gap-5 md:grid-cols-2">
                <div className="flex flex-col gap-2.5">
                  <Label>{t("check.matchWhy")}</Label>
                  <ul className="flex flex-wrap gap-2">
                    {r.job.reasons.map((x) => (
                      <li key={x.label} className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]", x.ok ? "border-green/20 bg-green-soft text-green" : "border-rose/15 bg-rose-soft text-rose")}>
                        {x.ok ? <Check className="size-3.5" strokeWidth={2.4} /> : <X className="size-3.5" strokeWidth={2.4} />}
                        <span className="sr-only">{x.ok ? t("check.has") : t("check.hasNot")}</span><span lang={engine}>{x.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-col gap-2.5">
                  <Label>{t("check.requirements")}</Label>
                  <p className="text-[13.5px] text-ink-2">{t(`check.${ELIG[r.job.eligibility].note}`)}</p>
                  {[...r.job.blockers.map((b) => ({ b, hard: true })), ...r.job.softGaps.map((b) => ({ b, hard: false }))].slice(0, 5).map(({ b, hard }) => (
                    <div key={b} className={cx("flex items-start gap-2 text-[13px]", hard ? "text-rose" : "text-amber")}>
                      <span className={cx("mt-1.5 size-1.5 shrink-0 rounded-full", hard ? "bg-rose" : "bg-amber")} aria-hidden /><span lang={engine}>{b}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </section>
        )}

        {!r.job && (
          <Card className="flex flex-col gap-1.5">
            <Label>{t("check.noJobTitle")}</Label>
            <p className="text-[14px] leading-relaxed text-ink-2">{t("check.noJob", { title })}</p>
          </Card>
        )}

        {/* Positioning */}
        {r.positioning && (
          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <H size="m">{t.rich("check.repackTitle", {}, { s: S })}</H>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card className="flex flex-col gap-3">
                <Label>{t("check.before")}</Label>
                <p className="text-[14.5px] leading-relaxed text-ink-3">{r.positioning.before || (r.positioning.headline ? t("check.noIntroHeadline", { headline: r.positioning.headline }) : t("check.noIntro"))}</p>
                <Label className="mt-2">{t("check.skillsBefore")}</Label>
                <div className="flex flex-wrap gap-1.5">{r.positioning.skillsBefore.map((x) => <Chip key={x}>{x}</Chip>)}</div>
              </Card>
              <Card strong className="flex flex-col gap-3 ring-1 ring-green/15">
                <Label className="!text-green">{r.job ? t("check.afterJob", { title: r.job.title }) : t("check.afterRole", { title })}</Label>
                <p lang={engine} className="text-[14.5px] leading-relaxed text-head">{r.positioning.after}</p>
                <Label className="mt-2">{t("check.skillsAfter")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {r.positioning.skillsAfter.map((x, i) => {
                    const moved = r.positioning!.skillsBefore.indexOf(x) > i;
                    return <Chip key={x} tone={moved ? "green" : "neutral"}>{moved && <TrendingUp className="size-3" aria-label={t("check.movedUp")} />}{x}</Chip>;
                  })}
                </div>
              </Card>
            </div>
          </section>
        )}

        {/* CTA */}
        <section className="glass-strong mt-4 flex flex-col items-center gap-5 px-6 py-12 text-center animate-rise">
          <Label>{t("check.nextStep")}</Label>
          <h2 className="h-serif text-[clamp(28px,4vw,46px)]">{t.rich("check.ctaTitle", {}, { s: S })}</h2>
          <p className="max-w-lg text-[15px] text-ink-2">{t("check.ctaText")}</p>
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <ButtonLink href="/login?mode=signup" size="lg">{t("check.startCampaign")} <ArrowRight className="size-4" aria-hidden /></ButtonLink>
            <ButtonLink href="/check" variant="ghost">{t("check.checkAnother")}</ButtonLink>
          </div>
        </section>
      </main>
      <div className="flex justify-center"><LocaleSwitcher /></div>
      <LegalFooter />
    </div>
  );
}
