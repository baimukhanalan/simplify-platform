import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, Download, ExternalLink } from "lucide-react";
import { realUrl } from "@/lib/links";
import { currentUserId, requireUser } from "@/lib/auth";
import { hiddenLiveRole, isSimulation } from "@/lib/mode";
import { db, j } from "@/lib/db";
import type { Answer } from "@/lib/engine/personalize";
import { APPLIED_OR_LATER, hasCyrillic as isCyrillic } from "@/lib/engine/taxonomy";
import { statusTone } from "@/lib/ops";
import { Card, Chip, Label, PageHeader, cx } from "@/components/ui";
import { cleanRequirement } from "../../opportunities/_lib/fit";
import { StatusMover } from "../../opportunities/_components/bits";
import { AgentStatus, type Need } from "../../../_components/agent-status";
import { endSentence } from "../../../_components/ru";
import { getT } from "@/lib/i18n/server";
import type { MessageKey } from "@/lib/i18n/translator";
import { cvLabelT, dateTimeT, placeT, salaryT, shortDateT, statusT, submitViaT } from "../../opportunities/_lib/labels";
import { Timeline, type Step } from "./_components/timeline";
import { SentAnswer } from "../../../_components/sent-answer";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, userId, t] = await Promise.all([params, currentUserId(), getT()]);
  const o = userId ? await db.opportunity.findFirst({ where: { id, campaign: { userId } }, select: { submittedAt: true, job: { select: { company: true, source: true } } } }) : null;
  return { title: o && !(hiddenLiveRole(o) && !o.submittedAt) ? t("apps.metaTitle", { company: o.job.company }) : t("meta.notFound") };
}

const MAIL: Record<string, MessageKey> = {
  confirmation: "apps.mailConfirmation",
  assessment: "apps.mailAssessment",
  interview: "apps.mailInterview",
  offer: "apps.mailOffer",
  rejection: "apps.mailRejection",
};

const NEXT: Record<string, MessageKey> = {
  submitted: "apps.nextSubmitted",
  pending: "apps.nextPending",
  assessment: "apps.nextAssessment",
  recruiter: "apps.nextRecruiter",
  hiring_manager: "apps.nextHiringManager",
  technical: "apps.nextTechnical",
  final: "apps.nextFinal",
  offer: "apps.nextOffer",
};

