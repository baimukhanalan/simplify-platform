// hh-specific normalization hook for src/lib/engine/ingest.ts normalize() (pure; no server deps).
// hh gives a structured salary (usually KZT per month) and an experience bucket; the generic text parser only
// understands "$60k–80k" annual USD, so an hh vacancy's salary would otherwise be lost or misread.
import { toUSD } from "../engine/fx";

export type HhRawSalary = { from?: number; to?: number; currency: string; period: "month" | "year" };

/** Annual USD [min, max] from an hh structured salary; nulls for unknown currencies or an empty range. */
export function hhAnnualUsd(sal: HhRawSalary | undefined): [number | null, number | null] {
  if (!sal || (!sal.from && !sal.to)) return [null, null];
  const cur = sal.currency.toUpperCase();
  if (!["KZT", "USD", "EUR", "GBP", "AED", "CAD"].includes(cur)) return [null, null]; // e.g. RUB/UZS: no FX rate → no guess
  const k = sal.period === "month" ? 12 : 1;
  const lo = sal.from ?? sal.to!, hi = sal.to ?? sal.from!;
  return [toUSD(lo * k, cur), toUSD(Math.max(lo, hi) * k, cur)];
}

/** What normalize() takes from an hh RawJob instead of guessing from text. */
export function hhNormalize(r: { salary?: HhRawSalary; minYears?: number; tags?: string[] }) {
  return { salary: hhAnnualUsd(r.salary), minYears: r.minYears, skillsText: (r.tags ?? []).join(", ") };
}
