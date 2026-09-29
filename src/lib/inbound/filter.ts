// Forwarded mail that is not a letter from an employer (newsletters, job-alert digests, spam, bounces). It is still
// shown in the inbox (as «Инфо»/«Письмо»), but it never moves an application: a digest that mentions «к сожалению»
// next to a company name must not reject anything. Pure (no DB).
import { senderAddress } from "./verify";

const SPAM = /^(?:yes|true)\b/i;
const BULK_PRECEDENCE = /^(?:bulk|list|junk)\b/i;
const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster)@/i;
const DIGEST_SUBJECT =
  /\b(?:job alert|jobs? for you|new jobs|recommended jobs|jobs you may|newsletter|digest|weekly|webinar|unsubscribe)\b|подборк|рассылк|вакансии для (?:вас|тебя)|новые вакансии|рекомендуем(?:ые)? вакансии|вебинар|дайджест|скидк/i;
// Job boards and social networks whose automated mail is never a decision by an employer (hh.kz is not here: its
// invitations and declines are the employer's own answer, relayed).
const DIGEST_SENDER =
  /@(?:[\w-]+\.)*(?:linkedin\.com|indeed\.com|glassdoor\.com|facebookmail\.com|substack\.com|medium\.com|mailchimp\.com|mcsv\.net|youtube\.com|quora\.com|telegram\.org)$|^(?:jobalerts?|job-alerts?|jobs-noreply|newsletter|news|digest|marketing|promo)[\w.-]*@/i;

/**
 * True when a forwarded letter must not touch the pipeline. `matchesSender` says whether the From line itself names
 * (display name or domain) one of the user's applications — a mailing-list header alone then doesn't disqualify it,
 * since ATS mail is often sent through bulk providers.
 */
export function isNonEmployer(l: { from: string; subject: string; headers: Record<string, string> }, matchesSender: boolean) {
  const h = l.headers;
  const sender = senderAddress(l.from);
  if (SPAM.test(h["x-spam-flag"] ?? "") || /^yes/i.test(h["x-spam-status"] ?? "")) return true;
  if (BOUNCE_SENDER.test(sender)) return true;
  if (BULK_PRECEDENCE.test(h["precedence"] ?? "") || h["list-id"]) return true;
  if (DIGEST_SENDER.test(sender) || DIGEST_SUBJECT.test(l.subject)) return true;
  if (h["list-unsubscribe"] && !matchesSender) return true;
  return false;
}

const GENERIC_LABEL = new Set(["mail", "email", "gmail", "yandex", "outlook", "hotmail", "icloud", "inbox", "list", "lists", "news", "noreply", "info", "jobs", "careers", "hr", "us", "eu", "em", "mg", "sendgrid", "mailgun"]);

/** Does the From line (display name or domain) name this company? */
export function senderNames(from: string, company: string) {
  const f = from.toLowerCase();
  const name = company.trim().toLowerCase();
  // The name as a whole word ("Com" must not match "comtech").
  if (name.length >= 2 && new RegExp(`(?:^|[^\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^\\p{L}\\p{N}])`, "u").test(f)) return true;
  const slug = name.replace(/[^a-z0-9]/g, "");
  const domain = senderAddress(from).split("@")[1] ?? "";
  // Labels before the TLD only ("com" must not match "Comtech"); generic mail hosts never name a company.
  const labels = domain.split(".").slice(0, -1).filter((p) => !GENERIC_LABEL.has(p));
  return slug.length >= 3 && labels.some((part) => part === slug || (slug.length >= 4 && part.includes(slug)) || (part.length >= 4 && slug.includes(part)));
}
