// Salary Intelligence: indicative annual USD bands (US baseline × regional factor).
// These are model estimates for positioning — the UI always labels them as estimates.

const US_MID: Record<string, number[]> = {
  // intern, junior, middle, senior, lead
  data_analyst: [45, 68, 92, 120, 145],
  product_analyst: [48, 75, 105, 135, 160],
  data_scientist: [55, 95, 130, 170, 210],
  data_engineer: [55, 95, 130, 165, 200],
  software_engineer: [55, 100, 140, 185, 230],
  qa: [40, 62, 88, 115, 135],
  product_manager: [50, 90, 130, 170, 210],
  designer: [45, 78, 110, 145, 175],
  marketing: [40, 58, 82, 115, 145],
  sales: [42, 60, 85, 120, 150],
  support: [32, 42, 55, 70, 85],
  operations: [36, 50, 68, 90, 115],
  annotation: [25, 32, 40, 50, 60],
  other: [38, 55, 78, 105, 130],
};

// Region factors relative to US; remote-international roles for CIS candidates sit between.
const REGION_FACTOR: Record<string, number> = { US: 1, CA: 0.78, UK: 0.72, EU: 0.62, MENA: 0.7, WORLD: 0.55, CIS: 0.28, KZ: 0.25 };
const SENIORITY_IDX: Record<string, number> = { intern: 0, junior: 1, middle: 2, senior: 3, lead: 4 };

export function marketRange(family: string, seniority: string, regions: string[]) {
  const mids = US_MID[family] ?? US_MID.other;
  const mid0 = mids[SENIORITY_IDX[seniority] ?? 1] * 1000;
  const factors = regions.length ? regions.map((r) => REGION_FACTOR[r] ?? 0.55) : [0.55];
  const factor = Math.max(...factors);
  const mid = Math.round((mid0 * factor) / 1000) * 1000;
  return { low: Math.round((mid * 0.85) / 1000) * 1000, mid, high: Math.round((mid * 1.2) / 1000) * 1000 };
}

/**
 * THE "Market demand" score (0–100) from the number of active vacancies for the role family. One formula for Career Score's
 * component and the Readiness parameter of the same name, so both screens show the same number for the same data.
 */
export function marketDemandScore(activeJobs: number) {
  if (!activeJobs || activeJobs < 0) return 25;
  return Math.min(100, 45 + Math.round(Math.sqrt(activeJobs) * 6));
}

/** Percentile of a value inside a normal-ish band (low≈p15, high≈p85). */
export function percentileIn(value: number, range: { low: number; mid: number; high: number }) {
  const sd = (range.high - range.low) / 2.07; // p15..p85 ≈ ±1.036σ
  const z = (value - range.mid) / (sd || 1);
  const p = 0.5 * (1 + erf(z / Math.SQRT2));
  return Math.max(1, Math.min(99, Math.round(p * 100)));
}

function erf(x: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
