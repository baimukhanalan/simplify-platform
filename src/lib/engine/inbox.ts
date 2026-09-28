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
  if (date) return new Date(date[1]);
  return null;
}

export const CLASS_TO_STATUS: Record<InboxClass, string | null> = { confirmation: "pending", rejection: "rejected", assessment: "assessment", interview: null, offer: "offer", info: null, unknown: null };

/** Match an email to one of the user's applications by company name / domain. */
export function matchCompany(from: string, subject: string, body: string, companies: { id: string; company: string }[]) {
  const text = `${from} ${subject} ${body}`.toLowerCase();
  const domain = from.split("@")[1]?.split(".")[0] ?? "";
  let best: { id: string; score: number } | null = null;
  for (const c of companies) {
    const name = c.company.toLowerCase();
    const slug = name.replace(/[^a-z0-9]/g, "");
    let score = 0;
    if (domain && (domain === slug || slug.includes(domain) || domain.includes(slug))) score += 3;
    if (text.includes(name)) score += 2;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best && best.score > 0 ? best.id : null;
}
