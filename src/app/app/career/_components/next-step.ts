import { ROLE_FAMILIES, SENIORITY, SENIORITY_LABEL, type Seniority } from "@/lib/engine/taxonomy";
import type { T } from "@/lib/i18n/translator";

/** The five components shown in Career Mode (careerScore keys; labels in careerPage.breakdown.*). */
export const BREAKDOWN = ["skillStrength", "experience", "marketDemand", "compensationPosition", "interviewReadiness"] as const;
export type BreakdownKey = (typeof BREAKDOWN)[number];

/** Role families with their own «what unlocks the next level» line (careerPage.unlock.*). */
const UNLOCK_KEYS = ["data_analyst", "product_analyst", "data_scientist", "data_engineer", "software_engineer", "qa", "product_manager", "designer", "marketing", "sales", "support", "operations", "annotation"] as const;
type UnlockKey = (typeof UNLOCK_KEYS)[number] | "other";
const unlockKey = (family: string): UnlockKey => ((UNLOCK_KEYS as readonly string[]).includes(family) ? (family as UnlockKey) : "other");

const SENIORITY_WORD: [RegExp, Seniority][] = [
  [/\bintern|стаж[её]р/i, "intern"],
  [/\bjunior|\bjr\b|младш/i, "junior"],
  [/\bmiddle|\bmid\b/i, "middle"],
  [/\bsenior|\bsr\b|старш|ведущ/i, "senior"],
  [/\blead\b|\bhead\b|principal|staff|руковод/i, "lead"],
];

/** A job title we can put a level in front of: "Data Analyst", "QA Engineer" — not "Other" or "Sales / SDR". */
const TITLE_LIKE = /\b(analyst|engineer|scientist|manager|designer|developer|specialist|marketer|consultant|accountant|coordinator)\b/i;

/** The role noun without level words: "Junior Data Analyst" → "Data Analyst". */
export function baseRole(title: string): string {
  let t = title;
  for (const [re] of SENIORITY_WORD) t = t.replace(new RegExp(re.source, "gi"), " ");
  return t.replace(/\s+/g, " ").replace(/^[\s,·–-]+|[\s,·–-]+$/g, "").trim();
}

/**
 * "Senior Data Analyst" — the next title up from the current level. Built from the user's own role (goal / current title),
 * falling back to the family label only when it reads like a title. Null when there is nothing sensible to show.
 */
export function nextMilestone(family: string, level: Seniority, roleTitle = ""): { title: string; level: string } | null {
  const own = baseRole(roleTitle);
  const famLabel = ROLE_FAMILIES[family]?.label ?? "";
  const base = own && TITLE_LIKE.test(own) ? own : family !== "other" && TITLE_LIKE.test(famLabel) ? famLabel : own;
  if (!base) return null;
  const i = SENIORITY.indexOf(level);
  if (i >= SENIORITY.length - 1) {
    const area = base.replace(/ (Analyst|Engineer|Scientist|Manager|Designer|Developer|Specialist)$/i, "");
    return { title: area && area !== base ? `Head of ${area}` : `Lead ${base}`, level: "Head" };
  }
  const next = SENIORITY[i + 1];
  return { title: `${SENIORITY_LABEL[next]} ${base}`, level: SENIORITY_LABEL[next] };
}

/** One recommendation line from the weakest of the five components, in the current language. */
export function recommendation(t: T, opts: {
  components: Record<string, number>;
  family: string;
  skills: string[];
  nextLevel: string | null;
  mockCount: number;
}): { key: BreakdownKey; text: string; href: string; cta: string } {
  const key = BREAKDOWN.reduce((a, b) => ((opts.components[b] ?? 100) < (opts.components[a] ?? 100) ? b : a));
  const fam = ROLE_FAMILIES[opts.family] ?? ROLE_FAMILIES.other;
  const known = opts.family !== "other" && Boolean(ROLE_FAMILIES[opts.family]);
  const level = opts.nextLevel;
  const have = new Set(opts.skills.map((s) => s.toLowerCase()));
  const missing = fam.skills.find((s) => !have.has(s.toLowerCase()));
  const profile = { href: "/app/profile", cta: "Career Profile" };
  switch (key) {
    case "skillStrength":
      if (missing && known) {
        const p = { skill: missing, family: fam.label, level };
        return { key, text: level ? t("careerPage.rec.skillGapLevel", p) : t("careerPage.rec.skillGap", p), ...profile };
      }
      {
        const p = { skill: t(`careerPage.unlock.${unlockKey(opts.family)}`), level };
        return { key, text: level ? t("careerPage.rec.unlockLevel", p) : t("careerPage.rec.unlockNext", p), ...profile };
      }
    case "experience":
      return { key, text: level ? t("careerPage.rec.experienceLevel", { level }) : t("careerPage.rec.experienceNext"), ...profile };
    case "marketDemand":
      return { key, text: known ? t("careerPage.rec.demandKnown", { family: fam.label }) : t("careerPage.rec.demandUnknown"), href: "/app/goal", cta: t("careerPage.rec.ctaGoal") };
    case "compensationPosition":
      return { key, text: t("careerPage.rec.compensation"), href: "#better-roles", cta: t("careerPage.rec.ctaBetterRoles") };
    default:
      return { key, text: opts.mockCount ? t("careerPage.rec.mockMore") : t("careerPage.rec.mockFirst"), href: "/app/readiness", cta: "Readiness" };
  }
}
