import { Lightbulb, Quote } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { currentCampaign } from "@/lib/ops-data";
import { freshnessBucket, reachedInterview, segmentLabel, segmentStats, strategyView, type OppLite, type SegmentStat } from "@/lib/engine/insights";
import { REGIONS } from "@/lib/engine/taxonomy";
import { pctLabel } from "@/lib/ops";
import { getT } from "@/lib/i18n/server";
import type { T } from "@/lib/i18n/translator";
import { regionName } from "@/lib/i18n/labels";
import { ButtonLink, Card, Chip, Empty, Label, PageHeader, Script, Stat, cx } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getT())("insightsPage.metaTitle") };
}

const VERDICT_TONE: Record<SegmentStat["verdict"], "green" | "teal" | "amber" | "rose" | "neutral"> = {
  scale: "green",
  keep: "teal",
  reduce: "amber",
  stop: "rose",
  learning: "neutral",
};
/** «×1,14» (ru, kk) / «×1.14» (en). */
const weightLabel = (t: T, w: number) => `×${t.num(w, 2)}`;

const LANES = ["standard", "target", "mass"] as const;
const laneLabel = (t: T, k: string) => ((LANES as readonly string[]).includes(k) ? t(`insightsPage.lane.${k as (typeof LANES)[number]}`) : k);

function geoKey(o: OppLite) {
  if (o.job.remote === "remote") return "remote";
  return j<string[]>(o.job.countries, [])[0] ?? "—";
}
function geoLabel(t: T, k: string) {
  if (k === "remote") return t("insightsPage.geo.remote");
  const region = Object.entries(REGIONS).find(([key, r]) => key !== "WORLD" && r.countries.includes(k));
  return region ? `${k} · ${regionName(t, region[0])}` : k;
}
const matchBand = (o: OppLite) => (o.match >= 80 ? "80–100" : o.match >= 65 ? "65–79" : o.match >= 50 ? "50–64" : "< 50");
const cvVariant = (o: OppLite) => {
  const v = o.pkg?.cvVersion;
  if (!v) return "без пакета";
  const variant = v.split("-").slice(1).join("-");
  return variant || "базовая";
};
// freshnessBucket (engine) keys, in order, → insightsPage.fresh.* labels.
const FRESH_ORDER = ["< 24 ч", "1–3 дня", "3–7 дней", "> 7 дней", "—"];
const FRESH_KEY: Record<string, "lt24h" | "d1to3" | "d3to7" | "gt7"> = { "< 24 ч": "lt24h", "1–3 дня": "d1to3", "3–7 дней": "d3to7", "> 7 дней": "gt7" };
const freshLabel = (t: T, k: string) => (FRESH_KEY[k] ? t(`insightsPage.fresh.${FRESH_KEY[k]}`) : k);
const BAND_ORDER = ["80–100", "65–79", "50–64", "< 50"];

