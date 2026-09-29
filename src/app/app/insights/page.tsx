import { Lightbulb, Quote } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db, j } from "@/lib/db";
import { currentCampaign } from "@/lib/ops-data";
import { freshnessBucket, reachedInterview, segmentLabel, segmentStats, strategyView, type OppLite, type SegmentStat } from "@/lib/engine/insights";
import { REGIONS } from "@/lib/engine/taxonomy";
import { LANE, pctLabel } from "@/lib/ops";
import { ButtonLink, Card, Chip, Empty, Label, PageHeader, Script, Stat, cx } from "@/components/ui";
import { WORK_MODE_RU, count, plural } from "../../_components/ru";
import { fmtNum } from "@/lib/ru";

export const metadata = { title: "Стратегия" };

const VERDICT: Record<SegmentStat["verdict"], { label: string; tone: "green" | "teal" | "amber" | "rose" | "neutral" }> = {
  scale: { label: "Усилить", tone: "green" },
  keep: { label: "Оставить", tone: "teal" },
  reduce: { label: "Сократить", tone: "amber" },
  stop: { label: "Стоп", tone: "rose" },
  learning: { label: "Мало данных", tone: "neutral" },
};
/** «×1,14» — Russian decimal comma. */
const weightLabel = (w: number) => `×${fmtNum(w, 2)}`;

const LANE_LABEL: Record<string, string> = Object.fromEntries(Object.entries(LANE).map(([k, v]) => [k, v.label]));

function geoKey(o: OppLite) {
  if (o.job.remote === "remote") return "remote";
  return j<string[]>(o.job.countries, [])[0] ?? "—";
}
function geoLabel(k: string) {
  if (k === "remote") return WORK_MODE_RU.remote;
  const region = Object.entries(REGIONS).find(([key, r]) => key !== "WORLD" && r.countries.includes(k));
  return region ? `${k} · ${region[1].label}` : k;
}
const matchBand = (o: OppLite) => (o.match >= 80 ? "80–100" : o.match >= 65 ? "65–79" : o.match >= 50 ? "50–64" : "< 50");
const cvVariant = (o: OppLite) => {
  const v = o.pkg?.cvVersion;
  if (!v) return "без пакета";
  const variant = v.split("-").slice(1).join("-");
  return variant || "базовая";
};
const FRESH_ORDER = ["< 24 ч", "1–3 дня", "3–7 дней", "> 7 дней", "—"];
const BAND_ORDER = ["80–100", "65–79", "50–64", "< 50"];

