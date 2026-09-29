import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldCheck, Users, Info } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Chip, Empty, Label, PageHeader, Script, Stat, cx } from "@/components/ui";
import { activationBlocked, countsAsRevenue, type PaymentMeta } from "@/lib/payments/kaspi";
import { j } from "@/lib/db";
import { CopyButton } from "../app/interviews/_components/copy-button";
import { SUPPORT_EMAIL } from "../_components/legal-page";
import { getT } from "@/lib/i18n/server";
import { INTL_TAG, TIME_ZONE, type Locale } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("partnersPage.meta") };
}

/** Outcomes are only shown once a cohort is large enough that no individual can be singled out. */
const K_ANON = 3;

async function partnerStats(code: string) {
  const [signups, pays, campaigns] = await Promise.all([
    db.user.findMany({ where: { referredByCode: code }, select: { createdAt: true } }),
    db.payment.findMany({ where: { partnerCode: code, status: "paid" }, select: { amount: true, partnerCut: true, createdAt: true, campaignId: true, provider: true, status: true, meta: true } }),
    db.campaign.findMany({
      where: { user: { referredByCode: code }, status: { not: "draft" } },
      select: { status: true, _count: { select: { opportunities: { where: { interviews: { some: { round: { not: "assessment" } } } } } } } },
    }),
  ]);
  // Conversions keep attribution analytics (test-gateway included) but not payments refunded in full;
  // money (revenue, share) counts only real, kept payments.
  const converted = pays.filter((p) => !activationBlocked(j<PaymentMeta>(p.meta, {})));
  const real = pays.filter(countsAsRevenue);
  const revenue = real.reduce((a, p) => a + p.amount, 0);
  const share = real.reduce((a, p) => a + p.partnerCut, 0);
  return {
    signups: signups.length,
    signupDates: signups.map((s) => s.createdAt),
    paid: new Set(converted.map((p) => p.campaignId ?? p.createdAt.toISOString())).size,
    payDates: converted.map((p) => p.createdAt),
    revenue,
    share,
    campaigns: campaigns.length,
    withInterview: campaigns.filter((c) => c._count.opportunities > 0).length,
    hired: campaigns.filter((c) => c.status === "hired").length,
  };
}