export default async function InsightsPage() {
  const user = await requireUser();
  const [campaign, t] = await Promise.all([currentCampaign(user.id), getT()]);
  // Engine-written summary lines stay Russian: mark them for other page languages.
  const engine = t.locale === "ru" ? undefined : "ru";
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow={t("insightsPage.empty.eyebrow")} title={t("insightsPage.empty.title")} />
        <Empty title={t("insightsPage.empty.emptyTitle")} sub={t("insightsPage.empty.emptySub")} action={<ButtonLink href="/app/campaign">{t("insightsPage.empty.start")}</ButtonLink>} />
      </>
    );
  }

  const raw = await db.opportunity.findMany({
    where: { campaignId: campaign.id },
    select: { status: true, segment: true, lane: true, submittedAt: true, match: true, job: { select: { remote: true, countries: true, postedAt: true, seniority: true } }, pkg: { select: { cvVersion: true } }, interviews: { select: { round: true } } },
  });
  const opps: OppLite[] = raw.map((o) => ({
    ...o,
    reachedInterview: reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length),
    reachedAssessment: o.status === "assessment" || o.interviews.some((i) => i.round === "assessment"),
  }));
  const applied = opps.filter((o) => o.submittedAt);
  const allocation = j<Record<string, number>>(campaign.allocation, {});

  const byGeo = segmentStats(opps, geoKey, (k) => geoLabel(t, k));
  // Weights, verdicts and the summary from one source (lib strategyView), so the table, the bars and the lines agree.
  const view = strategyView(opps, allocation, byGeo);
  const bySegment = view.rows;
  const byLane = segmentStats(opps, (o) => o.lane, (k) => laneLabel(t, k));
  const byCv = segmentStats(opps, cvVariant, (k) => (k === "без пакета" ? t("insightsPage.cv.noPackage") : k === "базовая" ? t("insightsPage.cv.base") : t("insightsPage.cv.variant", { name: segmentLabel(k) })));
  const byFresh = segmentStats(opps, freshnessBucket, (k) => freshLabel(t, k)).sort((a, b) => FRESH_ORDER.indexOf(a.key) - FRESH_ORDER.indexOf(b.key));
  const byBand = segmentStats(opps, matchBand).sort((a, b) => BAND_ORDER.indexOf(a.key) - BAND_ORDER.indexOf(b.key));
  const recs = view.summary;
  const updating = view.rows.some((r) => r.updating);

  const interviews = applied.filter((o) => o.reachedInterview).length;
  const assessments = applied.filter((o) => o.reachedAssessment).length;
  const responses = applied.filter((o) => !["submitted", "pending"].includes(o.status)).length;
  const alloc = view.enoughData ? view.rows.map((r) => [r.key, r.weight] as const).filter(([, w]) => w !== 1).sort((a, b) => b[1] - a[1]) : [];
  const maxW = Math.max(2.2, ...alloc.map(([, w]) => w));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PageHeader
        eyebrow={t("insightsPage.eyebrow")}
        title={t.rich("insightsPage.title", {}, { s: (x) => <Script>{x}</Script> })}
        sub={t("insightsPage.sub")}
      />

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
        <Card className="min-w-0 !p-5"><Stat label={t("insightsPage.stats.sent")} value={applied.length} hint={t("insightsPage.stats.sentHint", { n: applied.length })} /></Card>
        <Card className="min-w-0 !p-5"><Stat label={t("insightsPage.stats.responseRate")} value={pctLabel(responses, applied.length)} hint={t("insightsPage.stats.responsesHint", { n: responses })} /></Card>
        <Card className="min-w-0 !p-5"><Stat label={t("insightsPage.stats.toAssessments")} value={pctLabel(assessments, applied.length)} hint={t("insightsPage.stats.assessmentsHint", { n: assessments })} /></Card>
        <Card className="min-w-0 !p-5"><Stat label={t("insightsPage.stats.toInterviews")} value={pctLabel(interviews, applied.length)} hint={t("insightsPage.stats.interviewsHint", { n: interviews })} tone="green" /></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card strong className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2"><Lightbulb className="size-4 text-green" strokeWidth={1.7} aria-hidden /><Label>{t("insightsPage.conclusions")}</Label></div>
          <ul lang={engine} className="flex flex-col gap-3">
            {recs.map((r) => (
              <li key={r} className="border-l-2 border-green/40 pl-4 text-[15px] leading-relaxed text-ink">{r}</li>
            ))}
          </ul>
        </Card>
        <Card className="flex min-w-0 flex-col gap-4 bg-cta/[.03]">
          <Quote className="size-5 text-teal" strokeWidth={1.5} aria-hidden />
          <p className="h-serif text-[22px] leading-snug">{t("insightsPage.quote")}</p>
          <p className="text-[13.5px] text-ink-3">{t("insightsPage.quoteSub")}</p>
        </Card>
      </div>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><Label>{t("insightsPage.roles.label")}</Label><h2 className="h-serif mt-2 text-[22px]">{t("insightsPage.roles.title")}</h2></div>
          <p className="max-w-md text-[12.5px] text-ink-3">{t("insightsPage.roles.explain")}</p>
        </div>
        <StatsTable t={t} rows={bySegment} verdict />
        {updating && <p className="text-[12px] text-ink-3">{t("insightsPage.roles.updating")}</p>}
      </Card>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><Label>{t("insightsPage.alloc.label")}</Label><h2 className="h-serif mt-2 text-[22px]">{t("insightsPage.alloc.title")}</h2></div>
          <span className="text-[12.5px] text-ink-3">{t("insightsPage.alloc.sub")}</span>
        </div>
        {alloc.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">{t("insightsPage.alloc.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {alloc.map(([k, w]) => (
              <li key={k} className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_48px] items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_56px]">
                <span className="truncate text-[13.5px] text-head">{segmentLabel(k)}</span>
                <div className="relative h-3 rounded-full bg-head/[.06]" aria-hidden>
                  <div className={cx("h-full rounded-full", w >= 1.3 ? "bg-green" : w <= 0.7 ? "bg-amber" : "bg-teal")} style={{ width: `${(w / maxW) * 100}%` }} />
                  <span className="absolute inset-y-[-3px] w-px bg-head/40" style={{ left: `${(1 / maxW) * 100}%` }} title={t("insightsPage.alloc.avgTitle")} />
                </div>
                <span className="num text-right text-[14px] text-head">{weightLabel(t, w)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-ink-3">{t("insightsPage.alloc.note")}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Breakdown t={t} title={t("insightsPage.breakdowns.geoTitle")} sub={t("insightsPage.breakdowns.geoSub")} rows={byGeo} />
        <Breakdown t={t} title={t("insightsPage.breakdowns.laneTitle")} sub={t("insightsPage.breakdowns.laneSub")} rows={byLane} />
        <Breakdown t={t} title={t("insightsPage.breakdowns.cvTitle")} sub={t("insightsPage.breakdowns.cvSub")} rows={byCv} />
        <Breakdown t={t} title={t("insightsPage.breakdowns.freshTitle")} sub={t("insightsPage.breakdowns.freshSub")} rows={byFresh} />
        <Breakdown t={t} title={t("insightsPage.breakdowns.bandTitle")} sub={t("insightsPage.breakdowns.bandSub")} rows={byBand} />
      </div>
    </div>
  );
}

function RateBar({ rate }: { rate: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-head/10" aria-hidden><span className="block h-full rounded-full bg-green" style={{ width: `${Math.min(100, rate * 100 * 2)}%` }} /></span>
      <span className="num">{Math.round(rate * 100)}%</span>
    </span>
  );
}

function StatsTable({ t, rows, weight, verdict }: { t: T; rows: SegmentStat[]; weight?: (k: string) => number | undefined; verdict?: boolean }) {
  if (!rows.length) return <p className="text-[13.5px] text-ink-3">{t("insightsPage.table.empty")}</p>;
  return (
    <div className="scroll-thin -mx-1 overflow-x-auto px-1" role="region" aria-label={t("insightsPage.table.aria")} tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
        <thead>
          <tr className="text-left">
            {(["segment", "applied", "responses", "assessments", "interviews", "offers", "conversion", "weight", ...(verdict ? (["verdict"] as const) : [])] as const).map((k) => t(`insightsPage.table.${k}`)).map((h, i) => (
              <th key={h} scope="col" className={cx("label border-b border-line pb-2.5 !text-[11px] font-normal", i > 0 && "text-right", i === 0 && "pr-4")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const w = weight?.(r.key) ?? r.weight;
            return (
              <tr key={r.key} className="border-b border-line/60 last:border-0">
                <th scope="row" className="py-2.5 pr-4 text-left font-normal text-head">{r.label}</th>
                <td className="num py-2.5 text-right">{r.applied}</td>
                <td className="num py-2.5 text-right">{r.responses}</td>
                <td className="num py-2.5 text-right">{r.assessments}</td>
                <td className="num py-2.5 text-right text-green">{r.interviews}</td>
                <td className="num py-2.5 text-right">{r.offers}</td>
                <td className="py-2.5 text-right"><span className="inline-flex justify-end"><RateBar rate={r.rate} /></span></td>
                <td className="num py-2.5 text-right">{weightLabel(t, w)}</td>
                {verdict && <td className="py-2.5 text-right"><Chip tone={VERDICT_TONE[r.verdict]}>{t(`insightsPage.verdict.${r.verdict}`)}</Chip></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ t, title, sub, rows }: { t: T; title: string; sub: string; rows: SegmentStat[] }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div><Label>{title}</Label><p className="mt-1.5 text-[12.5px] text-ink-3">{sub}</p></div>
      {rows.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">{t("insightsPage.table.noData")}</p>
      ) : (
        <div className="scroll-thin overflow-x-auto" role="region" aria-label={title} tabIndex={0}>
          <table className="w-full min-w-[380px] border-collapse text-[13px]">
            <thead>
              <tr>
                {[title, t("insightsPage.table.applied"), t("insightsPage.table.assessments"), t("insightsPage.table.interviews"), t("insightsPage.table.conversion")].map((h, i) => (
                  <th key={h} scope="col" className={cx("label border-b border-line pb-2 !text-[11px] font-normal", i === 0 ? "text-left" : "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="max-w-[180px] truncate py-2 pr-3 text-left font-normal text-head">{r.label}</th>
                  <td className="num py-2 text-right">{r.applied}</td>
                  <td className="num py-2 text-right text-amber">{r.assessments}</td>
                  <td className="num py-2 text-right text-green">{r.interviews}</td>
                  <td className="py-2 text-right"><span className="inline-flex justify-end"><RateBar rate={r.rate} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
