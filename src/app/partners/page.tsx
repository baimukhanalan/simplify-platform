import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck, Users, Info } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Chip, Empty, Label, PageHeader, Script, Stat, cx } from "@/components/ui";
import { fmtKzt } from "@/lib/engine/taxonomy";
import { CopyButton } from "../app/interviews/_components/copy-button";

export const metadata = { title: "Partners" };

/** Outcomes are only shown once a cohort is large enough that no individual can be singled out. */
const K_ANON = 3;

async function partnerStats(code: string) {
  const [signups, pays, campaigns] = await Promise.all([
    db.user.findMany({ where: { referredByCode: code }, select: { createdAt: true } }),
    db.payment.findMany({ where: { partnerCode: code, status: "paid" }, select: { amount: true, partnerCut: true, createdAt: true, campaignId: true } }),
    db.campaign.findMany({
      where: { user: { referredByCode: code }, status: { not: "draft" } },
      select: { status: true, _count: { select: { opportunities: { where: { interviews: { some: { round: { not: "assessment" } } } } } } } },
    }),
  ]);
  const revenue = pays.reduce((a, p) => a + p.amount, 0);
  const share = pays.reduce((a, p) => a + p.partnerCut, 0);
  return {
    signups: signups.length,
    signupDates: signups.map((s) => s.createdAt),
    paid: new Set(pays.map((p) => p.campaignId ?? p.createdAt.toISOString())).size,
    payDates: pays.map((p) => p.createdAt),
    revenue,
    share,
    campaigns: campaigns.length,
    withInterview: campaigns.filter((c) => c._count.opportunities > 0).length,
    hired: campaigns.filter((c) => c.status === "hired").length,
  };
}