function months(locale: Locale, dates: Date[], n = 6) {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat(INTL_TAG[locale], { timeZone: TIME_ZONE, month: "short" });
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const count = dates.filter((x) => x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth()).length;
    return { key: `${d.getFullYear()}-${d.getMonth()}`, label: fmt.format(d), count };
  });
}

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const [user, sp, h, t] = await Promise.all([requireUser(), searchParams, headers(), getT()]);
  if (user.role !== "partner" && user.role !== "admin") redirect("/app");
  const isAdmin = user.role === "admin";
  const partners = isAdmin ? await db.partner.findMany({ orderBy: { createdAt: "asc" } }) : [];
  const partner = isAdmin ? partners.find((p) => p.code === sp.code?.toUpperCase()) ?? partners[0] ?? null : await db.partner.findUnique({ where: { userId: user.id } });

  if (!partner)
    return (
      <>
        <PageHeader eyebrow={t("partnersPage.chip")} title={t.rich("partnersPage.title", {}, { s: (c) => <Script>{c}</Script> })} />
        <Empty title={t("partnersPage.noProfile")} sub={t("partnersPage.noProfileSub", { email: SUPPORT_EMAIL })} />
      </>
    );

  const stats = await partnerStats(partner.code);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const link = `${proto}://${host}/login?mode=signup&ref=${encodeURIComponent(partner.code)}`;
  const conv = stats.signups ? Math.round((stats.paid / stats.signups) * 100) : 0;
  const signupSeries = months(t.locale, stats.signupDates);
  const paySeries = months(t.locale, stats.payDates);
  const pct = Math.round(partner.revShare * 100);
  const maxBar = Math.max(1, ...signupSeries.map((m) => m.count), ...paySeries.map((m) => m.count));
  const allStats = isAdmin ? await Promise.all(partners.map(async (p) => ({ p, s: await partnerStats(p.code) }))) : [];

  return (
    <>
      <PageHeader
        eyebrow={t("partnersPage.eyebrow", { code: partner.code })}
        title={t.rich("partnersPage.nameTitle", { name: partner.name }, { s: (c) => <Script>{c}</Script> })}
        sub={t("partnersPage.sub", { partner: pct, simplify: 100 - pct })}
      />

      <div className="flex flex-col gap-6">
        <Card strong className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <Label className="mb-2">{t("partnersPage.refLink")}</Label>
            <code className="block truncate rounded-xl border border-line bg-white/70 px-3.5 py-2.5 font-mono text-[13px] text-head" title={link}>{link}</code>
            <p className="mt-2 text-[12.5px] text-ink-3">{t.rich("partnersPage.codeNote", { code: partner.code }, { c: (c) => <span className="font-mono text-head">{c}</span> })}</p>
          </div>
          <CopyButton labels={{ copied: t("interviewsPage.copy.copied"), failed: t("interviewsPage.copy.failed") }} text={link} label={t("partnersPage.copyLink")} className="self-start lg:self-center" />
        </Card>

        <section aria-label={t("partnersPage.kpiAria")} className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Card><Stat label={t("partnersPage.audience")} value={t.num(partner.audience, 0)} hint={t("partnersPage.audienceHint")} /></Card>
          <Card><Stat label={t("partnersPage.signups")} value={stats.signups} hint={t("partnersPage.signupsHint")} /></Card>
          <Card><Stat label={t("partnersPage.paidCampaigns")} value={stats.paid} hint={t("partnersPage.conversion", { n: conv })} /></Card>
          <Card><Stat label={t("partnersPage.revenue")} value={<span className="text-[26px]">{t.money(stats.revenue)}</span>} hint={t("partnersPage.revenueHint")} /></Card>
          <Card className="col-span-2 lg:col-span-1"><Stat label={t("partnersPage.share")} value={<span className="text-[26px]">{t.money(stats.share)}</span>} tone="green" hint={t("partnersPage.shareHint", { n: pct })} /></Card>
        </section>

        <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
          <Card>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
              <Label>{t("partnersPage.last6")}</Label>
              <div className="flex flex-wrap gap-3 text-[12px] text-ink-3">
                <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-teal/45" />{t("partnersPage.legendSignups")}</span>
                <span className="flex items-center gap-1.5"><span aria-hidden className="size-2 rounded-sm bg-green" />{t("partnersPage.legendPayments")}</span>
              </div>
            </div>
            <div role="img" aria-label={signupSeries.map((m, i) => t("partnersPage.chartBar", { month: m.label, s: m.count, p: paySeries[i].count })).join("; ")} className="flex h-40 items-end gap-2 sm:gap-4">
              {signupSeries.map((m, i) => (
                <div key={m.key} className="flex h-full flex-1 flex-col items-center gap-2">
                  <div className="flex w-full flex-1 items-end justify-center gap-1">
                    <div className="w-full max-w-5 rounded-t-md bg-teal/45" style={{ height: `${(m.count / maxBar) * 100}%`, minHeight: m.count ? 4 : 0 }} />
                    <div className="w-full max-w-5 rounded-t-md bg-green" style={{ height: `${(paySeries[i].count / maxBar) * 100}%`, minHeight: paySeries[i].count ? 4 : 0 }} />
                  </div>
                  <span className="label !text-[11px]">{m.label}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="mb-4 flex items-center gap-2"><ShieldCheck className="size-4 shrink-0 text-green" strokeWidth={1.7} aria-hidden /><Label>{t("partnersPage.outcomes")}</Label></div>
            {stats.campaigns >= K_ANON ? (
              <dl className="grid grid-cols-3 gap-3">
                <div><dt className="label !text-[11px]">{t("partnersPage.campaigns")}</dt><dd className="num mt-1 text-[28px] leading-none text-head">{stats.campaigns}</dd></div>
                <div><dt className="label !text-[11px]">{t("partnersPage.withInterview")}</dt><dd className="num mt-1 text-[28px] leading-none text-head">{stats.withInterview}</dd><dd className="text-[12px] text-ink-3">{Math.round((stats.withInterview / stats.campaigns) * 100)}%</dd></div>
                <div><dt className="label !text-[11px]">{t("partnersPage.withOffer")}</dt><dd className="num mt-1 text-[28px] leading-none text-green">{stats.hired}</dd></div>
              </dl>
            ) : (
              <p className="flex gap-2 text-[14px] text-ink-2">
                <Users className="mt-0.5 size-4 shrink-0 text-teal" strokeWidth={1.7} aria-hidden />
                <span>{t("partnersPage.kAnon", { k: K_ANON, n: stats.campaigns })}</span>
              </p>
            )}
            <p className="mt-4 flex gap-2 text-[12px] text-ink-3">
              <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.7} aria-hidden />
              <span>{t("partnersPage.aggregatesOnly")}</span>
            </p>
          </Card>
        </div>

        {isAdmin && (
          <Card className="!p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5 sm:px-6">
              <Label>{t("partnersPage.allPartners")}</Label>
              <Chip tone="dark">{partners.length}</Chip>
            </div>
            <div className="scroll-thin mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line">
                    {(["partner", "code", "audience", "signups", "payments", "revenue", "payout"] as const).map((c) => <th key={c} scope="col" className="label px-5 py-2.5 !text-[11px] font-normal first:pl-6">{t(`partnersPage.col.${c}`)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {allStats.map(({ p, s }) => (
                    <tr key={p.id} className={cx("transition-colors hover:bg-white/50", p.id === partner.id && "bg-green-soft/50")}>
                      <th scope="row" className="px-5 py-3 pl-6 font-medium text-head">
                        <Link href={`/partners?code=${p.code}`} aria-current={p.id === partner.id ? "true" : undefined} className="underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-green">{p.name}</Link>
                      </th>
                      <td className="px-5 py-3 font-mono text-[12px]">{p.code}</td>
                      <td className="num px-5 py-3">{t.num(p.audience, 0)}</td>
                      <td className="num px-5 py-3">{s.signups}</td>
                      <td className="num px-5 py-3">{s.paid}</td>
                      <td className="num px-5 py-3">{t.money(s.revenue)}</td>
                      <td className="num px-5 py-3 text-green">{t.money(s.share)}</td>
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
