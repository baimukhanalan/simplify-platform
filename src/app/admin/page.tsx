import { Play, AlertTriangle, ShieldAlert } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { Card, Chip, Label, PageHeader, Progress, Script, Stat, cx } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { adminRunTick } from "@/lib/actions/admin";
import { APPLIED_OR_LATER, fmtKzt } from "@/lib/engine/taxonomy";
import { reachedInterview } from "@/lib/engine/insights";
import { IngestPanel } from "./_components/ingest-panel";

export const metadata = { title: "Operations — Simplify" };

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const DAY = 86400000;
const maskEmail = (e: string) => e.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
const since = (d: Date | null, now: number) => {
  if (!d) return "никогда";
  const m = Math.round((now - d.getTime()) / 60000);
  return m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн. назад`;
};
function sample<T>(arr: T[], n: number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const k = Math.floor(Math.random() * (i + 1));
    [a[i], a[k]] = [a[k], a[i]];
  }
  return a.slice(0, n);
}
const clock = () => Date.now();

const INCIDENTS = [
  { date: "24 сен", sev: "low", title: "Arbeitnow API отвечал 503 ~40 минут", note: "Ingest пропустил источник, повтор в следующем цикле. Данные не потеряны." },
  { date: "17 сен", sev: "medium", title: "Классификатор Inbox: письма «next steps» → info", note: "Добавлены паттерны раундов; 6 писем переклассифицированы вручную." },
  { date: "09 сен", sev: "low", title: "Дубли вакансий Greenhouse при смене updated_at", note: "dedupeKey теперь не зависит от даты обновления." },
];

export default async function AdminPage() {
  await requireAdmin();
  const now = clock();
  const [campaigns, approvals, pkgPool, jobGroups, payments, qualifiedIvs] = await Promise.all([
    db.campaign.findMany({
      where: { status: { not: "draft" } },
      include: {
        user: { select: { id: true, name: true, email: true } },
        opportunities: { select: { status: true, submittedAt: true, _count: { select: { offers: true } }, interviews: { select: { round: true, createdAt: true } } } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.approval.findMany({
      where: { status: "pending" },
      select: { id: true, kind: true, question: true, createdAt: true, userId: true, user: { select: { email: true } }, opportunity: { select: { job: { select: { company: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 60,
    }),
    db.applicationPackage.findMany({
      where: { truthCheck: { contains: '"ok":false' } },
      select: { id: true, cvVersion: true, generatedBy: true, truthCheck: true, createdAt: true, opportunity: { select: { job: { select: { company: true, title: true } } } } },
      take: 200,
      orderBy: { createdAt: "desc" },
    }),
    db.job.groupBy({ by: ["source", "active"], _count: { _all: true } }),
    db.payment.findMany({ where: { status: "paid" }, select: { amount: true, partnerCut: true } }),
    db.interview.findMany({ where: { round: { not: "assessment" } }, select: { userId: true } }),
  ]);

  // ——— KPIs ———
  const opps = campaigns.flatMap((c) => c.opportunities);
  const applied = opps.filter((o) => o.submittedAt || APPLIED_OR_LATER.includes(o.status));
  const responded = applied.filter((o) => !["submitted", "pending"].includes(o.status) || o.interviews.length > 0);
  const assessed = applied.filter((o) => o.status === "assessment" || o.interviews.some((i) => i.round === "assessment"));
  const qualifiedCount = (o: (typeof opps)[number]) => o.interviews.filter((i) => i.round !== "assessment").length;
  const interviewed = applied.filter((o) => reachedInterview(o.status, qualifiedCount(o)));
  const offered = interviewed.filter((o) => ["offer", "hired"].includes(o.status) || o._count.offers > 0);
  const campaignsWithIv = campaigns.filter((c) => c.opportunities.some((o) => qualifiedCount(o) > 0));
  const ttfi = campaignsWithIv
    .map((c) => {
      const first = Math.min(...c.opportunities.flatMap((o) => o.interviews.filter((i) => i.round !== "assessment").map((i) => i.createdAt.getTime())));
      return c.startedAt && Number.isFinite(first) ? Math.max(0, (first - c.startedAt.getTime()) / DAY) : null;
    })
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const medianTtfi = ttfi.length ? ttfi[Math.floor(ttfi.length / 2)] : null;
  const usersWithIv = new Set(qualifiedIvs.map((i) => i.userId)).size;
  const usersInCampaigns = new Set(campaigns.map((c) => c.userId)).size;
  const revenue = payments.reduce((a, p) => a + p.amount, 0);
  const payouts = payments.reduce((a, p) => a + p.partnerCut, 0);
  const northStar = pct(campaignsWithIv.length, campaigns.length);

  const funnel = [
    { label: "Application → Response", v: pct(responded.length, applied.length), n: `${responded.length}/${applied.length}` },
    { label: "Application → Assessment", v: pct(assessed.length, applied.length), n: `${assessed.length}/${applied.length}` },
    { label: "Application → Interview", v: pct(interviewed.length, applied.length), n: `${interviewed.length}/${applied.length}` },
    { label: "Interview → Offer", v: pct(offered.length, interviewed.length), n: `${offered.length}/${interviewed.length}` },
  ];

  // ——— Active campaigns ———
  const active = campaigns.filter((c) => c.status === "active" || c.status === "paused");
  const pendingByUser = approvals.reduce<Record<string, number>>((a, x) => ({ ...a, [x.userId]: (a[x.userId] ?? 0) + 1 }), {});

  // ——— CV quality sample ———
  const cvSample = sample(pkgPool, 5).map((p) => ({ ...p, issues: j<{ claim: string; ok: boolean; note?: string }[]>(p.truthCheck, []).filter((t) => !t.ok) }));

  // ——— Jobs ———
  const sources = [...new Set(jobGroups.map((g) => g.source))].sort();
  const bySource = sources.map((s) => ({
    source: s,
    active: jobGroups.find((g) => g.source === s && g.active)?._count._all ?? 0,
    retired: jobGroups.find((g) => g.source === s && !g.active)?._count._all ?? 0,
  }));
  const maxJobs = Math.max(1, ...bySource.map((s) => s.active + s.retired));

  return (
    <>
      <PageHeader eyebrow="Operations console" title={<>Operations <Script>desk</Script></>} sub="Здоровье кампаний, очередь исключений, качество CV и загрузка вакансий. Персональные ответы пользователей здесь не показываются." />

      <div className="flex flex-col gap-8">
        {/* KPIs */}
        <section aria-labelledby="kpi-h" className="flex flex-col gap-4">
          <h2 id="kpi-h" className="sr-only">Ключевые метрики</h2>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_2fr]">
            <Card strong className="flex flex-col justify-between gap-4">
              <div>
                <Label className="mb-2">North star</Label>
                <p className="text-[14px] text-ink-2">Доля кампаний, дошедших до квалифицированного интервью (не assessment)</p>
              </div>
              <div className="flex items-end gap-3">
                <span className="num text-[64px] leading-none text-green">{northStar}%</span>
                <span className="num mb-2 text-[14px] text-ink-3">{campaignsWithIv.length}/{campaigns.length} кампаний</span>
              </div>
              <Progress value={northStar} />
            </Card>
            <Card>
              <Label className="mb-4">Воронка</Label>
              <ul className="flex flex-col gap-3.5">
                {funnel.map((f) => (
                  <li key={f.label} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 sm:grid-cols-[210px_1fr_90px]">
                    <span className="text-[13.5px] text-ink-2">{f.label}</span>
                    <span className="num text-right text-[15px] text-head sm:order-last">{f.v}% <span className="text-[11.5px] text-ink-4">{f.n}</span></span>
                    <Progress value={f.v} tone="teal" className="col-span-2 sm:col-span-1" />
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Card><Stat label="Users с ≥1 интервью" value={usersWithIv} hint={`из ${usersInCampaigns} в кампаниях`} /></Card>
            <Card><Stat label="Time to first interview" value={medianTtfi == null ? "—" : `${medianTtfi.toFixed(1)} д`} hint="медиана" /></Card>
            <Card><Stat label="Выручка" value={<span className="text-[24px]">{fmtKzt(revenue)}</span>} hint="оплачено" /></Card>
            <Card><Stat label="Gross campaigns" value={campaigns.length} hint={`${active.length} активных`} /></Card>
            <Card className="col-span-2 lg:col-span-1"><Stat label="Partner payouts" value={<span className="text-[24px]">{fmtKzt(payouts)}</span>} hint={`${pct(payouts, revenue)}% выручки`} /></Card>
          </div>
        </section>

        {/* Active campaigns */}
        <section aria-labelledby="camp-h">
          <Card className="!p-0">
            <div className="flex items-center justify-between gap-2 px-5 pt-5 sm:px-6">
              <h2 id="camp-h" className="h-serif text-[22px]">Активные кампании</h2>
              <Chip tone="green" dot>{active.length}</Chip>
            </div>
            {active.length === 0 ? (
              <p className="px-6 py-6 text-[14px] text-ink-3">Нет активных кампаний.</p>
            ) : (
              <div className="scroll-thin mt-4 overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-[13.5px]">
                  <thead>
                    <tr className="border-b border-line">
                      {["Пользователь", "План", "День", "Отправлено", "Интервью", "Ждут подтверждения", "Последний цикл", ""].map((c, i) => <th key={i} scope="col" className="label px-4 py-2.5 !text-[10px] font-normal first:pl-6">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {active.map((c) => {
                      const day = c.startedAt ? Math.min(60, Math.max(1, Math.ceil((now - c.startedAt.getTime()) / DAY))) : 0;
                      const submitted = c.opportunities.filter((o) => o.submittedAt).length;
                      const ivs = c.opportunities.reduce((a, o) => a + o.interviews.length, 0);
                      const pending = pendingByUser[c.userId] ?? 0;
                      const stale = !c.lastRunAt || now - c.lastRunAt.getTime() > DAY;
                      return (
                        <tr key={c.id} className="hover:bg-white/50">
                          <th scope="row" className="px-4 py-3 pl-6 font-normal">
                            <span className="block font-medium text-head">{c.user.name}</span>
                            <span className="text-[12px] text-ink-4">{maskEmail(c.user.email)}</span>
                          </th>
                          <td className="px-4 py-3"><Chip tone={c.plan === "international" ? "dark" : "teal"}>{c.plan}</Chip>{c.status === "paused" && <Chip tone="amber" className="ml-1">paused</Chip>}</td>
                          <td className="num px-4 py-3">{day}<span className="text-ink-4">/60</span></td>
                          <td className="num px-4 py-3">{submitted}</td>
                          <td className="num px-4 py-3">{ivs}</td>
                          <td className={cx("num px-4 py-3", pending > 0 && "text-amber")}>{pending}</td>
                          <td className={cx("px-4 py-3 text-[12.5px]", stale ? "text-rose" : "text-ink-3")}>{since(c.lastRunAt, now)}</td>
                          <td className="px-4 py-3 pr-6 text-right">
                            <form action={adminRunTick}>
                              <input type="hidden" name="campaignId" value={c.id} />
                              <SubmitButton size="sm" variant="glass" pendingText="Цикл…" disabled={c.status !== "active"} aria-label={`Запустить цикл агента для ${c.user.name}`}>
                                <Play className="size-3.5" strokeWidth={1.7} />Run tick
                              </SubmitButton>
                            </form>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Exception queue */}
          <section aria-labelledby="exc-h">
            <Card className="h-full">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 id="exc-h" className="h-serif text-[22px]">Очередь исключений</h2>
                <Chip tone={approvals.length ? "amber" : "green"}>{approvals.length} pending</Chip>
              </div>
              {approvals.length === 0 ? (
                <p className="text-[14px] text-ink-3">Все исключения обработаны.</p>
              ) : (
                <ul className="scroll-thin flex max-h-[420px] flex-col divide-y divide-line overflow-auto pr-1">
                  {approvals.map((a) => (
                    <li key={a.id} className="flex flex-col gap-1 py-3 first:pt-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip tone={a.kind === "legal" || a.kind === "truth" ? "rose" : a.kind === "sensitive" ? "amber" : "neutral"}>{a.kind}</Chip>
                        <span className="text-[12px] text-ink-4">{maskEmail(a.user.email)}{a.opportunity?.job.company ? ` · ${a.opportunity.job.company}` : ""} · {since(a.createdAt, now)}</span>
                      </div>
                      <p className="text-[13.5px] text-ink-2">{a.question}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 flex gap-2 text-[12px] text-ink-4"><ShieldAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} />Показаны только тип и вопрос. Предложенные и данные ответы пользователей скрыты.</p>
            </Card>
          </section>

          {/* CV quality */}
          <section aria-labelledby="cv-h">
            <Card className="h-full">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 id="cv-h" className="h-serif text-[22px]">CV quality · выборка</h2>
                <Chip>{cvSample.length} из {pkgPool.length}</Chip>
              </div>
              {cvSample.length === 0 ? (
                <p className="text-[14px] text-ink-3">Нет пакетов с замечаниями Truth Check. Отлично.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {cvSample.map((p) => (
                    <li key={p.id} className="rounded-2xl border border-line bg-white/55 p-3.5">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-medium text-head">{p.opportunity.job.company}</span>
                        <span className="text-[12.5px] text-ink-3">{p.opportunity.job.title}</span>
                        <span className="flex-1" />
                        <Chip tone="dark">{p.cvVersion}</Chip>
                        <Chip tone={p.generatedBy === "claude" ? "green" : "teal"}>{p.generatedBy}</Chip>
                      </div>
                      <ul className="flex flex-col gap-1">
                        {p.issues.map((t, i) => (
                          <li key={i} className="flex gap-2 text-[13px] text-ink-2">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber" strokeWidth={1.8} />
                            <span>{t.claim}{t.note && <span className="text-ink-4"> — {t.note}</span>}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-[12px] text-ink-4">Случайные 5 пакетов с замечаниями Truth Check — при каждой загрузке страницы новая выборка.</p>
            </Card>
          </section>
        </div>

        {/* Jobs ingestion */}
        <section aria-labelledby="jobs-h">
          <Card>
            <h2 id="jobs-h" className="h-serif mb-5 text-[22px]">Загрузка вакансий</h2>
            <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <Label className="mb-3">По источникам</Label>
                {bySource.length === 0 ? (
                  <p className="text-[14px] text-ink-3">Вакансий пока нет.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {bySource.map((s) => (
                      <li key={s.source} className="grid grid-cols-[96px_1fr_auto] items-center gap-3">
                        <span className="truncate font-mono text-[12px] text-head">{s.source}</span>
                        <span className="flex h-2 overflow-hidden rounded-full bg-head/8" aria-hidden>
                          <span className="bg-green" style={{ width: `${(s.active / maxJobs) * 100}%` }} />
                          <span className="bg-ink-4/40" style={{ width: `${(s.retired / maxJobs) * 100}%` }} />
                        </span>
                        <span className="num text-[13px] text-ink-2">{s.active}<span className="text-ink-4"> / {s.retired} архив</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <IngestPanel />
            </div>
          </Card>
        </section>

        {/* Incidents */}
        <section aria-labelledby="inc-h">
          <Card>
            <h2 id="inc-h" className="h-serif mb-4 text-[22px]">Инциденты</h2>
            <ul className="flex flex-col divide-y divide-line">
              {INCIDENTS.map((i) => (
                <li key={i.title} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-5">
                  <span className="label w-16 shrink-0 pt-0.5">{i.date}</span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-medium text-head">{i.title}</span>
                      <Chip tone={i.sev === "medium" ? "amber" : "neutral"}>{i.sev}</Chip>
                      <Chip tone="green">resolved</Chip>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-3">{i.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      </div>
    </>
  );
}