function months(dates: Date[], n = 6) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const count = dates.filter((x) => x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth()).length;
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString("ru-RU", { month: "short" }), count };
  });
}

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const [user, sp, h] = await Promise.all([requireUser(), searchParams, headers()]);
  if (user.role !== "partner" && user.role !== "admin") redirect("/app");
  const isAdmin = user.role === "admin";
  const partners = isAdmin ? await db.partner.findMany({ orderBy: { createdAt: "asc" } }) : [];
  const partner = isAdmin ? partners.find((p) => p.code === sp.code?.toUpperCase()) ?? partners[0] ?? null : await db.partner.findUnique({ where: { userId: user.id } });

  if (!partner)
    return (
      <>
        <PageHeader eyebrow="Partners" title={<>Партнёрский <Script>кабинет</Script></>} />
        <Empty title="Партнёрский профиль не привязан" sub="Напишите команде Simplify — мы привяжем ваш аккаунт к партнёрскому коду." />
      </>
    );

  const stats = await partnerStats(partner.code);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const link = `${proto}://${host}/login?mode=signup&ref=${encodeURIComponent(partner.code)}`;
  const conv = stats.signups ? Math.round((stats.paid / stats.signups) * 100) : 0;
  const signupSeries = months(stats.signupDates);
  const paySeries = months(stats.payDates);
  const maxBar = Math.max(1, ...signupSeries.map((m) => m.count), ...paySeries.map((m) => m.count));
  const allStats = isAdmin ? await Promise.all(partners.map(async (p) => ({ p, s: await partnerStats(p.code) }))) : [];

  return (
    <>
      <PageHeader
        eyebrow={`Distribution partner · ${partner.code}`}
        title={<>{partner.name} <Script>partners</Script></>}
        sub={`B2C revenue share: ${Math.round(partner.revShare * 100)}% партнёру, ${100 - Math.round(partner.revShare * 100)}% Simplify — с каждой оплаченной Career Campaign по вашему коду.`}
      />

      <div className="flex flex-col gap-6">
        <Card strong className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <Label className="mb-2">Реферальная ссылка</Label>
            <code className="block truncate rounded-xl border border-line bg-white/70 px-3.5 py-2.5 font-mono text-[13px] text-head" title={link}>{link}</code>
            <p className="mt-2 text-[12.5px] text-ink-3">Код <span className="font-mono text-head">{partner.code}</span> также можно ввести при оплате кампании.</p>
          </div>
          <CopyButton text={link} label="Копировать ссылку" className="self-start lg:self-center" />
        </Card>

        <section aria-label="Ключевые показатели" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Card><Stat label="Аудитория" value={partner.audience.toLocaleString("ru-RU")} hint="охват партнёра, не пользователи Simplify" /></Card>
          <Card><Stat label="Регистрации" value={stats.signups} hint="по вашему коду" /></Card>
          <Card><Stat label="Оплаченные кампании" value={stats.paid} hint={`конверсия ${conv}%`} /></Card>
          <Card><Stat label="Выручка" value={<span className="text-[26px]">{fmtKzt(stats.revenue)}</span>} hint="gross, оплачено" /></Card>
          <Card className="col-span-2 lg:col-span-1"><Stat label="Ваша доля" value={<span className="text-[26px]">{fmtKzt(stats.share)}</span>} tone="green" hint={`${Math.round(partner.revShare * 100)}% от выручки`} /></Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <Label>Последние 6 месяцев</Label>
              <div className="flex gap-3 text-[12px] text-ink-3">
                <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-teal/45" />Регистрации</span>
                <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-green" />Оплаты</span>
              </div>
            </div>
            <div role="img" aria-label={signupSeries.map((m, i) => `${m.label}: ${m.count} регистраций, ${paySeries[i].count} оплат`).join("; ")} className="flex h-40 items-end gap-2 sm:gap-4">
              {signupSeries.map((m, i) => (
                <div key={m.key} className="flex h-full flex-1 flex-col items-center gap-2">
                  <div className="flex w-full flex-1 items-end justify-center gap-1">
                    <div className="w-full max-w-5 rounded-t-md bg-teal/45" style={{ height: `${(m.count / maxBar) * 100}%`, minHeight: m.count ? 4 : 0 }} />
                    <div className="w-full max-w-5 rounded-t-md bg-green" style={{ height: `${(paySeries[i].count / maxBar) * 100}%`, minHeight: paySeries[i].count ? 4 : 0 }} />
                  </div>
                  <span className="label !text-[9.5px]">{m.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-4 text-green" strokeWidth={1.7} /><Label>Результаты приведённых пользователей</Label></div>
            {stats.campaigns >= K_ANON ? (
              <dl className="grid grid-cols-3 gap-3">
                <div><dt className="label !text-[10px]">Кампании</dt><dd className="num mt-1 text-[28px] leading-none text-head">{stats.campaigns}</dd></div>
                <div><dt className="label !text-[10px]">С интервью</dt><dd className="num mt-1 text-[28px] leading-none text-head">{stats.withInterview}</dd><dd className="text-[12px] text-ink-3">{Math.round((stats.withInterview / stats.campaigns) * 100)}%</dd></div>
                <div><dt className="label !text-[10px]">Hired</dt><dd className="num mt-1 text-[28px] leading-none text-green">{stats.hired}</dd></div>
              </dl>
            ) : (
              <p className="flex gap-2 text-[14px] text-ink-2">
                <Users className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} />
                Показываем результаты, когда наберётся не меньше {K_ANON} кампаний — так ни одного пользователя нельзя узнать по цифрам. Сейчас: {stats.campaigns}.
              </p>
            )}
            <p className="mt-4 flex gap-2 text-[12px] text-ink-4">
              <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} />
              Только агрегаты. Имена, email, CV и переписка приведённых пользователей партнёру недоступны.
            </p>
          </Card>
        </div>

        {isAdmin && (
          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
              <Label>Все партнёры · admin</Label>
              <Chip tone="dark">{partners.length}</Chip>
            </div>
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line">
                    {["Партнёр", "Код", "Аудитория", "Регистрации", "Оплаты", "Выручка", "Выплата партнёру"].map((c) => <th key={c} scope="col" className="label px-5 py-2.5 !text-[10px] font-normal first:pl-6">{c}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {allStats.map(({ p, s }) => (
                    <tr key={p.id} className={cx("transition-colors hover:bg-white/50", p.id === partner.id && "bg-green-soft/50")}>
                      <th scope="row" className="px-5 py-3 pl-6 font-medium text-head">
                        <Link href={`/partners?code=${p.code}`} aria-current={p.id === partner.id ? "true" : undefined} className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">{p.name}</Link>
                      </th>
                      <td className="px-5 py-3 font-mono text-[12px]">{p.code}</td>
                      <td className="num px-5 py-3">{p.audience.toLocaleString("ru-RU")}</td>
                      <td className="num px-5 py-3">{s.signups}</td>
                      <td className="num px-5 py-3">{s.paid}</td>
                      <td className="num px-5 py-3">{fmtKzt(s.revenue)}</td>
                      <td className="num px-5 py-3 text-green">{fmtKzt(s.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
