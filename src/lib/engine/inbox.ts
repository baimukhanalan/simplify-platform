// Inbox Intelligence: classify employer emails and map them to pipeline transitions.

export type InboxClass = "confirmation" | "rejection" | "assessment" | "interview" | "offer" | "info" | "unknown";

const RULES: { cls: InboxClass; weight: number; patterns: RegExp[] }[] = [
  { cls: "offer", weight: 3, patterns: [/pleased to (extend|offer)/i, /offer letter/i, /\bjob offer\b/i, /рады предложить/i, /оффер/i, /compensation package/i] },
  { cls: "rejection", weight: 2.5, patterns: [/unfortunately/i, /not (be )?(moving|proceeding) forward/i, /decided to (move|proceed) with other/i, /other candidates/i, /position has been filled/i, /к сожалению/i, /не готовы/i, /regret to inform/i] },
  { cls: "assessment", weight: 2.2, patterns: [/assessment/i, /coding (test|challenge|exercise)/i, /take[- ]home/i, /hackerrank|codility|testgorilla|codesignal/i, /complete (the|this) (test|task)/i, /тестов(ое|ое задание)/i] },
  { cls: "interview", weight: 2, patterns: [/invite you (to|for) (an? )?(interview|call|chat)/i, /schedule (a|an|your) (call|interview|time)/i, /calendly\.com/i, /next step[s]? .*(call|interview|conversation)/i, /приглашаем.*(интервью|собеседован)/i, /phone screen/i, /would love to (chat|talk|speak)/i] },
  { cls: "confirmation", weight: 1.2, patterns: [/thank(s| you) for (applying|your application|your interest)/i, /we (have )?received your application/i, /application (has been )?(received|submitted)/i, /спасибо за отклик/i] },
];

export function classifyEmail(subject: string, body: string): { cls: InboxClass; confidence: number; round: string | null; deadline: Date | null } {
  const text = `${subject}\n${body}`;
  const scores = new Map<InboxClass, number>();
  for (const r of RULES) for (const p of r.patterns) if (p.test(text)) scores.set(r.cls, (scores.get(r.cls) ?? 0) + r.weight);
  // "Thank you for applying… unfortunately…" is a rejection, not a confirmation.
  if (scores.has("rejection")) scores.set("confirmation", 0);
  if (scores.has("interview") && scores.has("confirmation")) scores.set("confirmation", 0);
  const ranked = [...scores.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { cls: /application|position|role|вакансия/i.test(text) ? "info" : "unknown", confidence: 0.35, round: null, deadline: null };
  const [cls, score] = ranked[0];
  const total = ranked.reduce((a, [, v]) => a + v, 0);
  const confidence = Math.min(0.99, 0.55 + 0.3 * (score / total) + 0.05 * Math.min(3, score));
  return { cls, confidence: Math.round(confidence * 100) / 100, round: cls === "interview" ? detectRound(text) : null, deadline: detectDeadline(text) };
}

export function detectRound(text: string) {
  if (/final (round|interview)|onsite|финальн/i.test(text)) return "final";
  if (/technical|system design|live coding|case (study|interview)|техническ/i.test(text)) return "technical";
  if (/hiring manager|team lead|with (the )?manager/i.test(text)) return "hiring_manager";
  return "recruiter";
}

function detectDeadline(text: string): Date | null {
  const within = text.match(/within (\d{1,2}) (days|hours)/i);
  if (within) return new Date(Date.now() + Number(within[1]) * (within[2].toLowerCase() === "days" ? 86400000 : 3600000));
  const date = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (date) {
    const d = new Date(date[1]);
    if (!Number.isNaN(d.getTime())) return d; // "2026-13-45" is Invalid Date — Prisma would reject it
  }
  return null;
}

export const CLASS_TO_STATUS: Record<InboxClass, string | null> = { confirmation: "pending", rejection: "rejected", assessment: "assessment", interview: null, offer: "offer", info: null, unknown: null };

/** An application an email may be about. `title`, `status` and `updatedAt` break ties between several roles at one company. */
export type MailTarget = { id: string; company: string; title?: string; status?: string; updatedAt?: Date | null };

// Pipeline order (src/lib/rounds.ts OPP_ORDER): a later stage is the "more advanced" application. Closed ones rank last —
// mail never reopens a hired / rejected application, so an open one at the same company is the better guess.
const STAGE = ["submitted", "pending", "assessment", "recruiter", "hiring_manager", "technical", "final", "offer"];
const stageRank = (s = "") => (s === "hired" || s === "rejected" ? -2 : STAGE.indexOf(s));

// Words that say nothing about which role an email is about.
const TITLE_STOP = new Set(["and", "the", "for", "with", "of", "in", "at", "to", "a", "an", "role", "position", "job", "vacancy", "remote", "hybrid", "onsite", "m", "f", "d", "i", "ii", "iii"]);
const titleTokens = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}+#]+/u).filter((w) => w.length >= 2 && !TITLE_STOP.has(w)));

/**
 * How strongly the email names this role: the whole title mentioned verbatim = 4 (+0.01 per title word, so "Senior Data
 * Analyst" beats "Data Analyst" when the email names the senior role), otherwise the share of the title's words that
 * appear in the subject/body (token overlap, ×3). Levels count ("Senior" vs "Junior" Data Analyst).
 */
export function titleScore(title: string, subject: string, body: string) {
  const t = title.trim().toLowerCase();
  if (!t) return 0;
  const text = `${subject}\n${body}`.toLowerCase();
  const want = titleTokens(t);
  if (text.includes(t)) return 4 + want.size / 100;
  if (!want.size) return 0;
  const have = titleTokens(text);
  let hit = 0;
  for (const w of want) if (have.has(w)) hit++;
  return (3 * hit) / want.size;
}

/**
 * Match an email to one of the user's applications: first by company (name in the text, sender domain), then — when the
 * user applied to several roles at that company — by the role title named in the subject/body (verbatim, else token
 * overlap). Still tied: the most advanced open application, then the most recently updated one. Deterministic.
 */
export function matchCompany(from: string, subject: string, body: string, companies: MailTarget[]) {
  const text = `${from} ${subject} ${body}`.toLowerCase();
  const domain = from.split("@")[1]?.split(".")[0] ?? "";
  let best: { c: MailTarget; company: number; title: number } | null = null;
  for (const c of companies) {
    const name = c.company.toLowerCase();
    const slug = name.replace(/[^a-z0-9]/g, "");
    let company = 0;
    // Non-Latin names ("Каспи") slug to "" and would contain every domain: require a meaningful slug.
    if (domain.length >= 3 && slug.length >= 3 && (domain === slug || slug.includes(domain) || domain.includes(slug))) company += 3;
    if (name && text.includes(name)) company += 2;
    if (!company) continue;
    const cand = { c, company, title: c.title ? titleScore(c.title, subject, body) : 0 };
    if (!best || better(cand, best)) best = cand;
  }
  return best ? best.c.id : null;
}

function better(a: { c: MailTarget; company: number; title: number }, b: { c: MailTarget; company: number; title: number }) {
  if (a.company !== b.company) return a.company > b.company;
  if (a.title !== b.title) return a.title > b.title;
  const sa = stageRank(a.c.status), sb = stageRank(b.c.status);
  if (sa !== sb) return sa > sb;
  const ta = a.c.updatedAt?.getTime() ?? 0, tb = b.c.updatedAt?.getTime() ?? 0;
  if (ta !== tb) return ta > tb;
  return a.c.id < b.c.id;
}
