import { z } from "zod";
import { aiJSON } from "../ai";
import { ROLE_FAMILIES, extractSkills } from "./taxonomy";

export type FactLite = { id: string; kind: string; title: string; org: string; startDate: string; endDate: string; details: string; metrics: string; tech: string[]; verified: boolean };
export type ProfileLite = {
  name: string; email: string; phone: string; location: string; headline: string; summary: string; skills: string[];
  yearsExperience: number; englishLevel: string; workAuth: string[]; needsSponsorship: boolean; relocation: boolean;
  linkedin: string; github: string; portfolio: string; noticePeriod: string; salaryExpectation: number; citizenship: string;
};
export type JobLite = { title: string; company: string; roleFamily: string; description: string; technologies: string[]; requirements: string[]; countries: string[]; remote: string; sponsorship: string; salaryMin: number | null; salaryMax: number | null; industry: string };

export type Answer = { q: string; a: string; category: "auto" | "rule" | "approval"; status: "filled" | "pending" | "approved"; kind?: string };
export type Package = { cvText: string; summary: string; coverLetter: string; skillsOrder: string[]; projects: string[]; answers: Answer[] };

const FRAMING: Record<string, string> = {
  data_analyst: "turning raw data into decisions",
  product_analyst: "analyzing user behavior to support product decisions",
  data_scientist: "building models that answer business questions",
  data_engineer: "building reliable data pipelines",
  software_engineer: "shipping reliable software",
  qa: "keeping releases stable through systematic testing",
  product_manager: "turning user problems into shipped product",
  designer: "designing clear, usable products",
  marketing: "measuring and improving marketing effectiveness",
  sales: "building pipeline and closing deals",
  support: "resolving customer issues quickly and clearly",
  operations: "making processes run smoothly",
  annotation: "producing accurate, guideline-compliant data",
  other: "delivering measurable results",
};

function relevance(f: FactLite, keys: Set<string>) {
  const text = `${f.title} ${f.details} ${f.tech.join(" ")}`.toLowerCase();
  let score = f.metrics ? 2 : 0;
  for (const k of keys) if (text.includes(k)) score += 1;
  return score + (f.verified ? 0.5 : 0);
}

