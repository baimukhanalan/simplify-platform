import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronDown, ExternalLink, MapPin } from "lucide-react";
import { realUrl } from "@/lib/links";
import { currentUserId, requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { prepareOpportunity } from "@/lib/actions/campaign";
import { confirmUserSubmitted } from "@/lib/actions/ops";
import { APPLIED_OR_LATER, SENIORITY_LABEL } from "@/lib/engine/taxonomy";
import { SOURCE_LABEL, salaryLabel } from "@/lib/ops";
import { DREAM_DECISION, blockerRu, fitVerdict } from "@/lib/engine/matching";
import { Card, Chip, Label, PageHeader, Ring, Script, cx } from "@/components/ui";
import { AgentStatus, type Need } from "../../../_components/agent-status";
import { industryRu, placeWithFormat, plural, shortDate } from "../../../_components/ru";
import { fmtNum } from "@/lib/ru";
import { hhEnabled, hhIntegration, readHhMeta } from "@/lib/hh/client";
import { SubmitButton } from "@/components/client";
import { LaneChip, StatusChip } from "../_components/bits";
import { DecisionBar } from "../_components/decision";
import { Announcer } from "../_components/announcer";
import { fitCandidate } from "../_lib/candidate";
import { blockedNote, cleanRequirement, cvVersionLabel, eligibilityVerdict, interviewChance, isDreamCompany, overrideNote, risks, whyFits, type Reason } from "../_lib/fit";
import { experiencePair } from "./_lib/compare";
import { agoRu } from "../_lib/when";

/** Tab title = the role; a missing or foreign id gets the 404 title, not «Вакансия». */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, userId] = await Promise.all([params, currentUserId()]);
  const o = userId ? await db.opportunity.findFirst({ where: { id, campaign: { userId } }, select: { job: { select: { title: true, company: true } } } }) : null;
  return { title: o ? `${o.job.title} · ${o.job.company}` : "Страница не найдена" };
}

