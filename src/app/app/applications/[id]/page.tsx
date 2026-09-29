import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ChevronDown, Download, ExternalLink } from "lucide-react";
import { realUrl } from "@/lib/links";
import { currentUserId, requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import type { Answer } from "@/lib/engine/personalize";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { fmtDate, salaryLabel, statusTone } from "@/lib/ops";
import { Card, Chip, Label, PageHeader, cx } from "@/components/ui";
import { cleanRequirement, cvVersionLabel } from "../../opportunities/_lib/fit";
import { StatusMover } from "../../opportunities/_components/bits";
import { AgentStatus, type Need } from "../../../_components/agent-status";
import { endSentence, placeWithFormat, shortDate, statusRu } from "../../../_components/ru";
import { Timeline, type Step } from "./_components/timeline";
import { SentAnswer } from "../../../_components/sent-answer";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, userId] = await Promise.all([params, currentUserId()]);
  const o = userId ? await db.opportunity.findFirst({ where: { id, campaign: { userId } }, select: { job: { select: { company: true } } } }) : null;
  return { title: o ? `Заявка · ${o.job.company}` : "Страница не найдена" };
}

const MAIL: Record<string, string> = {
  confirmation: "Подтверждение — заявка получена",
  assessment: "Приглашение на тестовое задание",
  interview: "Приглашение на интервью",
  offer: "Оффер",
  rejection: "Отказ",
};