export function buildPackageHeuristic(p: ProfileLite, facts: FactLite[], job: JobLite): Package {
  const jobKeys = new Set([...job.technologies, ...extractSkills(`${job.description} ${job.requirements.join(" ")}`)].map((s) => s.toLowerCase()));
  const skillsOrder = [...p.skills].sort((a, b) => Number(jobKeys.has(b.toLowerCase())) - Number(jobKeys.has(a.toLowerCase())));
  const matched = skillsOrder.filter((s) => jobKeys.has(s.toLowerCase()));
  const roleLabel = ROLE_FAMILIES[job.roleFamily]?.label ?? job.title;
  const framing = FRAMING[job.roleFamily] ?? FRAMING.other;

  const work = facts.filter((f) => f.kind === "employment").sort((a, b) => relevance(b, jobKeys) - relevance(a, jobKeys));
  const projects = facts.filter((f) => f.kind === "project").sort((a, b) => relevance(b, jobKeys) - relevance(a, jobKeys)).slice(0, 3);
  const edu = facts.filter((f) => f.kind === "education");
  const certs = facts.filter((f) => f.kind === "certification");

  const yrs = p.yearsExperience >= 1 ? `${p.yearsExperience % 1 === 0 ? p.yearsExperience : p.yearsExperience.toFixed(1)} years` : "hands-on project";
  const topMetric = work.concat(projects).find((f) => f.metrics)?.metrics;
  const topClause = topMetric ? achievementClause(topMetric) : null;
  const recent = topMetric ? (topClause ? ` Recently ${topClause}.` : ` Recent result: ${lcFirstWord(tidyAchievement(topMetric))}.`) : "";
  const summary = `${roleLabel}-focused professional with ${yrs} of experience ${framing}. Core tools: ${(matched.length ? matched : skillsOrder).slice(0, 5).join(", ")}.${recent}`;

  /** Whole achievements (one per CV line), original order; if a role lists more than MAX_BULLETS, keep the most job-relevant ones. */
  const bullets = (f: FactLite) => {
    const lines = achievementLines(f.details);
    const keep = lines.length <= MAX_BULLETS
      ? lines
      : lines.map((l, i) => ({ l, i, s: score(l) })).sort((a, b) => b.s - a.s || a.i - b.i).slice(0, MAX_BULLETS).sort((a, b) => a.i - b.i).map((x) => x.l);
    return keep.map((l) => `  • ${l}`).join("\n");
    function score(l: string) { const low = l.toLowerCase(); let s = /\d/.test(l) ? 1 : 0; for (const k of jobKeys) if (low.includes(k)) s++; return s; }
  };
  const extraMetric = (f: FactLite) => (f.metrics && !f.details.includes(f.metrics) ? `\n  • ${f.metrics}` : "");
  const projectLine = (f: FactLite) => stripTitle(achievementLines(f.details)[0] ?? "", f.title);
  const cvText = [
    `${p.name}`,
    `${p.headline || roleLabel} · ${p.location}${p.relocation ? " · open to relocation" : ""}`,
    [p.email, p.phone, p.linkedin, p.github, p.portfolio].filter(Boolean).join(" · "),
    ``,
    `SUMMARY`,
    summary,
    ``,
    `SKILLS`,
    skillsOrder.join(" · "),
    ``,
    `EXPERIENCE`,
    ...work.map((f) => `${f.title}${f.org ? ` — ${f.org}` : ""} (${f.startDate} – ${f.endDate})${f.details.trim() ? `\n${bullets(f)}` : ""}${extraMetric(f)}`),
    ...(projects.length ? [``, `SELECTED PROJECTS`, ...projects.map((f) => {
      const line = projectLine(f);
      return `${f.title}${f.tech.length ? ` (${f.tech.join(", ")})` : ""}${line ? `\n  • ${line}` : ""}${f.metrics && !line.includes(f.metrics) && !f.title.includes(f.metrics) ? `\n  • ${stripTitle(f.metrics, f.title)}` : ""}`;
    })] : []),
    ...(edu.length ? [``, `EDUCATION`, ...edu.map((f) => `${f.title}${f.org ? ` — ${f.org}` : ""} (${f.startDate} – ${f.endDate})`)] : []),
    ...(certs.length ? [``, `CERTIFICATIONS`, ...certs.map((f) => f.title)] : []),
    ``,
    `LANGUAGES`,
    `English — ${p.englishLevel}`,
  ].join("\n");

  const best = work[0] ?? projects[0];
  const coverLetter = [
    `Dear ${job.company} hiring team,`,
    ``,
    `I'm applying for the ${job.title} role. My background is in ${framing}, and the overlap with what you need is concrete: ${(matched.length ? matched : skillsOrder).slice(0, 4).join(", ")}.`,
    best ? relevantSentence(best) : "",
    `${job.remote === "remote" ? "I work remotely and overlap comfortably with European business hours." : p.relocation ? "I'm open to relocation." : ""} I'd welcome the chance to discuss how I can contribute to ${job.industry ? `${possessive(job.company)} work in ${job.industry}` : job.company}.`.trim(),
    ``,
    `Best regards,`,
    p.name,
  ].filter((l) => l !== "").join("\n\n").replace(/\n\n\n+/g, "\n\n");

  return { cvText, summary, coverLetter, skillsOrder, projects: projects.map((f) => f.title), answers: screeningAnswers(p, facts, job) };
}

const MAX_BULLETS = 6;

/** "Most relevant: …" sentence for the cover letter, built from the single strongest achievement of a fact. */
function relevantSentence(f: FactLite): string {
  const lines = achievementLines(f.details).map((l) => (f.kind === "project" ? stripTitle(l, f.title) : l)).filter(Boolean);
  const line = (f.metrics && lines.find((l) => l.includes(f.metrics))) || lines[0] || "";
  const where = f.kind === "project"
    ? `in my ${f.title} project`
    : `in my role as ${f.title}${f.org ? ` at ${f.org}` : ""}`;
  if (!line) return `Most relevant is my work ${where}.`;
  const clause = achievementClause(line);
  const metricNote = f.metrics && !line.includes(f.metrics) ? ` The measurable result: ${lcFirstWord(tidyAchievement(f.metrics))}.` : "";
  return clause
    ? `Most relevant: ${where}, I ${clause}.${metricNote}`
    : `Most relevant is my work ${where}: ${lcFirstWord(tidyAchievement(line))}.${metricNote}`;
}

