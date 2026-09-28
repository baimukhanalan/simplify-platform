// Salary-model regions (pure). Maps goal/job country codes to marketRange() region keys.
import { REGIONS } from "@/lib/engine/taxonomy";

const FACTOR_KEYS = new Set(["US", "CA", "UK", "EU", "MENA", "WORLD", "CIS", "KZ"]);

/** Map ISO country codes / region keys to the salary-model regions. */
export function regionsFor(codes: string[]) {
  const out = new Set<string>();
  for (const c of codes) {
    const up = c.toUpperCase();
    if (FACTOR_KEYS.has(up)) out.add(up);
    else {
      const hit = Object.entries(REGIONS).find(([k, r]) => k !== "CIS" && r.countries.includes(up)) ?? Object.entries(REGIONS).find(([, r]) => r.countries.includes(up));
      if (hit) out.add(hit[0]);
    }
  }
  return [...out];
}