const NEXT: Record<string, string> = {
  submitted: "Ждём подтверждения от работодателя",
  pending: "Ждём ответа рекрутера",
  assessment: "Тестовое задание → следующий этап",
  recruiter: "Скрининг с рекрутером → следующий раунд",
  hiring_manager: "Интервью с менеджером → следующий раунд",
  technical: "Техническое интервью → финальный раунд",
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
      interviews: { orderBy: { createdAt: "asc" }, select: { id: true, round: true, scheduledAt: true, status: true, createdAt: true } },
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
  if (pkg && preparedAt) steps.push({ at: preparedAt, kind: "prepared", title: "CV и сопроводительное письмо подготовлены", detail: cvVersionLabel(pkg.cvVersion, opp.job.company) });
  if (opp.submittedAt) steps.push({ at: opp.submittedAt, kind: "submitted", title: "Заявка отправлена", detail: pkg?.submitMethod ? sentVia(pkg.submitMethod) || undefined : undefined });
  for (const m of opp.inbox) {
    steps.push({ at: m.receivedAt, kind: MAIL[m.classification] ? m.classification : "inbox", title: MAIL[m.classification] ?? "Письмо от работодателя", detail: m.subject, href: `/app/inbox?m=${m.id}`, tag: m.simulated ? "симуляция" : undefined });
  }
  for (const iv of opp.interviews) {
    const result = iv.status === "passed" ? " · пройдено" : iv.status === "failed" ? " · не пройдено" : iv.status === "done" ? " · состоялось" : "";
    steps.push({ at: iv.createdAt, kind: "interview_room", title: `Назначено: ${statusRu(iv.round).toLowerCase()}`, detail: `${iv.scheduledAt ? fmtDate(iv.scheduledAt, true) : "дата уточняется"}${result}`, href: `/app/interviews/${iv.id}` });
  }
  for (const o of opp.offers) steps.push({ at: o.createdAt, kind: "offer", title: "Оффер получен", detail: `${o.role} · ${salaryLabel(o.base, null, o.currency) ?? ""}`, href: "/app/offers" });
  for (const e of opp.events) {
    if (e.type !== "status_change") continue; // everything else is derived from its own rows above
    const d = j<{ from?: string; to?: string; by?: string }>(e.data, {});
    if (!d.to || d.to === "skipped") continue;
    steps.push({ at: e.createdAt, kind: "status_change", title: `Статус: ${statusRu(d.to).toLowerCase()}`, detail: d.by === "user" ? "изменено тобой" : undefined });
  }
  steps.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  if (NEXT[opp.status]) steps.push({ at: null, kind: "next", title: NEXT[opp.status], upcoming: true });

  const answers = pkg ? j<Answer[]>(pkg.answers, []) : [];
  const requirements = j<string[]>(job.requirements, []).map(cleanRequirement).filter(Boolean);
  const hasCyrillic = pkg ? /[Ѐ-ӿ]/.test(pkg.cvText) : false;
  const salary = salaryLabel(job.salaryMin, job.salaryMax, job.currency);
  const isDemo = job.source === "demo";
  const place = placeWithFormat(job.location, job.remote);
  const pendingAnswers = answers.filter((a) => a.status === "pending").length;
  const needs: Need[] = [];
  if (opp.status === "offer") needs.push({ text: "Оффер ждёт твоего решения", href: "/app/offers" });
  // The room of the round that is coming (else the latest one) — not the Interviews list.
  const nextRound = opp.interviews.find((iv) => iv.status === "upcoming") ?? opp.interviews[opp.interviews.length - 1];
  if (["assessment", "recruiter", "hiring_manager", "technical", "final"].includes(opp.status)) needs.push({ text: "Подготовься к следующему этапу", href: nextRound ? `/app/interviews/${nextRound.id}` : "/app/interviews" });
  if (pendingAnswers) needs.push({ text: "Ответь на вопрос из анкеты", href: "/app/approvals" });

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/applications" className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" aria-hidden />Applications
      </Link>
      <PageHeader
        eyebrow={`Заявка · ${job.company}`}
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Chip tone={statusTone(opp.status)}>{statusRu(opp.status)}</Chip>
            <span>Подано <span className="num text-head">{shortDate(opp.submittedAt)}</span></span>
            {isDemo && <span className="text-ink-3">демо-вакансия: ответы работодателя симулируются</span>}
          </span>
        }
      />

      <AgentStatus needs={needs} working={opp.status === "rejected" ? "Агент учёл этот отказ при выборе следующих вакансий." : undefined} className="-mt-3" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Timeline first in the DOM: on mobile it is the answer to "where is my application?" */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" aria-label="Статус заявки">
          <Card className="flex flex-col gap-4">
            <h2 className="label">История</h2>
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
                <Label>Отправленное CV</Label>
                <h2 className="h-serif mt-2 text-[24px]">{pkg ? cvVersionLabel(pkg.cvVersion, job.company) : "CV не сохранено"}</h2>
              </div>
              {pkg && (
                <a
                  href={`/api/applications/${opp.id}/cv`}
                  download
                  className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green"
                >
                  <Download className="size-3.5" aria-hidden />Скачать PDF
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
              <Label>Сопроводительное письмо</Label>
              <div className="whitespace-pre-line break-words text-[14.5px] leading-relaxed text-ink-2">{pkg.coverLetter}</div>
            </Card>
          )}

          {answers.length > 0 && (
            <Card className="flex flex-col gap-3">
              <Label>Ответы в анкете</Label>
              <ul className="divide-y divide-line rounded-2xl border border-stroke bg-white/55">
                {answers.map((a, i) => (
                  <li key={`${a.q}-${i}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                    <div className="min-w-0">
                      <div className="text-[13.5px] text-head">{a.q}</div>
                      <div className={cx("mt-0.5 break-words text-[13.5px]", a.a ? "text-ink-2" : "italic text-ink-3")}>{a.a ? <SentAnswer answer={a.a} /> : "без ответа"}</div>
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
              <Label>Вакансия</Label>
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
                Исходное описание вакансии
                <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="whitespace-pre-line break-words border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-2">{job.description || "Описание не предоставлено источником."}</div>
            </details>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
              <Link href={`/app/opportunities/${opp.id}`} className="inline-flex min-h-10 items-center text-teal hover:text-head">Почему агент выбрал эту вакансию</Link>
              {realUrl(job.url) && !isDemo && (
                <a href={realUrl(job.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-teal hover:text-head">
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