// ——— Achievement text helpers (shared with the Offer Desk). They only rephrase the user's own CV lines, never add facts. ———

/** Split CV details into whole achievements: one per line, bullets stripped. Never splits inside a line. */
export function achievementLines(details: string): string[] {
  return details.split("\n").map((l) => l.replace(/^\s*[-•*·–]\s*/, "").trim().replace(/[;,]\s*$/, "")).filter(Boolean);
}

/** Drop a leading "Title:" / "Title —" that repeats the fact title ("Credit scoring EDA: Credit scoring EDA…"). */
export function stripTitle(line: string, title: string): string {
  const t = title.trim();
  if (!t || !line.toLowerCase().startsWith(t.toLowerCase())) return line;
  const rest = line.slice(t.length).replace(/^\s*[:—–-]\s*/, "").trim();
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : line;
}

/** "Silkroad Markets" → "Silkroad Markets'", "Kaspi" → "Kaspi's". */
export function possessive(name: string): string {
  const n = name.trim();
  return /s$/i.test(n) ? `${n}'` : `${n}'s`;
}

const IRREGULAR: Record<string, string> = {
  ran: "running", built: "building", rebuilt: "rebuilding", led: "leading", "co-led": "co-leading", cut: "cutting", set: "setting", made: "making",
  wrote: "writing", rewrote: "rewriting", drove: "driving", won: "winning", took: "taking", undertook: "undertaking", found: "finding", held: "holding",
  sold: "selling", taught: "teaching", brought: "bringing", grew: "growing", began: "beginning", got: "getting", kept: "keeping", put: "putting",
  spoke: "speaking", oversaw: "overseeing", saw: "seeing", did: "doing", gave: "giving", chose: "choosing", met: "meeting", spent: "spending",
  shipped: "shipping",
};
const pastVerb = (w: string) => { const v = w.toLowerCase(); return v in IRREGULAR || (/^[a-z-]{3,}ed$/.test(v) && !/eed$/.test(v)); };
function gerund(w: string): string {
  const v = w.toLowerCase();
  if (IRREGULAR[v]) return IRREGULAR[v];
  if (/ied$/.test(v)) return `${v.slice(0, -3)}ying`;
  return `${v.slice(0, -2)}ing`;
}

const COUNTABLE = new Set(["test", "model", "dashboard", "pipeline", "report", "tool", "service", "system", "experiment", "campaign", "study", "survey", "framework", "process", "feature", "api", "app", "bot", "platform", "program", "project", "prototype", "website", "database", "forecast", "offer", "workshop", "course", "team", "migration", "redesign", "roadmap", "strategy", "playbook", "script", "library", "integration", "audit"]);
const DETERMINERS = /^(a|an|the|my|our|their|its|his|her|this|these|those|all|every|each|several|multiple|many|some|two|three|four|five|new|internal|weekly|daily|monthly)$/i;
const PREP = /^(with|for|in|on|that|which|to|across|at|by|from|using|via|into|of|and)$/i;

/** Adds a/an before a singular countable object ("Ran onboarding A/B test" → "an onboarding A/B test"). Conservative: only for known nouns. */
function withArticle(obj: string): string {
  const words = obj.split(/\s+/);
  if (!words.length || DETERMINERS.test(words[0]) || /^\d/.test(words[0])) return obj;
  const headIdx = words.findIndex((w, i) => i > 0 && PREP.test(w));
  const head = (headIdx === -1 ? words[words.length - 1] : words[headIdx - 1]).toLowerCase().replace(/[^a-z]/g, "");
  if (!COUNTABLE.has(head)) return obj;
  const first = words[0];
  const acronym = /^[A-Z0-9][A-Z0-9/+&-]+$/.test(first);
  const an = acronym ? /^[AEFHILMNORSX]/.test(first) : /^[aeiou]/i.test(first);
  return `${an ? "an" : "a"} ${obj}`;
}

