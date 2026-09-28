import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, Download, ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import type { Answer } from "@/lib/engine/personalize";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { REMOTE_LABEL, fmtDate, salaryLabel, statusLabel, statusTone } from "@/lib/ops";
import { Card, Chip, Label, PageHeader, cx } from "@/components/ui";
import { cleanRequirement, cvVersionLabel } from "../../opportunities/_lib/fit";
import { StatusMover } from "../../opportunities/_components/bits";
import { AgentStatus, type Need } from "../../../_components/agent-status";
import { endSentence, shortDate } from "../../../_components/ru";
import { Timeline, type Step } from "./_components/timeline";

export const metadata = { title: "Application" };

const MAIL: Record<string, string> = {
  confirmation: "Confirmation — заявка получена",
  assessment: "Приглашение на assessment",
  interview: "Interview invitation",
  offer: "Offer",
  rejection: "Rejected",
};

const NEXT: Record<string, string> = {
  submitted: "Ждём подтверждения от работодателя",
  pending: "Ждём ответа рекрутера",
  assessment: "Assessment → следующий этап",
  recruiter: "Recruiter screen → следующий раунд",
  hiring_manager: "Hiring manager → следующий раунд",
  technical: "Technical → финальный раунд",
  final: "Ждём решения по финалу",
  offer: "Решение по офферу",
};

const ANSWER_LABEL: Record<string, string> = { auto: "агент", rule: "по правилу", approval: "ты" };