const ANSWER_LABEL: Record<string, MessageKey> = { auto: "apps.byAgent", rule: "apps.byRule", approval: "apps.byYou" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user, t] = await Promise.all([params, requireUser(), getT()]);
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId: user.id } },
    include: {
      job: true,
      pkg: true,
      events: { orderBy: { createdAt: "asc" } },
      inbox: { orderBy: { receivedAt: "asc" }, select: { id: true, subject: true, classification: true, receivedAt: true } },
      interviews: { orderBy: { createdAt: "asc" }, select: { id: true, round: true, scheduledAt: true, status: true, createdAt: true } },
      offers: { select: { createdAt: true, role: true, base: true, currency: true } },
    },
  });
  // Simulation mode: an application page of a live-feed vacancy exists only once it was really sent (src/lib/mode.ts).
  if (!opp || (hiddenLiveRole(opp) && !opp.submittedAt)) notFound();
  if (!APPLIED_OR_LATER.includes(opp.status)) redirect(`/app/opportunities/${opp.id}`);
  const { job, pkg } = opp;

  // ——— Timeline: Submitted → Confirmation → … from events, employer emails, interviews and offers ———
  const steps: Step[] = [];
  // The package always precedes the submission, even if the rows were written in the same instant.
  const preparedAt = pkg ? new Date(Math.min(pkg.createdAt.getTime(), (opp.submittedAt ?? pkg.createdAt).getTime() - 1)) : null;
  if (pkg && preparedAt) steps.push({ at: preparedAt, kind: "prepared", title: t("apps.stepPrepared"), detail: cvLabelT(t, opp.job.company) });
  if (opp.submittedAt) steps.push({ at: opp.submittedAt, kind: "submitted", title: t("apps.stepSubmitted"), detail: pkg?.submitMethod ? submitViaT(t, pkg.submitMethod) || undefined : undefined });
  for (const m of opp.inbox) {
    steps.push({ at: m.receivedAt, kind: MAIL[m.classification] ? m.classification : "inbox", title: t(MAIL[m.classification] ?? "apps.mailOther"), detail: m.subject, href: `/app/inbox?m=${m.id}` });
  }
  for (const iv of opp.interviews) {
    const result = iv.status === "passed" ? t("apps.roundPassed") : iv.status === "failed" ? t("apps.roundFailed") : iv.status === "done" ? t("apps.roundDone") : "";
    steps.push({ at: iv.createdAt, kind: "interview_room", title: t("apps.stepScheduled", { round: statusT(t, iv.round).toLowerCase() }), detail: `${iv.scheduledAt ? dateTimeT(t, iv.scheduledAt) : t("apps.dateTbd")}${result}`, href: `/app/interviews/${iv.id}` });
  }
  for (const o of opp.offers) steps.push({ at: o.createdAt, kind: "offer", title: t("apps.stepOffer"), detail: `${o.role} · ${salaryT(t, o.base, null, o.currency) ?? ""}`, href: "/app/offers" });
  for (const e of opp.events) {
    if (e.type !== "status_change") continue; // everything else is derived from its own rows above
    const d = j<{ from?: string; to?: string; by?: string }>(e.data, {});
    if (!d.to || d.to === "skipped") continue;
    steps.push({ at: e.createdAt, kind: "status_change", title: t("apps.stepStatus", { status: statusT(t, d.to).toLowerCase() }), detail: d.by === "user" ? t("apps.changedByYou") : undefined });
  }
  steps.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  if (NEXT[opp.status]) steps.push({ at: null, kind: "next", title: t(NEXT[opp.status]), upcoming: true });

  const answers = pkg ? j<Answer[]>(pkg.answers, []) : [];
  const requirements = j<string[]>(job.requirements, []).map(cleanRequirement).filter(Boolean);
  const hasCyrillic = pkg ? /[Ѐ-ӿ]/.test(pkg.cvText) : false;
  const salary = salaryT(t, job.salaryMin, job.salaryMax, job.currency);
  const isDemo = job.source === "demo";
  const place = placeT(t, job.location, job.remote);
  const pendingAnswers = answers.filter((a) => a.status === "pending").length;
  const needs: Need[] = [];
  if (opp.status === "offer") needs.push({ text: t("apps.needOffer"), href: "/app/offers" });
  // The room of the round that is coming (else the latest one) — not the Interviews list.
  const nextRound = opp.interviews.find((iv) => iv.status === "upcoming") ?? opp.interviews[opp.interviews.length - 1];
  if (["assessment", "recruiter", "hiring_manager", "technical", "final"].includes(opp.status)) needs.push({ text: t("apps.needPrepare"), href: nextRound ? `/app/interviews/${nextRound.id}` : "/app/interviews" });
  if (pendingAnswers) needs.push({ text: t("apps.needAnswer"), href: "/app/approvals" });

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/applications" className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" aria-hidden />Applications
      </Link>
      <PageHeader
        eyebrow={t("apps.eyebrow", { company: job.company })}
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tone={statusTone(opp.status)}>{statusT(t, opp.status)}</Chip>
            <span>{t.rich("apps.submittedOn", { date: shortDateT(t, opp.submittedAt) }, { n: (c) => <span className="num text-head">{c}</span> })}</span>
          </span>
        }
      />

      <AgentStatus needs={needs} working={opp.status === "rejected" ? t("apps.workingRejected") : undefined} className="-mt-3" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Timeline first in the DOM: on mobile it is the answer to "where is my application?" */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" aria-label={t("apps.statusAria")}>
          <Card className="flex flex-col gap-4">
            <h2 className="label">{t("apps.history")}</h2>
            <Timeline steps={steps} next={t("apps.next")} time={(d) => dateTimeT(t, d)} />
          </Card>
          {/* Simulation: statuses only move on their own — no manual status change to offer or describe. */}
          {!isSimulation() && (
          <Card className="flex flex-col gap-2.5">
            <h2 className="label">{t("apps.status")}</h2>
            <p className="text-[13px] text-ink-3">{t("apps.statusHelp")}</p>
            <StatusMover id={opp.id} current={opp.status} groups={["applied", "interview", "result"]} label={t("apps.changeStatus")} ariaLabel={t("apps.changeStatusAria", { company: job.company, title: job.title })} />
          </Card>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
          <Card strong className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>{t("apps.sentCv")}</Label>
                <h2 className="h-serif mt-2 text-[24px]">{pkg ? cvLabelT(t, job.company) : t("apps.noCv")}</h2>
              </div>
              {pkg && (
                <a
                  href={`/api/applications/${opp.id}/cv`}
                  download
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
                >
                  <Download className="size-3.5" aria-hidden />{t("apps.downloadPdf")}
                </a>
              )}
            </div>
            {pkg ? (
              <>
                <p className="text-[12.5px] text-ink-3">
                  {endSentence(opp.submittedAt ? t("apps.exactTextOn", { date: shortDateT(t, opp.submittedAt) }) : t("apps.exactText"))}
                  {hasCyrillic && t("apps.translit")}
                </p>
                <pre tabIndex={0} aria-label={t("apps.cvTextAria")} className="scroll-thin max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-stroke bg-white/85 p-4 font-mono text-[12.5px] leading-[1.65] text-ink focus-visible:outline-2 focus-visible:outline-green sm:p-5">{pkg.cvText}</pre>
              </>
            ) : (
              <p className="text-[14px] text-ink-3">{t("apps.sentOutside")}</p>
            )}
          </Card>

          {pkg && (
            <Card className="flex flex-col gap-3">
              <Label>{t("apps.coverLetter")}</Label>
              <div className="whitespace-pre-line break-words text-[14.5px] leading-relaxed text-ink-2">{pkg.coverLetter}</div>
            </Card>
          )}

          {answers.length > 0 && (
            <Card className="flex flex-col gap-3">
              <Label>{t("apps.answers")}</Label>
              <ul className="divide-y divide-line rounded-2xl border border-stroke bg-white/55">
                {answers.map((a, i) => (
                  <li key={`${a.q}-${i}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-head">{a.q}</div>
                      <div className={cx("mt-0.5 break-words text-[13.5px]", a.a ? "text-ink-2" : "italic text-ink-3")}>{a.a ? (t.locale === "ru" ? <SentAnswer answer={a.a} /> : <span lang={isCyrillic(a.a) ? "ru" : "en"}>{a.a}</span>) : t("apps.noAnswer")}</div>
                    </div>
                    <div className="flex items-start sm:justify-end">
                      <Chip tone={a.status === "pending" ? "amber" : a.category === "approval" ? "green" : "neutral"}>
                        {a.status === "pending" ? t("apps.waitsYou") : t("apps.answeredBy", { who: ANSWER_LABEL[a.category] ? t(ANSWER_LABEL[a.category]) : a.category })}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>{t("apps.vacancy")}</Label>
              <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                {salary && <span className="num text-head">{salary}</span>}
                {place && <span>{place}</span>}
              </span>
            </div>
            {requirements.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2 marker:text-teal">{requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            <details className="group rounded-2xl border border-stroke bg-white/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                {t("apps.originalDescription")}
                <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="whitespace-pre-line break-words border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-2">{job.description || t("work.noDescription")}</div>
            </details>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              <Link href={`/app/opportunities/${opp.id}`} className="inline-flex min-h-10 items-center text-teal hover:text-head">{t("apps.whyChosen")}</Link>
              {realUrl(job.url) && !isDemo && (
                <a href={realUrl(job.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-teal hover:text-head">
                  {t("apps.original")}<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">{t("work.newTab")}</span>
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
