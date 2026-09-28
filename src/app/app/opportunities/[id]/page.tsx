import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ChevronDown, ExternalLink, X } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { prepareOpportunity, submitOpportunity } from "@/lib/actions/campaign";
import { confirmUserSubmitted } from "@/lib/actions/ops";
import type { Answer } from "@/lib/engine/personalize";
import { APPLIED_OR_LATER, ROLE_FAMILIES, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { segmentLabel } from "@/lib/engine/insights";
import { ELIGIBILITY, REMOTE_LABEL, SOURCE_LABEL, ago, fmtDate, salaryLabel, submitMethodLabel } from "@/lib/ops";
import { ButtonLink, Card, Chip, DemoBadge, Label, PageHeader, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { EligibilityChip, LaneChip, MatchReasons, Metric, SkipButton, StatusChip, StatusMover, matchTone } from "../_components/bits";
import { AuditTrail, type AuditItem } from "./_components/audit-trail";

export const metadata = { title: "Вакансия" };

const DAY = 86400000;

const ANSWER_GROUPS: { key: Answer["category"]; label: string; hint: string }[] = [
  { key: "auto", label: "AI отвечает сам", hint: "Факты из вашего профиля: опыт, навыки, мотивация" },
  { key: "rule", label: "По правилу", hint: "Ответы по вашим настройкам: авторизация, зарплата, релокация, notice period" },
  { key: "approval", label: "Требует подтверждения", hint: "Юридические, чувствительные и спорные вопросы — только с вашего согласия" },
];

const ANSWER_STATUS: Record<string, { label: string; tone: "green" | "amber" | "neutral" }> = {
  filled: { label: "заполнено", tone: "neutral" },
  approved: { label: "подтверждено", tone: "green" },
  pending: { label: "ждёт вас", tone: "amber" },
};

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId: user.id } },
    include: {
      job: true,
      pkg: true,
      campaign: { select: { allocation: true, autoSubmit: true, status: true } },
      events: { orderBy: { createdAt: "asc" } },
      approvals: { orderBy: { createdAt: "asc" } },
      inbox: { orderBy: { receivedAt: "asc" } },
      interviews: { orderBy: { createdAt: "asc" } },
      offers: true,
    },
  });
  if (!opp) notFound();
  const { job, pkg } = opp;

  const reasons = j<{ label: string; ok: boolean }[]>(opp.matchReasons, []);
  const blockers = j<string[]>(opp.blockers, []);
  const softGaps = j<string[]>(opp.softGaps, []);
  const requirements = j<string[]>(job.requirements, []);
  const tech = j<string[]>(job.technologies, []);
  const allocation = j<Record<string, number>>(opp.campaign.allocation, {});
  const isDemo = job.source === "demo";
  const pendingApprovals = opp.approvals.filter((a) => a.status === "pending" && a.kind !== "handoff");
  const handoff = opp.approvals.find((a) => a.status === "pending" && a.kind === "handoff");
  const applied = APPLIED_OR_LATER.includes(opp.status);
  const salary = salaryLabel(job.salaryMin, job.salaryMax, job.currency);

  // ——— Ranking explanation: same factors as the engine's P(Interview | candidate, job, company, timing) ———
  const now = new Date();
  const freshDays = Math.max(0, (now.getTime() - job.postedAt.getTime()) / DAY);
  const fresh = freshDays < 1 ? 1.25 : freshDays < 3 ? 1.12 : freshDays < 7 ? 1 : freshDays < 14 ? 0.82 : freshDays < 30 ? 0.6 : 0.35;
  const competition = job.remote === "remote" && !job.massHiring ? 0.8 : 1;
  const mass = job.massHiring ? 1.35 : 1;
  const weight = allocation[job.roleFamily] ?? 1;
  const eligF = opp.eligibility === "blocked" ? 0 : opp.eligibility === "soft" ? 0.7 : 1;
  const base = Math.pow(opp.match / 100, 2.2) * 0.32;
  const factors = [
    { label: "Базовый шанс от Match", value: `${(base * 100).toFixed(1)}%`, note: `Match ${opp.match} → (${opp.match}/100)^2.2 × 32%` },
    { label: "Свежесть", value: `×${fresh}`, note: `опубликована ${ago(job.postedAt)} — ранние заявки видят чаще` },
    { label: "Конкуренция", value: `×${competition}`, note: competition < 1 ? "глобальный remote — больше кандидатов" : "обычная конкуренция" },
    { label: "Mass hiring", value: `×${mass}`, note: job.massHiring ? "массовый найм — высокий отклик" : "не массовый найм" },
    { label: "Вес сегмента", value: `×${weight}`, note: `Feedback Loop: «${segmentLabel(job.roleFamily)}» ${weight > 1 ? "конвертирует лучше среднего" : weight < 1 ? "конвертирует хуже среднего" : "пока без данных"}` },
    { label: "Eligibility", value: `×${eligF}`, note: ELIGIBILITY[opp.eligibility]?.hint ?? "" },
  ];
  const live = Math.min(0.6, base * fresh * competition * mass * weight * eligF);

  // ——— Audit Trail ———
  const audit: AuditItem[] = [{ at: opp.createdAt, kind: "discovery", title: "Найдена агентом", detail: `Match ${opp.match} · ${ELIGIBILITY[opp.eligibility]?.label} · P(Interview) ${Math.round(opp.pInterview * 100)}%` }];
  const has = (t: string) => opp.events.some((e) => e.type === t);
  for (const e of opp.events) {
    if (e.type === "inbox" || e.type === "interview_room" || e.type === "approval") continue; // rendered from their own rows below
    const d = j<{ method?: string; from?: string; to?: string }>(e.data, {});
    audit.push({
      at: e.createdAt,
      kind: e.type,
      title: e.type === "submitted" ? "Заявка отправлена" : e.type === "prepared" ? "Application Package собран" : e.type === "status_change" ? "Статус изменён вручную" : e.type,
      detail: e.type === "submitted" ? `${e.message} · способ: ${submitMethodLabel(pkg?.submitMethod || (d.method === "user" ? "user-handoff" : `ats:${job.source}`))}` : e.message,
    });
  }
  if (pkg && !has("prepared")) audit.push({ at: pkg.createdAt, kind: "prepared", title: "Application Package собран", detail: `CV ${pkg.cvVersion} · ${pkg.generatedBy === "claude" ? "Claude" : "engine"}` });
  if (opp.submittedAt && !has("submitted")) audit.push({ at: opp.submittedAt, kind: "submitted", title: "Заявка отправлена", detail: `Способ: ${submitMethodLabel(pkg?.submitMethod ?? "")}${pkg ? ` · CV ${pkg.cvVersion}` : ""}` });
  for (const a of opp.approvals.filter((a) => a.resolvedAt)) {
    audit.push({
      at: a.resolvedAt!,
      kind: "approval",
      title: a.status === "rejected" ? "Вы отклонили" : a.kind === "handoff" ? "Вы отправили заявку сами" : "Вы подтвердили ответ",
      detail: a.kind === "handoff" ? undefined : `«${a.question}»${a.answer ? ` → ${a.answer}` : ""}`,
    });
  }
  for (const m of opp.inbox) {
    const ev = opp.events.find((e) => e.type === "inbox" && Math.abs(e.createdAt.getTime() - m.receivedAt.getTime()) < 15000);
    audit.push({ at: m.receivedAt, kind: "inbox", title: `Письмо: ${m.subject}`, detail: ev ? ev.message : `Распознано как ${m.classification}`, href: `/app/inbox?m=${m.id}`, tag: m.simulated ? "симуляция" : undefined });
  }
  for (const iv of opp.interviews) audit.push({ at: iv.createdAt, kind: "interview_room", title: `Interview Room: ${iv.round}`, detail: `назначено на ${fmtDate(iv.scheduledAt, true)} · ${iv.status}`, href: "/app/interviews" });
  for (const offer of opp.offers) audit.push({ at: offer.createdAt, kind: "offer", title: "Оффер получен", detail: `${offer.role} · base $${offer.base.toLocaleString("en-US")}`, href: "/app/offers" });
  audit.sort((a, b) => a.at.getTime() - b.at.getTime());

  const answers = pkg ? j<Answer[]>(pkg.answers, []) : [];
  const skillsOrder = pkg ? j<string[]>(pkg.skillsOrder, []) : [];
  const projects = pkg ? j<string[]>(pkg.projects, []) : [];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/opportunities" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-teal hover:text-head"><ArrowLeft className="size-3.5" aria-hidden />Все вакансии</Link>
      <PageHeader
        eyebrow={`${job.company} · ${ROLE_FAMILIES[job.roleFamily]?.label ?? job.roleFamily}`}
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <span>{job.company}{job.location ? ` · ${job.location}` : ""}</span>
            <Chip tone={job.remote === "remote" ? "green" : "neutral"}>{REMOTE_LABEL[job.remote] ?? job.remote}</Chip>
            {salary && <span className="num text-head">{salary}</span>}
            {isDemo && <DemoBadge />}
            <LaneChip value={opp.lane} />
            <StatusChip value={opp.status} />
          </span>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
        {/* Actions */}
        <Card strong className="flex flex-col gap-4 lg:col-start-2 lg:row-start-1">
          <div className="flex items-center justify-between gap-3">
            <Label>Действия</Label>
            <StatusMover id={opp.id} current={opp.status} label="Сменить статус" />
          </div>
          <ActionPanel
            opp={{ id: opp.id, status: opp.status, applied, submittedAt: opp.submittedAt }}
            hasPkg={Boolean(pkg)}
            isDemo={isDemo}
            jobUrl={job.url}
            company={job.company}
            pending={pendingApprovals.length}
            handoff={Boolean(handoff)}
            blocked={opp.eligibility === "blocked"}
            submitMethod={pkg?.submitMethod ?? ""}
          />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-[13px]">
            <Fact k="Уровень" v={SENIORITY_LABEL[job.seniority] ?? job.seniority} />
            <Fact k="Опыт" v={job.minYears ? `${job.minYears}+ лет` : "не указан"} />
            <Fact k="Опубликована" v={ago(job.postedAt)} />
            <Fact k="Источник" v={SOURCE_LABEL[job.source] ?? job.source} />
            <Fact k="Спонсорство" v={job.sponsorship === "yes" ? "есть" : job.sponsorship === "no" ? "нет" : "не указано"} />
            <Fact k="Отрасль" v={job.industry || "—"} />
          </dl>
          {job.url && (
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[13px] text-teal hover:text-head">
              Оригинал вакансии <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
            </a>
          )}
        </Card>

        {/* Main column */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div><Label>Match</Label><p className="mt-1 text-[12.5px] text-ink-3">Профессиональный fit: роль, навыки, опыт, уровень, зарплата</p></div>
                <Metric label="из 100" value={`${opp.match}`} tone={matchTone(opp.match)} className="items-end" />
              </div>
              <MatchReasons reasons={reasons} limit={20} className="!gap-y-1.5 text-[13.5px]" />
            </Card>
            <Card className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div><Label>Eligibility</Label><p className="mt-1 text-[12.5px] text-ink-3">Можете ли вы формально пройти — отдельно от fit</p></div>
                <EligibilityChip value={opp.eligibility} />
              </div>
              {blockers.length === 0 && softGaps.length === 0 && <p className="flex items-center gap-2 text-[13.5px] text-green"><Check className="size-4" aria-hidden />Формальных препятствий нет</p>}
              {blockers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="label !text-[9.5px] !text-rose">Hard blockers</span>
                  <ul className="flex flex-col gap-1 text-[13.5px] text-rose">{blockers.map((b) => <li key={b} className="flex gap-2"><X className="mt-0.5 size-3.5 shrink-0" aria-hidden />{b}</li>)}</ul>
                </div>
              )}
              {softGaps.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="label !text-[9.5px] !text-amber">Soft gaps</span>
                  <ul className="flex flex-col gap-1 text-[13.5px] text-ink-2">{softGaps.map((b) => <li key={b} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-amber" aria-hidden />{b}</li>)}</ul>
                </div>
              )}
            </Card>
          </div>

          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><Label>Почему такой приоритет</Label><h2 className="h-serif mt-2 text-[22px]">P(Interview) = {opp.eligibility === "blocked" ? "0" : `${Math.round(opp.pInterview * 100)}%`}</h2></div>
              <span className="text-[12.5px] text-ink-3">приоритет {opp.priority.toFixed(3)}</span>
            </div>
            <ul className="divide-y divide-line">
              {factors.map((f) => (
                <li key={f.label} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[180px_1fr_auto]">
                  <span className="text-[13.5px] text-head">{f.label}</span>
                  <span className="order-3 col-span-2 text-[12.5px] text-ink-3 sm:order-none sm:col-span-1">{f.note}</span>
                  <span className="num text-right text-[14px] text-head">{f.value}</span>
                </li>
              ))}
            </ul>
            {!applied && Math.abs(live - opp.pInterview) > 0.01 && <p className="text-[12.5px] text-ink-3">С текущими факторами — {Math.round(live * 100)}%. Агент пересчитает приоритет на следующем цикле.</p>}
            {applied && <p className="text-[12.5px] text-ink-3">P(Interview) зафиксирован на момент отправки. Факторы показаны на сегодня.</p>}
          </Card>

          <Card className="flex flex-col gap-4">
            <Label>Вакансия</Label>
            {tech.length > 0 && <div className="flex flex-wrap gap-1.5">{tech.map((t) => <Chip key={t}>{t}</Chip>)}</div>}
            {requirements.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="label !text-[9.5px]">Требования</span>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2 marker:text-teal">{requirements.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            <details className="group rounded-2xl border border-stroke bg-white/50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                Полное описание
                <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="whitespace-pre-line border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-2">{job.description || "Описание не предоставлено источником."}</div>
            </details>
          </Card>

          {/* Application Package */}
          <Card className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>Application Package</Label>
                <h2 className="h-serif mt-2 text-[24px]">{pkg ? <>Что мы <span className="script">отправили</span>{applied ? "" : " бы"}</> : "Пакет ещё не собран"}</h2>
              </div>
              {pkg && (
                <div className="flex flex-wrap gap-1.5">
                  <Chip tone="dark">CV {pkg.cvVersion}</Chip>
                  <Chip tone={pkg.generatedBy === "claude" ? "teal" : "neutral"}>{pkg.generatedBy === "claude" ? "Claude" : "engine"}</Chip>
                  {pkg.submitMethod && <Chip tone="green">{submitMethodLabel(pkg.submitMethod)}</Chip>}
                </div>
              )}
            </div>
            {!pkg ? (
              <p className="text-[14px] text-ink-3">
                {opp.eligibility === "blocked" ? "У вакансии hard blocker — агент не готовит пакет, чтобы не тратить заявку." : "Агент соберёт CV-вариант, cover letter и ответы на скрининг, когда вакансия дойдёт до очереди — или прямо сейчас, по кнопке «Подготовить пакет»."}
              </p>
            ) : (
              <>
                <section className="flex flex-col gap-2">
                  <span className="label !text-[9.5px]">Summary</span>
                  <p className="text-[14.5px] leading-relaxed text-ink">{pkg.summary}</p>
                </section>
                <div className="grid gap-5 md:grid-cols-2">
                  <section className="flex flex-col gap-2">
                    <span className="label !text-[9.5px]">Порядок навыков</span>
                    <ol className="flex flex-wrap gap-1.5">{skillsOrder.map((s, i) => <li key={s}><Chip><span className="text-ink-4">{i + 1}</span> {s}</Chip></li>)}</ol>
                  </section>
                  <section className="flex flex-col gap-2">
                    <span className="label !text-[9.5px]">Проекты в фокусе</span>
                    {projects.length ? <ul className="flex flex-col gap-1 text-[14px] text-ink-2">{projects.map((p) => <li key={p}>{p}</li>)}</ul> : <p className="text-[13.5px] text-ink-3">—</p>}
                  </section>
                </div>
                <section className="flex flex-col gap-2">
                  <span className="label !text-[9.5px]">CV {pkg.cvVersion}</span>
                  <pre tabIndex={0} aria-label="Текст CV" className="scroll-thin max-h-[440px] overflow-auto whitespace-pre-wrap rounded-2xl border border-stroke bg-white/80 p-4 font-mono text-[12.5px] leading-[1.65] text-ink focus-visible:outline-2 focus-visible:outline-green sm:p-5">{pkg.cvText}</pre>
                </section>
                <section className="flex flex-col gap-2">
                  <span className="label !text-[9.5px]">Cover letter</span>
                  <div className="whitespace-pre-line rounded-2xl border border-stroke bg-white/60 p-4 text-[14px] leading-relaxed text-ink-2 sm:p-5">{pkg.coverLetter}</div>
                </section>
                <section className="flex flex-col gap-4">
                  <span className="label !text-[9.5px]">Screening answers</span>
                  {ANSWER_GROUPS.map((g) => {
                    const list = answers.filter((a) => a.category === g.key);
                    if (!list.length) return null;
                    return (
                      <div key={g.key} className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          <h3 className="text-[14px] font-medium text-head">{g.label}</h3>
                          <span className="text-[12px] text-ink-3">{g.hint}</span>
                        </div>
                        <ul className="divide-y divide-line rounded-2xl border border-stroke bg-white/55">
                          {list.map((a, i) => {
                            const st = ANSWER_STATUS[a.status] ?? ANSWER_STATUS.filled;
                            return (
                              <li key={`${a.q}-${i}`} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:gap-4">
                                <div className="min-w-0">
                                  <div className="text-[13.5px] text-head">{a.q}</div>
                                  <div className={cx("mt-0.5 text-[13.5px]", a.a ? "text-ink-2" : "italic text-ink-4")}>{a.a || "ответ не дан — ждёт вашего решения"}</div>
                                </div>
                                <div className="flex flex-wrap items-start gap-1.5 sm:justify-end">
                                  {a.kind && a.kind !== "salary" && <Chip>{a.kind}</Chip>}
                                  <Chip tone={st.tone}>{st.label}</Chip>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </Card>
        </div>

        {/* Audit Trail */}
        <Card className="flex flex-col gap-4 lg:col-start-2 lg:row-start-2">
          <div>
            <Label>Audit Trail</Label>
            <p className="mt-1.5 text-[12.5px] text-ink-3">Если вас пригласят через месяц — здесь видно, что именно и когда было отправлено.</p>
          </div>
          <AuditTrail items={audit} />
        </Card>
      </div>
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label !text-[9.5px]">{k}</dt>
      <dd className="truncate text-head">{v}</dd>
    </div>
  );
}

function ActionPanel({ opp, hasPkg, isDemo, jobUrl, company, pending, handoff, blocked, submitMethod }: {
  opp: { id: string; status: string; applied: boolean; submittedAt: Date | null }; hasPkg: boolean; isDemo: boolean; jobUrl: string; company: string;
  pending: number; handoff: boolean; blocked: boolean; submitMethod: string;
}) {
  if (opp.applied) {
    return (
      <div className="flex flex-col gap-1.5 text-[14px] text-ink-2">
        <div className="flex items-center gap-2 text-head"><Check className="size-4 text-green" aria-hidden />Заявка отправлена {opp.submittedAt ? ago(opp.submittedAt) : ""}</div>
        <p className="text-[13px] text-ink-3">Способ: {submitMethodLabel(submitMethod)}. Дальше статус обновляет Inbox Intelligence — или вы вручную.</p>
      </div>
    );
  }
  if (opp.status === "skipped") {
    return <p className="text-[14px] text-ink-3">Вакансия пропущена{blocked ? " из-за hard blocker" : ""}. Верните её в работу через «Сменить статус», если передумали.</p>;
  }
  if (!hasPkg) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] text-ink-2">{blocked ? "Есть hard blocker — подготовка пакета, скорее всего, потратит заявку впустую." : "Соберём CV-вариант, cover letter и ответы на скрининг под эту вакансию."}</p>
        <div className="flex flex-wrap gap-2">
          <form action={prepareOpportunity}><input type="hidden" name="id" value={opp.id} /><SubmitButton size="sm" pendingText="Готовим пакет…" variant={blocked ? "glass" : "primary"}>Подготовить пакет</SubmitButton></form>
          <SkipButton id={opp.id} />
        </div>
      </div>
    );
  }
  if (pending > 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] text-ink-2"><span className="num text-head">{pending}</span> {pending === 1 ? "вопрос требует" : "вопроса требуют"} вашего решения — без этого агент не отправит заявку.</p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/app/approvals" size="sm">Разобрать вопросы</ButtonLink>
          <SkipButton id={opp.id} />
        </div>
      </div>
    );
  }
  if (isDemo) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13.5px] text-ink-2">Пакет готов. Демо-вакансия уходит через симулированный ATS — настоящему работодателю ничего не отправляется.</p>
        <div className="flex flex-wrap gap-2">
          <form action={submitOpportunity}><input type="hidden" name="id" value={opp.id} /><SubmitButton size="sm" variant="green" pendingText="Отправляем…">Отправить (демо)</SubmitButton></form>
          <SkipButton id={opp.id} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13.5px] text-ink-2">
        Живая вакансия: автоматическая отправка недоступна. Откройте официальную форму {company}, вставьте материалы из пакета ниже и отметьте отправку.{handoff ? " Задача уже в очереди подтверждений." : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {jobUrl && (
          <a href={jobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
            Открыть форму <ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
          </a>
        )}
        <form action={confirmUserSubmitted}><input type="hidden" name="id" value={opp.id} /><SubmitButton size="sm" variant="glass" pendingText="Отмечаем…">Я отправил</SubmitButton></form>
        <SkipButton id={opp.id} />
      </div>
    </div>
  );
}