export default async function InsightsPage() {
  const user = await requireUser();
  const campaign = await currentCampaign(user.id);
  if (!campaign) {
    return (
      <>
        <PageHeader eyebrow="Обучение на ответах" title="Стратегия" />
        <Empty title="Нет данных для обучения" sub="Агент учится на реальных исходах заявок. Запусти кампанию — выводы появятся после первых ~20 отправленных заявок." action={<ButtonLink href="/app/campaign">Начать кампанию</ButtonLink>} />
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

  const byGeo = segmentStats(opps, geoKey, geoLabel);
  // Weights, verdicts and the summary from one source (lib strategyView), so the table, the bars and the lines agree.
  const view = strategyView(opps, allocation, byGeo);
  const bySegment = view.rows;
  const byLane = segmentStats(opps, (o) => o.lane, (k) => LANE_LABEL[k] ?? k);
  const byCv = segmentStats(opps, cvVariant, (k) => (k === "без пакета" ? "Без пакета" : k === "базовая" ? "Базовая версия" : `CV · ${segmentLabel(k)}`));
  const byFresh = segmentStats(opps, freshnessBucket).sort((a, b) => FRESH_ORDER.indexOf(a.key) - FRESH_ORDER.indexOf(b.key));
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
        eyebrow="Обучение на ответах · оптимизация стратегии"
        title={<>Куда агент <Script>смещает</Script> заявки</>}
        sub="Каждый ответ работодателя — сигнал. Агент считает, какие роли, страны, форматы и версии CV реально дают интервью, и перераспределяет новые заявки."
      />

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 md:grid-cols-[repeat(4,minmax(0,1fr))]">
        <Card className="min-w-0 !p-5"><Stat label="Отправлено" value={applied.length} hint={`${plural(applied.length, ["заявка", "заявки", "заявок"])} в выборке`} /></Card>
        <Card className="min-w-0 !p-5"><Stat label="Доля ответов" value={pctLabel(responses, applied.length)} hint={count(responses, ["живой ответ", "живых ответа", "живых ответов"])} /></Card>
        <Card className="min-w-0 !p-5"><Stat label="→ Тесты" value={pctLabel(assessments, applied.length)} hint={count(assessments, ["тестовое задание", "тестовых задания", "тестовых заданий"])} /></Card>
        <Card className="min-w-0 !p-5"><Stat label="→ Интервью" value={pctLabel(interviews, applied.length)} hint={`${interviews} интервью`} tone="green" /></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card strong className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2"><Lightbulb className="size-4 text-green" strokeWidth={1.7} aria-hidden /><Label>Выводы агента</Label></div>
          <ul className="flex flex-col gap-3">
            {recs.map((r) => (
              <li key={r} className="border-l-2 border-green/40 pl-4 text-[15px] leading-relaxed text-ink">{r}</li>
            ))}
          </ul>
        </Card>
        <Card className="flex min-w-0 flex-col gap-4 bg-cta/[.03]">
          <Quote className="size-5 text-teal" strokeWidth={1.5} aria-hidden />
          <p className="h-serif text-[22px] leading-snug">Агент не гонится за количеством заявок. 100 качественных → 15 интервью лучше, чем 10 000 плохих.</p>
          <p className="text-[13.5px] text-ink-3">Поэтому метрика — интервью, а не отклики: сегмент без интервью после 15+ заявок останавливается, даже если в нём много вакансий.</p>
        </Card>
      </div>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><Label>По ролям</Label><h2 className="h-serif mt-2 text-[22px]">Какие роли дают интервью</h2></div>
          <p className="max-w-md text-[12.5px] text-ink-3">Конверсия — доля заявок, дошедших до интервью. Вес — насколько чаще агент выбирает роли сегмента, с поправкой на малую выборку (1,0 = средний).</p>
        </div>
        <StatsTable rows={bySegment} verdict />
        {updating && <p className="text-[12px] text-ink-3">Новые веса агент применит в следующем цикле.</p>}
      </Card>

      <Card className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><Label>Текущее распределение</Label><h2 className="h-serif mt-2 text-[22px]">Веса сегментов в ранжировании</h2></div>
          <span className="text-[12.5px] text-ink-3">Умножают вероятность интервью для каждой новой вакансии сегмента</span>
        </div>
        {alloc.length === 0 ? (
          <p className="text-[13.5px] text-ink-3">Веса ещё не выучены — все сегменты с весом 1,0.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {alloc.map(([k, w]) => (
              <li key={k} className="grid grid-cols-[minmax(0,110px)_minmax(0,1fr)_48px] items-center gap-3 sm:grid-cols-[180px_minmax(0,1fr)_56px]">
                <span className="truncate text-[13.5px] text-head">{segmentLabel(k)}</span>
                <div className="relative h-3 rounded-full bg-head/[.06]" aria-hidden>
                  <div className={cx("h-full rounded-full", w >= 1.3 ? "bg-green" : w <= 0.7 ? "bg-amber" : "bg-teal")} style={{ width: `${(w / maxW) * 100}%` }} />
                  <span className="absolute inset-y-[-3px] w-px bg-head/40" style={{ left: `${(1 / maxW) * 100}%` }} title="1,0 — средний вес" />
                </div>
                <span className="num text-right text-[14px] text-head">{weightLabel(w)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-ink-3">Вертикальная черта — вес 1,0 (средний сегмент).</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
        <Breakdown title="География" sub="Удалённая работа против конкретных стран" rows={byGeo} />
        <Breakdown title="Тип заявки" sub="Обычные, компании мечты и массовый найм. Для массового найма тестовое задание — отдельный исход, не интервью" rows={byLane} />
        <Breakdown title="Версия CV" sub="Какой вариант позиционирования конвертирует" rows={byCv} />
        <Breakdown title="Свежесть подачи" sub="Сколько прошло от публикации до заявки" rows={byFresh} />
        <Breakdown title="Диапазон Match" sub="Проверка: действительно ли высокий Match даёт интервью" rows={byBand} />
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

function StatsTable({ rows, weight, verdict }: { rows: SegmentStat[]; weight?: (k: string) => number | undefined; verdict?: boolean }) {
  if (!rows.length) return <p className="text-[13.5px] text-ink-3">Пока нет отправленных заявок — таблица заполнится по мере ответов работодателей.</p>;
  return (
    <div className="scroll-thin -mx-1 overflow-x-auto px-1" role="region" aria-label="Статистика по ролям" tabIndex={0}>
      <table className="w-full min-w-[720px] border-collapse text-[13.5px]">
        <thead>
          <tr className="text-left">
            {["Сегмент", "Подано", "Ответы", "Тесты", "Интервью", "Офферы", "Конверсия", "Вес", ...(verdict ? ["Вердикт"] : [])].map((h, i) => (
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
                <td className="num py-2.5 text-right">{weightLabel(w)}</td>
                {verdict && <td className="py-2.5 text-right"><Chip tone={VERDICT[r.verdict].tone}>{VERDICT[r.verdict].label}</Chip></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ title, sub, rows }: { title: string; sub: string; rows: SegmentStat[] }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3">
      <div><Label>{title}</Label><p className="mt-1.5 text-[12.5px] text-ink-3">{sub}</p></div>
      {rows.length === 0 ? (
        <p className="text-[13.5px] text-ink-3">Нет данных.</p>
      ) : (
        <div className="scroll-thin overflow-x-auto" role="region" aria-label={title} tabIndex={0}>
          <table className="w-full min-w-[380px] border-collapse text-[13px]">
            <thead>
              <tr>
                {[title, "Подано", "Тесты", "Интервью", "Конверсия"].map((h, i) => (
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
