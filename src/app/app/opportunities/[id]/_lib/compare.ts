// Finds the first employment entry of the tailored CV and pairs its bullets with the user's own wording from Profile facts.

type FactText = { title: string; org: string; details: string };

const BULLET = /^\s*(?:[•\-*–]|\d+\.)\s+/;

/**
 * Returns null when the CV does not contain a recognisable entry for any employment fact
 * (e.g. an AI-written CV with a different layout) — the caller then shows the summary comparison only.
 */
export function experiencePair(facts: FactText[], cvText: string): { heading: string; original: string[]; simplify: string[] } | null {
  const lines = cvText.split(/\r?\n/);
  let best: { at: number; fact: FactText } | null = null;
  for (const f of facts) {
    const title = f.title.trim().toLowerCase();
    if (!title) continue;
    const org = f.org.trim().toLowerCase();
    const at = lines.findIndex((l) => {
      const low = l.toLowerCase();
      return !BULLET.test(l) && low.includes(title) && (!org || low.includes(org));
    });
    if (at >= 0 && (!best || at < best.at)) best = { at, fact: f };
  }
  if (!best) return null;
  const simplify: string[] = [];
  for (let i = best.at + 1; i < lines.length && BULLET.test(lines[i]); i++) simplify.push(lines[i].replace(BULLET, "").trim());
  const original = best.fact.details.split(/\n|;\s/).map((l) => l.replace(BULLET, "").trim()).filter(Boolean);
  if (!simplify.length || !original.length) return null;
  return { heading: `${best.fact.title}${best.fact.org ? ` — ${best.fact.org}` : ""}`, original, simplify };
}