const TONE_TEXT = { green: "text-green", teal: "text-teal", amber: "text-amber", rose: "text-rose" } as const;

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const opp = await db.opportunity.findFirst({
    where: { id, campaign: { userId: user.id } },
    include: {
      job: true,
      pkg: { select: { cvVersion: true, cvText: true, summary: true, createdAt: true, submitMethod: true } },
      approvals: { where: { status: "pending" }, select: { id: true, kind: true } },
    },
  });
  if (!opp) notFound();
  const { job, pkg } = opp;

  const [candidate, facts, hh] = await Promise.all([
    fitCandidate(user),
    db.fact.findMany({ where: { userId: user.id, kind: "employment" }, select: { title: true, org: true, details: true }, orderBy: { createdAt: "asc" } }),
    job.source === "hh" && hhEnabled() ? hhIntegration(user.id) : null,
  ]);
  // hh.kz vacancies: who applies and with which resume (src/lib/hh/apply.ts).
  const hhMeta = readHhMeta(hh?.meta);
  const hhLine = job.source !== "hh" ? null
    : !hhEnabled() && !pkg?.submitMethod.startsWith("hh-") ? "Вакансия с hh.kz: отклик отправляешь ты сам на hh.kz — автоматические отклики появятся позже."
    : pkg?.submitMethod === "hh-api" || pkg?.submitMethod === "hh-user" ? "Отклик отправлен через hh.kz — от твоего аккаунта и резюме. Статус обновляется автоматически."
    : hh?.accessToken && hh.resumeId && hhMeta.status !== "reconnect" ? `Подача через hh.kz: от твоего аккаунта и резюме «${hhMeta.resumeTitle || "выбранное резюме"}». Вакансии с тестом или анкетой агент оставит тебе.`
    : "Подача через hh.kz: подключи свой аккаунт и выбери резюме в «Агент» → hh.kz — иначе отклик отправляешь ты сам.";
  const fitOpp = { match: opp.match, eligibility: opp.eligibility, pInterview: opp.pInterview, reasons: j<Reason[]>(opp.matchReasons, []), blockers: j<string[]>(opp.blockers, []).map(blockerRu), softGaps: j<string[]>(opp.softGaps, []).map(blockerRu) };
  const strengths = whyFits(fitOpp, job, candidate, 8);
  const riskList = risks(fitOpp, job, candidate);
  const chance = interviewChance(opp);
  const requirements = j<string[]>(job.requirements, []).map(cleanRequirement).filter(Boolean);
  const tech = j<string[]>(job.technologies, []);
  const salary = salaryLabel(job.salaryMin, job.salaryMax, job.currency);
  const applied = APPLIED_OR_LATER.includes(opp.status);
  // «Не проходишь» + the failing requirement go first; "Why this fits" is hidden for a blocked role (src/lib/engine/matching.ts).
  const fit = fitVerdict({ eligibility: opp.eligibility, match: opp.match, blockers: fitOpp.blockers, pInterview: opp.pInterview });
  const blocked = fit.blocked;
  const verdict = eligibilityVerdict(opp.eligibility, fit.kind);
  const isDemo = job.source === "demo";
  // Blocked only by level lines (isOverridable): the user may still send it. Dream-company level mismatch: the user's call.
  const dream = isDreamCompany(job.company, j<string[]>(user.goal?.dreamCompanies ?? "[]", []));
  const override = overrideNote(opp.eligibility, opp.blockers, dream);
  // Dream company + level off-goal — whether the engine set it aside (qualified + DREAM_DECISION) or blocked it on a
  // level line — is one case: the user's call, Apply or Skip.
  const userDecision = (j<string[]>(opp.softGaps, []).includes(DREAM_DECISION) || (dream && Boolean(override))) && opp.decision !== "apply" && opp.decision !== "auto";
  const pending = opp.approvals.filter((a) => a.kind !== "handoff").length;
  const handoff = !isDemo && !applied && Boolean(pkg) && pending === 0 && opp.status === "prepared";

  const needs: Need[] = [];
  if (pending) needs.push({ text: pending === 1 ? "Ответь на вопрос по этой вакансии" : "Ответь на вопросы по этой вакансии", href: "/app/approvals" });
  if (handoff) needs.push({ text: "Отправь пакет через официальную форму компании — ниже всё готово" });

  const originalSummary = (user.profile?.summary || user.profile?.headline || "").trim();
  const exp = pkg ? experiencePair(facts, pkg.cvText) : null;
  const place = placeWithFormat(job.location, job.remote);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/app/opportunities" className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded text-[13px] text-teal hover:text-head focus-visible:outline-2 focus-visible:outline-green">
        <ArrowLeft className="size-3.5" aria-hidden />Opportunities
      </Link>
      <PageHeader
        eyebrow={job.company}
        title={job.title}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            {place && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-ink-4" aria-hidden />{place}</span>}
            {salary && <span className="num text-head">{salary}</span>}
            <span className="text-ink-3">опубликована {agoRu(job.postedAt)}</span>
            {isDemo && <span className="text-ink-3">· демо-вакансия: подача и ответы симулируются</span>}
            <LaneChip value={opp.lane} />
            {opp.status !== "found" && opp.status !== "qualified" && <StatusChip value={opp.status} />}
          </span>
        }
      />

      {fit.blocked && (
        <p role="note" className="-mt-2 flex items-start gap-2.5 rounded-2xl border border-rose/15 bg-rose-soft/60 px-4 py-3 text-[14.5px] text-rose">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <span><b className="font-medium">{fit.headline}</b><span className="text-ink-2"> · {fit.reason}</span></span>
        </p>
      )}

      <AgentStatus needs={needs} hereNeeds={!applied} skip={opp.status === "offer" ? ["offer", "decisions"] : ["decisions"]} working={applied ? "Заявка отправлена — агент следит за ответом работодателя." : undefined} className="-mt-3" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Decision first in the DOM so it is near the top on mobile; on desktop it is the sticky right column. */}
        <aside className="flex flex-col gap-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" aria-label="Решение по вакансии">
          <Card strong className="flex flex-col gap-4">
            <Label>Решение</Label>
            {hhLine && (
              <p className="rounded-xl border border-teal/15 bg-teal/5 px-3.5 py-2.5 text-[13px] leading-snug text-ink-2">
                {hhLine}{hhEnabled() && !hh?.resumeId && !applied && <> <Link href="/app/agent#hh" className="text-teal underline-offset-2 hover:underline">Настроить</Link></>}
              </p>
            )}
            {applied ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-center gap-2 text-[14px] text-head"><Check className="size-4 text-green" aria-hidden />Заявка отправлена {shortDate(opp.submittedAt)}</p>
                <Link href={`/app/applications/${opp.id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-cta px-5 text-[14.5px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                  Открыть заявку<ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
            ) : handoff ? (
              <div className="flex flex-col gap-3">
                <p className="text-[13.5px] leading-snug text-ink-2">
                  Пакет готов. Эту заявку нужно отправить через сайт работодателя: открой форму {job.company}, вставь CV и сопроводительное письмо и отметь отправку.
                </p>
                <div className="flex flex-wrap gap-2">
                  {realUrl(job.url) && (
                    <a href={realUrl(job.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-full bg-cta px-4 text-[13px] font-medium text-white shadow-(--shadow-cta) hover:bg-[#2f2c2c] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green">
                      Открыть форму<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
                    </a>
                  )}
                  <form action={confirmUserSubmitted}>
                    <input type="hidden" name="id" value={opp.id} />
                    <SubmitButton size="sm" variant="glass" pendingText="Отмечаем…" className="!h-10">Отправлено</SubmitButton>
                  </form>
                </div>
                <DecisionBar id={opp.id} company={job.company} decision={opp.decision} status={opp.status} blocked={blocked} blockedBy={fit.kind ?? undefined} override={override} userDecision={userDecision} />
              </div>
            ) : (
              <>
                {userDecision ? (
                  <p className="text-[13.5px] leading-snug text-ink-3">
                    Компания мечты, но уровень не совпадает с целью — агент сам не подаёт. <b className="font-medium text-head">Apply</b> — подать сейчас.{" "}
                    <b className="font-medium text-head">Skip</b> — больше не показывать.
                  </p>
                ) : (
                  <p className="text-[13.5px] leading-snug text-ink-3">
                    <b className="font-medium text-head">Apply</b> — подать сейчас. <b className="font-medium text-head">Auto</b> — агент подаст сам.{" "}
                    <b className="font-medium text-head">Skip</b> — больше не показывать.
                  </p>
                )}
                <DecisionBar id={opp.id} company={job.company} decision={opp.decision} status={opp.status} blocked={blocked} blockedBy={fit.kind ?? undefined} pending={pending} size="md" override={userDecision ? null : override} forceEnable={userDecision} userDecision={userDecision} />
              </>
            )}
          </Card>
          <Card className="hidden flex-col gap-4 lg:flex">
            <JobFacts job={job} isDemo={isDemo} />
          </Card>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
          {/* Почему агент выбрал эту вакансию */}
          <Card strong className="flex flex-col gap-6">
            <div>
              <Label>Разбор агента</Label>
              <h2 className="h-serif mt-2 text-[clamp(24px,2.6vw,32px)]">Почему агент <Script>выбрал</Script> эту вакансию</h2>
            </div>
            <dl className="grid grid-cols-3 gap-3 sm:gap-6">
              <div className="flex flex-col items-start gap-2">
                <dt className="label !text-[11px]">{fit.blocked ? "Совпадение навыков" : "Match"}</dt>
                <dd>
                  <span aria-hidden><Ring value={opp.match} size={56} stroke={5} /></span>
                  <span className="sr-only">{opp.match}%</span>
                </dd>
              </div>
              <div className="flex flex-col gap-2">
                <dt className="label !text-[11px]">Требования</dt>
                <dd className="flex flex-col gap-1">
                  <span className={cx("text-[17px] font-medium leading-tight sm:text-[20px]", TONE_TEXT[verdict.tone])}>{verdict.label}</span>
                  <span className="text-[12px] leading-snug text-ink-3">{verdict.hint}</span>
                </dd>
              </div>
              <div className="flex flex-col gap-2">
                <dt className="label !text-[11px]">Interview probability</dt>
                <dd className="flex flex-col gap-1">
                  {fit.pInterview === null ? (
                    <>
                      <span className="num text-[28px] leading-none text-ink-4" aria-hidden>—</span>
                      <span className="text-[12px] leading-snug text-ink-3">не считается: вакансия вне твоих фильтров</span>
                    </>
                  ) : (
                    <>
                      <span className={cx("num text-[28px] leading-none", TONE_TEXT[chance.tone])}>{chance.pct}%</span>
                      <span className="text-[12px] leading-snug text-ink-3">{blocked ? "не проходишь по требованиям — агент не подаёт" : chance.qual}</span>
                    </>
                  )}
                </dd>
              </div>
            </dl>
            <div className={cx("grid gap-5 border-t border-line pt-5", fit.showWhyFits && "md:grid-cols-2")}>
              {fit.showWhyFits && <section aria-labelledby="strengths-h" className="flex flex-col gap-2.5">
                <h3 id="strengths-h" className="label !text-green">Why this fits</h3>
                {strengths.length ? (
                  <ul className="flex flex-col gap-1.5 text-[14px] text-ink-2">
                    {strengths.map((s) => <li key={s} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-green" strokeWidth={2.2} aria-hidden />{s}</li>)}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-ink-3">Явных совпадений мало — агент нашёл вакансию по смежной роли.</p>
                )}
              </section>}
              <section aria-labelledby="risks-h" className="flex flex-col gap-2.5">
                <h3 id="risks-h" className="label !text-[#6e4a0b]">Риски</h3>
                {riskList.length ? (
                  <ul className="flex flex-col gap-1.5 text-[14px] text-ink-2">
                    {riskList.map((r) => <li key={r} className={cx("flex gap-2", fitOpp.blockers.includes(r) && "text-rose")}><AlertTriangle className={cx("mt-0.5 size-4 shrink-0", fitOpp.blockers.includes(r) ? "text-rose" : "text-amber")} strokeWidth={1.8} aria-hidden />{r}</li>)}
                  </ul>
                ) : (
                  <p className="text-[13.5px] text-ink-3">Существенных рисков агент не видит.</p>
                )}
              </section>
            </div>
          </Card>

          {/* Адаптация CV */}
          <Card className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <Label>Адаптация CV</Label>
                <h2 className="h-serif mt-2 text-[24px]">Как агент <Script>адаптировал</Script> CV</h2>
              </div>
              {pkg && <span className="rounded-full bg-cta px-3 py-1 text-[12px] text-white">{cvVersionLabel(pkg.cvVersion, job.company)}</span>}
            </div>
            {pkg ? (
              <div className="flex flex-col gap-5">
                <Compare title="Краткое резюме" original={originalSummary || "В профиле нет краткого резюме."} simplify={pkg.summary} />
                {exp && <Compare title={exp.heading} original={exp.original} simplify={exp.simplify} list />}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {originalSummary && <Compare title="Краткое резюме" original={originalSummary} simplify={null} />}
                <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13.5px] text-ink-2">
                    {blocked ? `${fit.kind ? blockedNote(fit.kind) : "Агент не подаёт"}: CV под эту вакансию не готовится.` : "Персональную версию CV агент соберёт, когда ты выберешь Apply или Auto. Черновик можно посмотреть заранее — это ничего не отправляет и не меняет статус."}
                  </p>
                  {!blocked && opp.status !== "skipped" && (
                    <form action={prepareOpportunity} className="shrink-0">
                      <input type="hidden" name="id" value={opp.id} />
                      <SubmitButton size="sm" variant="glass" pendingText="Собираем черновик…" className="!h-10">Показать черновик CV</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Описание вакансии */}
          <Card className="flex flex-col gap-4">
            <Label>Вакансия</Label>
            <div className="lg:hidden"><JobFacts job={job} isDemo={isDemo} /></div>
            {tech.length > 0 && <ul className="flex flex-wrap gap-1.5" aria-label="Технологии">{tech.map((t) => <li key={t}><Chip>{t}</Chip></li>)}</ul>}
            {requirements.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="label !text-[11px]">Требования</span>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] text-ink-2 marker:text-teal">{requirements.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            )}
            <details className="group rounded-2xl border border-stroke bg-white/50">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] text-head focus-visible:outline-2 focus-visible:outline-green [&::-webkit-details-marker]:hidden">
                Описание вакансии
                <ChevronDown className="size-4 text-teal transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="whitespace-pre-line break-words border-t border-line px-4 py-4 text-[14px] leading-relaxed text-ink-2">{job.description || "Описание не предоставлено источником."}</div>
            </details>
          </Card>
        </div>

      </div>
      <Announcer />
    </div>
  );
}

/** Demo jobs have no real posting behind them, so there is no "original" link for them. */
function JobFacts({ job, isDemo }: { job: { seniority: string; minYears: number; sponsorship: string; industry: string; source: string; postedAt: Date; url: string }; isDemo: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Fact k="Уровень" v={SENIORITY_LABEL[job.seniority] ?? job.seniority} />
        <Fact k="Опыт" v={job.minYears ? `от ${fmtNum(job.minYears)} ${job.minYears % 1 === 0 ? plural(job.minYears, ["года", "лет", "лет"]) : "года"}` : "не указан"} />
        <Fact k="Спонсорство" v={job.sponsorship === "yes" ? "есть" : job.sponsorship === "no" ? "нет" : "не указано"} />
        <Fact k="Отрасль" v={job.industry ? industryRu(job.industry) : "—"} />
        <Fact k="Источник" v={job.source === "demo" ? "Демо" : SOURCE_LABEL[job.source] ?? job.source} />
        <Fact k="Опубликована" v={shortDate(job.postedAt)} />
      </dl>
      {realUrl(job.url) && !isDemo && (
        <a href={realUrl(job.url)!} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 w-fit items-center gap-1.5 text-[13px] text-teal hover:text-head">
          Оригинал вакансии<ExternalLink className="size-3.5" aria-hidden /><span className="sr-only">(откроется в новой вкладке)</span>
        </a>
      )}
    </div>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="label !text-[11px]">{k}</dt>
      <dd className="truncate text-head" title={v}>{v}</dd>
    </div>
  );
}

/** Side by side on desktop, stacked on mobile: what the user wrote vs what went into this application. */
function Compare({ title, original, simplify, list }: { title: string; original: string | string[]; simplify: string | string[] | null; list?: boolean }) {
  const norm = (v: string | string[]) => (Array.isArray(v) ? v.join("\n") : v).replace(/\s+/g, " ").trim().toLowerCase();
  const same = simplify != null && norm(simplify) === norm(original);
  const body = (v: string | string[]) =>
    list && Array.isArray(v) ? (
      <ul className="flex flex-col gap-1.5">{v.map((l, i) => <li key={`${i}-${l}`} className="flex gap-2"><span className="mt-2 size-1 shrink-0 rounded-full bg-current opacity-50" aria-hidden />{l}</li>)}</ul>
    ) : (
      <p>{Array.isArray(v) ? v.join(" ") : v}</p>
    );
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-[14px] font-medium text-head">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-2xl border border-stroke bg-white/45 p-4">
          <span className="label !text-[11px]">Было</span>
          <div className="text-[13.5px] leading-relaxed text-ink-3">{body(original)}</div>
        </div>
        <div className="flex flex-col gap-2 rounded-2xl border border-green/20 bg-mint-2/80 p-4">
          <span className="label !text-[11px] !text-green">Версия агента</span>
          <div className="text-[13.5px] leading-relaxed text-ink">{same ? <p className="text-ink-3">Без изменений</p> : simplify ? body(simplify) : <p className="text-ink-3">Появится после подготовки пакета.</p>}</div>
        </div>
      </div>
    </section>
  );
}