/** Normalises arrows and team references; strips trailing punctuation. */
export function tidyAchievement(line: string): string {
  return line
    .trim()
    .replace(/(?<!from\s)(\$?\d[\d.,]*\s?[%kKmM]?)\s*(?:→|->|=>)\s*(\$?\d[\d.,]*\s?[%kKmM]?)/g, "from $1 to $2")
    .replace(/\bwith (product|marketing|sales|engineering|design|data|finance|ops|operations|support|analytics|growth|risk) team\b/gi, "with the $1 team")
    .replace(/[\s.;,]+$/, "");
}

/** Lower-cases the first word unless it is an acronym / proper noun ("SQL", "Power BI"). */
export function lcFirstWord(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

type Parts = { actions: { verb: string; obj: string }[]; results: string[] };
function parts(line: string): Parts | null {
  const segs = tidyAchievement(line).split(/;\s*/).flatMap((seg) => seg.split(/,\s+(?:and\s+)?(?=[A-Za-z-]+\s)/).reduce<string[]>((acc, piece, i) => {
    // Re-join comma pieces that don't start with a past-tense verb: "for sales, marketing and ops" stays one piece.
    if (i > 0 && !pastVerb(piece.split(/\s+/)[0])) acc[acc.length - 1] += `, ${piece}`;
    else acc.push(piece);
    return acc;
  }, [])).map((s) => s.trim()).filter(Boolean);
  const actions: Parts["actions"] = [];
  const results: string[] = [];
  for (const seg of segs) {
    const m = seg.match(/^([A-Za-z-]+)\s+(.+)$/);
    if (m && pastVerb(m[1]) && !results.length) actions.push({ verb: m[1].toLowerCase(), obj: withArticle(m[2]) });
    else results.push(lcFirstWord(seg));
  }
  return actions.length ? { actions, results } : null;
}
const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** First-person past clause to follow "I": "ran an onboarding A/B test with the product team, and activation grew from 18% to 26%". Null if the line doesn't start with an action verb. */
export function achievementClause(line: string): string | null {
  const p = parts(line);
  if (!p) return null;
  const act = joinAnd(p.actions.map((a) => `${a.verb} ${a.obj}`));
  return p.results.length ? `${act}, and ${p.results.join(", ")}` : act;
}

/** Gerund phrase to follow "experience": "running an onboarding A/B test with the product team (activation grew from 18% to 26%)". */
export function achievementGerund(line: string): string | null {
  const p = parts(line);
  if (!p) return null;
  const act = joinAnd(p.actions.map((a) => `${gerund(a.verb)} ${a.obj}`));
  return p.results.length ? `${act} (${p.results.join(", ")})` : act;
}

/** A standalone sentence: "Ran an onboarding A/B test with the product team — activation grew from 18% to 26%." */
export function achievementSentence(line: string): string {
  const p = parts(line);
  const text = p
    ? `${joinAnd(p.actions.map((a) => `${a.verb} ${a.obj}`))}${p.results.length ? ` — ${p.results.join(", ")}` : ""}`
    : tidyAchievement(line);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** Standard ATS screening questions, categorized by who may answer them. */
export function screeningAnswers(p: ProfileLite, facts: FactLite[], job: JobLite): Answer[] {
  const out: Answer[] = [];
  const auth = new Set(p.workAuth);
  const jobCountries = job.countries.filter((c) => c !== "*");
  const mainTech = job.technologies.find((t) => p.skills.some((s) => s.toLowerCase() === t.toLowerCase()));
  if (mainTech) {
    const yrs = yearsWith(mainTech, facts, p.yearsExperience);
    out.push({ q: `How many years of experience do you have with ${mainTech}?`, a: String(yrs), category: "auto", status: "filled" });
  }
  const missingTech = job.technologies.find((t) => !p.skills.some((s) => s.toLowerCase() === t.toLowerCase()));
  if (missingTech) out.push({ q: `How many years of experience do you have with ${missingTech}?`, a: "0", category: "auto", status: "filled" });

  for (const c of jobCountries.slice(0, 1)) {
    const authorized = auth.has(c);
    out.push({ q: `Are you legally authorized to work in ${c}?`, a: authorized ? "Yes" : "No", category: "rule", status: "filled" });
    if (!authorized) {
      const disputed = job.sponsorship === "unknown";
      out.push({
        q: `Will you now or in the future require visa sponsorship to work in ${c}?`,
        a: p.needsSponsorship ? "Yes" : "No",
        category: disputed ? "approval" : "rule",
        status: disputed ? "pending" : "filled",
        kind: "sponsorship",
      });
    }
  }
  out.push({ q: "What are your salary expectations?", a: p.salaryExpectation ? `$${Math.round(p.salaryExpectation / 1000)}k–$${Math.round((p.salaryExpectation * 1.15) / 1000)}k base, open to discussing the full package` : "Open to a market-rate offer; happy to discuss the full package", category: "rule", status: "filled", kind: "salary" });
  if (job.remote !== "remote") out.push({ q: "Are you willing to relocate?", a: p.relocation ? "Yes" : "No", category: "rule", status: "filled" });
  out.push({ q: "When can you start / what is your notice period?", a: p.noticePeriod || "2 weeks", category: "rule", status: "filled" });
  out.push({ q: `Why do you want to work at ${job.company}?`, a: `The ${job.title} role maps directly onto my verified experience (${p.skills.slice(0, 3).join(", ")}), and ${job.company}'s ${job.industry || "product"} focus is where I want to grow.`, category: "auto", status: "filled" });
  // Sensitive / legal — never answered by the agent alone.
  out.push({ q: "Voluntary self-identification (gender, veteran status, disability)", a: "", category: "approval", status: "pending", kind: "sensitive" });
  if (/\b(US|CA|GB)\b/.test(jobCountries.join(" "))) out.push({ q: "Do you consent to a background check if you receive an offer?", a: "", category: "approval", status: "pending", kind: "legal" });
  return out;
}

function yearsWith(tech: string, facts: FactLite[], total: number) {
  const k = tech.toLowerCase();
  const withTech = facts.filter((f) => f.kind === "employment" && (f.tech.some((t) => t.toLowerCase() === k) || f.details.toLowerCase().includes(k)));
  if (!withTech.length) return Math.min(1, total);
  let months = 0;
  for (const f of withTech) {
    const a = f.startDate.match(/\d{4}/)?.[0];
    const b = /present|now|current|настоящ|сейчас/i.test(f.endDate) ? String(new Date().getFullYear()) : f.endDate.match(/\d{4}/)?.[0];
    if (a && b) months += Math.max(6, (Number(b) - Number(a)) * 12);
  }
  return Math.min(total, Math.round((months / 12) * 2) / 2) || Math.min(1, total);
}

const PackageSchema = z.object({ summary: z.string(), cvText: z.string(), coverLetter: z.string(), skillsOrder: z.array(z.string()), projects: z.array(z.string()) });

export async function buildPackage(p: ProfileLite, facts: FactLite[], job: JobLite): Promise<Package & { by: "claude" | "engine" }> {
  const base = buildPackageHeuristic(p, facts, job);
  const { data, by } = await aiJSON({
    schema: PackageSchema,
    system: "Create a tailored application package: a plain-text CV variant (same sections as the draft), a 3-5 sentence professional summary, a cover letter under 220 words, skills reordered by relevance (subset of the candidate's skills only), and up to 3 project titles to feature. Reposition the profile toward the job's language.",
    prompt: `JOB: ${job.title} at ${job.company}\n${job.description.slice(0, 6000)}\n\nVERIFIED PROFILE:\n${JSON.stringify({ ...p, facts }, null, 1).slice(0, 20000)}\n\nDRAFT CV:\n${base.cvText}`,
    fallback: () => ({ summary: base.summary, cvText: base.cvText, coverLetter: base.coverLetter, skillsOrder: base.skillsOrder, projects: base.projects }),
  });
  const skillsOrder = data.skillsOrder.filter((s) => p.skills.some((k) => k.toLowerCase() === s.toLowerCase()));
  return { ...base, ...data, skillsOrder: skillsOrder.length ? skillsOrder : base.skillsOrder, by };
}
