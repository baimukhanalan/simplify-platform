import { ROLE_FAMILIES, INTERVIEW_STATUSES } from "./taxonomy";

export type OppLite = { status: string; segment: string; lane: string; submittedAt: Date | null; match: number; job: { remote: string; countries: string; postedAt: Date; seniority: string }; pkg?: { cvVersion: string } | null; reachedInterview: boolean; reachedAssessment: boolean };

const REACHED_INTERVIEW = new Set([...INTERVIEW_STATUSES, "offer", "hired"]);
export const reachedInterview = (status: string, interviewCount: number) => REACHED_INTERVIEW.has(status) || interviewCount > 0;

export type SegmentStat = { key: string; label: string; applied: number; responses: number; assessments: number; interviews: number; offers: number; rejected: number; rate: number; smoothed: number; weight: number; verdict: "scale" | "keep" | "reduce" | "stop" | "learning" };

/** Bayesian-smoothed interview rate per segment → new application allocation. */
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
    x.weight = Math.round(Math.max(0.25, Math.min(2.2, x.smoothed / (mean || prior))) * 100) / 100;
    x.verdict = x.applied < 8 ? "learning" : x.interviews === 0 && x.applied >= 15 ? "stop" : x.weight >= 1.3 ? "scale" : x.weight <= 0.7 ? "reduce" : "keep";
  }
  return stats.sort((a, b) => b.smoothed - a.smoothed);
}

export function allocationFrom(opps: OppLite[]) {
  const stats = segmentStats(opps, (o) => o.segment);
  return Object.fromEntries(stats.map((x) => [x.key, x.verdict === "stop" ? 0.15 : x.weight]));
}

export function recommendations(bySegment: SegmentStat[], byGeo: SegmentStat[]) {
  const out: string[] = [];
  const best = bySegment.find((x) => x.applied >= 5);
  const worst = [...bySegment].reverse().find((x) => x.applied >= 10);
  if (best && worst && best.key !== worst.key && best.rate > worst.rate * 1.5)
    out.push(`${best.label}: ${best.applied} → ${best.interviews} интервью. ${worst.label}: ${worst.applied} → ${worst.interviews}. Смещаем новые заявки в «${best.label}».`);
  for (const x of bySegment.filter((x) => x.verdict === "stop")) out.push(`«${x.label}» — ${x.applied} заявок без интервью. Подача в сегмент приостановлена.`);
  const g = byGeo.find((x) => x.applied >= 6 && x.verdict === "scale");
  if (g) out.push(`${g.label} даёт лучший outcome (${Math.round(g.rate * 100)}% → интервью). Увеличиваем долю.`);
  if (!out.length) out.push("Данных пока мало: агент собирает статистику. Выводы появятся после ~20 отправленных заявок.");
  return out;
}

export const segmentLabel = (k: string) => ROLE_FAMILIES[k]?.label ?? k;
export const freshnessBucket = (o: OppLite) => {
  if (!o.submittedAt) return "—";
  const h = (o.submittedAt.getTime() - o.job.postedAt.getTime()) / 3600000;
  return h < 24 ? "< 24 ч" : h < 72 ? "1–3 дня" : h < 168 ? "3–7 дней" : "> 7 дней";
};
