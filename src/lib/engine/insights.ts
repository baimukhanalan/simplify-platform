import { ROLE_FAMILIES, INTERVIEW_STATUSES } from "./taxonomy";
import { count } from "../ru";

export type OppLite = { status: string; segment: string; lane: string; submittedAt: Date | null; match: number; job: { remote: string; countries: string; postedAt: Date; seniority: string }; pkg?: { cvVersion: string } | null; reachedInterview: boolean; reachedAssessment: boolean };

const REACHED_INTERVIEW = new Set([...INTERVIEW_STATUSES, "offer", "hired"]);
export const reachedInterview = (status: string, interviewCount: number) => REACHED_INTERVIEW.has(status) || interviewCount > 0;

export type SegmentStat = { key: string; label: string; applied: number; responses: number; assessments: number; interviews: number; offers: number; rejected: number; rate: number; smoothed: number; weight: number; verdict: "scale" | "keep" | "reduce" | "stop" | "learning" };

/** Applications a segment needs (with at least one employer reply) before the agent acts on it. */
export const MIN_EVIDENCE = 10;
/** Applications without a single interview after which a segment is stopped (evidence by itself). */
export const STOP_AFTER = 15;
/** The weight a stopped segment keeps (it is not removed entirely: the market may change). */
export const STOP_WEIGHT = 0.15;

/** Enough evidence to act on a segment: «Стоп» (STOP_AFTER+ applications, no interview), or MIN_EVIDENCE+ applications with a reply. */
export const hasEvidence = (x: Pick<SegmentStat, "applied" | "responses" | "interviews">) =>
  (x.applied >= STOP_AFTER && x.interviews === 0) || (x.applied >= MIN_EVIDENCE && x.responses > 0);

/**
 * Bayesian-smoothed interview rate per segment → the weight AND the verdict, from one computation: a segment without
 * evidence (hasEvidence) keeps weight 1,0 and verdict «learning» («Мало данных»); a stopped one weighs STOP_WEIGHT;
 * otherwise the verdict follows the weight (≥ 1,3 scale, ≤ 0,7 reduce, else keep). The table never shows ×1,8 next to
 * «Мало данных» or «Усилить» next to ×1,0.
 */
export function segmentStats(opps: OppLite[], keyOf: (o: OppLite) => string, labelOf: (k: string) => string = (k) => k): SegmentStat[] {
  const applied = opps.filter((o) => o.submittedAt);
  const prior = 0.1, strength = 6;
  const groups = new Map<string, OppLite[]>();
  for (const o of applied) groups.set(keyOf(o), [...(groups.get(keyOf(o)) ?? []), o]);
  const stats = [...groups.entries()].map(([key, list]) => {
    const interviews = list.filter((o) => o.reachedInterview).length;
    const assessments = list.filter((o) => o.reachedAssessment).length;
    const offers = list.filter((o) => o.status === "offer" || o.status === "hired").length;
    const rejected = list.filter((o) => o.status === "rejected").length;
    const responses = list.filter((o) => !["submitted", "pending"].includes(o.status)).length;
    const smoothed = (interviews + prior * strength) / (list.length + strength);
    return { key, label: labelOf(key), applied: list.length, responses, assessments, interviews, offers, rejected, rate: list.length ? interviews / list.length : 0, smoothed, weight: 1, verdict: "learning" as SegmentStat["verdict"] };
  });
  const mean = stats.length ? stats.reduce((a, x) => a + x.smoothed, 0) / stats.length : prior;
  for (const x of stats) {
    if (!hasEvidence(x)) { x.weight = 1; x.verdict = "learning"; continue; }
    if (x.applied >= STOP_AFTER && x.interviews === 0) { x.weight = STOP_WEIGHT; x.verdict = "stop"; continue; }
    x.weight = Math.round(Math.max(0.25, Math.min(2.2, x.smoothed / (mean || prior))) * 100) / 100;
    x.verdict = x.weight >= 1.3 ? "scale" : x.weight <= 0.7 ? "reduce" : "keep";
  }
  return stats.sort((a, b) => b.smoothed - a.smoothed);
}

/** The allocation the agent ranks with: exactly the weights of segmentStats (segments without evidence are left out = 1,0). */
export function allocationFrom(opps: OppLite[]) {
  const stats = segmentStats(opps, (o) => o.segment);
  return Object.fromEntries(stats.filter((x) => x.verdict !== "learning").map((x) => [x.key, x.weight]));
}

/** No segment has enough evidence yet: the summary says «Данных пока мало» and every verdict is «Мало данных». */
export const LOW_DATA_LINE = "Данных пока мало: агент собирает статистику. Выводы появятся после ~20 отправленных заявок.";

export function recommendations(bySegment: SegmentStat[], byGeo: SegmentStat[]) {
  const out: string[] = [];
  const known = bySegment.filter((x) => x.verdict !== "learning");
  if (!known.length) return [LOW_DATA_LINE];
  const best = known[0];
  const worst = known[known.length - 1];
  if (best && worst && best.key !== worst.key && best.rate > worst.rate * 1.5)
    out.push(`${best.label}: ${count(best.applied, ["заявка", "заявки", "заявок"])} → ${best.interviews} интервью. ${worst.label}: ${count(worst.applied, ["заявка", "заявки", "заявок"])} → ${worst.interviews} интервью. Агент смещает новые заявки в «${best.label}».`);
  for (const x of known.filter((x) => x.verdict === "stop")) out.push(`«${x.label}» — ${count(x.applied, ["заявка", "заявки", "заявок"])} без интервью. Агент приостановил подачу в этот сегмент.`);
  const g = byGeo.find((x) => x.verdict === "scale");
  if (g) out.push(`${g.label} даёт лучший результат (${Math.round(g.rate * 100)}% заявок доходят до интервью). Агент увеличивает долю таких заявок.`);
  if (!out.length) out.push("Сегменты с достаточными данными идут ровно — агент сохраняет текущее распределение заявок.");
  return out;
}

export type StrategyRow = SegmentStat & {
  /** The weight the agent ranks with right now (the stored allocation), 1 when not learned yet. */
  current: number;
  /** The stored allocation differs from this computation: the agent applies `weight` on its next cycle. */
  updating: boolean;
};

/**
 * The Strategy table from one source: rows by role segment with weight and verdict from segmentStats (the same
 * computation allocationFrom stores), the summary lines, and whether there is enough data at all. When `enoughData` is
 * false every verdict is «learning» («Мало данных») and every weight 1,0 — matching the «Данных пока мало» summary.
 * `allocation` = the campaign's stored allocation (what ranking uses until the next cycle).
 */
export function strategyView(opps: OppLite[], allocation: Record<string, number> = {}, byGeo?: SegmentStat[]) {
  const rows: StrategyRow[] = segmentStats(opps, (o) => o.segment, segmentLabel).map((x) => {
    const current = allocation[x.key] ?? 1;
    return { ...x, current, updating: Math.abs(current - x.weight) >= 0.01 };
  });
  const enoughData = rows.some((x) => x.verdict !== "learning");
  const summary = recommendations(rows, byGeo ?? []);
  return { rows, enoughData, summary, allocation: allocationFrom(opps) };
}

export const segmentLabel = (k: string) => ROLE_FAMILIES[k]?.label ?? k;
export const freshnessBucket = (o: OppLite) => {
  if (!o.submittedAt) return "—";
  const h = (o.submittedAt.getTime() - o.job.postedAt.getTime()) / 3600000;
  return h < 24 ? "< 24 ч" : h < 72 ? "1–3 дня" : h < 168 ? "3–7 дней" : "> 7 дней";
};