/** How the package went out, without internal codes ("ats:demo" → "демо-ATS"). */
const sentVia = (m: string) =>
  m === "user-handoff" ? "ты, через официальную форму" : m.startsWith("ats:demo") ? "демо-ATS (симуляция)" : m.startsWith("ats:") ? `ATS ${m.slice(4)}` : "";

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId: user.id } },
    include: {
      job: true,
      pkg: true,
      events: { orderBy: { createdAt: "asc" } },
      inbox: { orderBy: { receivedAt: "asc" }, select: { id: true, subject: true, classification: true, receivedAt: true, simulated: true } },
      interviews: { orderBy: { createdAt: "asc" }, select: { round: true, scheduledAt: true, status: true, createdAt: true } },
      offers: { select: { createdAt: true, role: true, base: true, currency: true } },
    },
  });
  if (!opp) notFound();
  if (!APPLIED_OR_LATER.includes(opp.status)) redirect(`/app/opportunities/${opp.id}`);
  const { job, pkg } = opp;

  // ——— Timeline: Submitted → Confirmation → … from events, employer emails, interviews and offers ———
  const steps: Step[] = [];
  // The package always precedes the submission, even if the rows were written in the same instant.
  const preparedAt = pkg ? new Date(Math.min(pkg.createdAt.getTime(), (opp.submittedAt ?? pkg.createdAt).getTime() - 1)) : null;
  if (pkg && preparedAt) steps.push({ at: preparedAt, kind: "prepared", title: "CV и cover letter подготовлены", detail: cvVersionLabel(pkg.cvVersion) });
  if (opp.submittedAt) steps.push({ at: opp.submittedAt, kind: "submitted", title: "Submitted", detail: pkg?.submitMethod ? sentVia(pkg.submitMethod) || undefined : undefined });
  for (const m of opp.inbox) {
    steps.push({ at: m.receivedAt, kind: MAIL[m.classification] ? m.classification : "inbox", title: MAIL[m.classification] ?? "Письмо от работодателя", detail: m.subject, href: `/app/inbox?m=${m.id}`, tag: m.simulated ? "симуляция" : undefined });
  }
  for (const iv of opp.interviews) {
    const result = iv.status === "passed" ? " · пройдено" : iv.status === "failed" ? " · не пройдено" : iv.status === "done" ? " · состоялось" : "";
    steps.push({ at: iv.createdAt, kind: "interview_room", title: `${statusLabel(iv.round)} назначен`, detail: `${iv.scheduledAt ? fmtDate(iv.scheduledAt, true) : "дата уточняется"}${result}`, href: "/app/interviews" });
  }
  for (const o of opp.offers) steps.push({ at: o.createdAt, kind: "offer", title: "Оффер получен", detail: `${o.role} · ${salaryLabel(o.base, null, o.currency) ?? ""}`, href: "/app/offers" });
  for (const e of opp.events) {
    if (e.type !== "status_change") continue; // everything else is derived from its own rows above
    const d = j<{ from?: string; to?: string; by?: string }>(e.data, {});
    if (!d.to || d.to === "skipped") continue;
    steps.push({ at: e.createdAt, kind: "status_change", title: `Статус: ${statusLabel(d.to)}`, detail: d.by === "user" ? "изменено тобой" : undefined });
  }
  steps.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  if (NEXT[opp.status]) steps.push({ at: null, kind: "next", title: NEXT[opp.status], upcoming: true });

  const answers = pkg ? j<Answer[]>(pkg.answers, []) : [];
  const requirements = j<string[]>(job.requirements, []).map(cleanRequirement).filter(Boolean);
  const hasCyrillic = pkg ? /[Ѐ-ӿ]/.test(pkg.cvText) : false;
  const salary = salaryLabel(job.salaryMin, job.salaryMax, job.currency);
  const isDemo = job.source === "demo";
  const pendingAnswers = answers.filter((a) => a.status === "pending").length;
  const needs: Need[] = [];
  if (opp.status === "offer") needs.push({ text: "Оффер ждёт твоего решения", href: "/app/offers" });
  if (["assessment", "recruiter", "hiring_manager", "technical", "final"].includes(opp.status)) needs.push({ text: "Подготовься к следующему этапу", href: "/app/interviews" });
  if (pendingAnswers) needs.push({ text: "Ответь на вопрос из анкеты", href: "/app/approvals" });

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/applications" className="inline-flex w-fit items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" aria-hidden />Applications
      </Link>
      <PageHeader
        eyebrow={`Application · ${job.company}`}
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tone={statusTone(opp.status)}>{statusLabel(opp.status)}</Chip>
            <span>Подано <span className="num text-head">{shortDate(opp.submittedAt)}</span></span>
            {pkg && <span className="text-head">{cvVersionLabel(pkg.cvVersion)}</span>}
            {isDemo && <span className="text-ink-3">демо-вакансия: ответы работодателя симулируются</span>}
          </span>
        }
      />

      <AgentStatus needs={needs} working={opp.status === "rejected" ? "Агент учёл этот отказ при выборе следующих вакансий." : undefined} className="-mt-3" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Timeline first in the DOM: on mobile it is the answer to "where is my application?" */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" aria-label="Статус заявки">
          <Card className="flex flex-col gap-4">
            <h2 className="label">Timeline</h2>
            <Timeline steps={steps} />
          </Card>
          <Card className="flex flex-col gap-2.5">
            <h2 className="label">Статус</h2>
            <p className="text-[13px] text-ink-3">
              Статус обновляется сам по письмам работодателя. Если что-то произошло вне почты — например, звонок рекрутера, — поменяй его здесь.
            </p>
            <StatusMover id={opp.id} current={opp.status} groups={["applied", "interview", "result"]} label="Сменить статус" ariaLabel={`Сменить статус заявки: ${job.company} — ${job.title}`} />
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
          <Card strong className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>Submitted CV</Label>
                <h2 className="h-serif mt-2 text-[24px]">{pkg ? cvVersionLabel(pkg.cvVersion) : "CV не сохранено"}</h2>
              </div>
              {pkg && (
                <a
                  href={`/api/applications/${opp.id}/cv`}
                  download
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
                >
                  <Download className="size-3.5" aria-hidden />Download PDF
                </a>
              )}
            </div>
            {pkg ? (
              <>
                <p className="text-[12.5px] text-ink-3">
                  {endSentence(`Ровно тот текст, который ушёл работодателю${opp.submittedAt ? ` ${fmtDate(opp.submittedAt)}` : ""}`)}
                  {hasCyrillic && " В PDF кириллица записана латиницей (транслитерация) — стандартный шрифт PDF её не поддерживает."}
                </p>
                <pre tabIndex={0} aria-label="Текст отправленного CV" className="scroll-thin max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-stroke bg-white/85 p-4 font-mono text-[12.5px] leading-[1.65] text-ink focus-visible:outline-2 focus-visible:outline-green sm:p-5">{pkg.cvText}</pre>
              </>
            ) : (
              <p className="text-[14px] text-ink-3">Заявка отправлена вне агента — пакет с CV не сохранялся.</p>
            )}
          </Card>

          {pkg && (
            <Card className="flex flex-col gap-3">
              <Label>Cover Letter</Label>
              <div className="whitespace-pre-line break-words text-[14.5px] leading-relaxed text-ink-2">{pkg.coverLetter}</div>
            </Card>
          )}

          {answers.length > 0 && (
            <Card className="flex flex-col gap-3">
              <Label>Screening answers</Label>
              <ul className="divide-y divide-line rounded-2xl border border-stroke bg-white/55">
                {answers.map((a, i) => (
                  <li key={`${a.q}-${i}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-head">{a.q}</div>
                      <div className={cx("mt-0.5 break-words text-[13.5px]", a.a ? "text-ink-2" : "italic text-ink-4")}>{a.a || "без ответа"}</div>
                    </div>
                    <div className="flex items-start sm:justify-end">
                      <Chip tone={a.status === "pending" ? "amber" : a.category === "approval" ? "green" : "neutral"}>
                        {a.status === "pending" ? "ждёт тебя" : `ответ: ${ANSWER_LABEL[a.category] ?? a.category}`}
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Label>Vacancy</Label>
              <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <Chip tone={job.remote === "remote" ? "green" : "neutral"}>{REMOTE_LABEL[job.remote] ?? job.remote}</Chip>
                {salary && <span className="num text-head">{salary}</span>}
                {job.location && <span>{job.location}</span>}
              </span>
            </div>
            {requirements.length > 0 && (
              <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2 marker:text-teal">{requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            )}
            <details className="group rounded-2xl border border-stroke bg-white/50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                Original job description
                <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="whitespace-pre-line break-words border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-2">{job.description || "Описание не предоставлено источником."}</div>
            </details>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              <Link href={`/app/opportunities/${opp.id}`} className="inline-flex min-h-10 items-center text-teal hover:text-head">Почему агент выбрал эту вакансию</Link>
              {job.url && !isDemo && (
                <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-teal hover:text-head">
                  Оригинал<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
                </a>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
