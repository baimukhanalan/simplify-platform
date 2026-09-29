// Sender authentication of inbound letters, from the receiving provider's own verdicts. Pure (no DB).
//
// Anyone can write to a forwarding alias, so a letter may move an application only when it is authenticated for the
// domain in its From line and it reached us through the user's own mailbox (see service.ts). The verdicts we trust:
//   · Authentication-Results / ARC-Authentication-Results written by OUR receiver (Cloudflare Email Routing, Postmark):
//     dmarc=pass for the From domain, or dkim=pass / spf=pass for a domain aligned with it;
//   · when our receiver says arc=pass: the ARC-Authentication-Results of a trusted forwarder earlier in the chain
//     (Gmail / Outlook / Yandex / Mail.ru — the user's mailbox that auto-forwarded the letter) with such a pass;
//   · Postmark: its own Received-SPF (receiver=…@inbound.postmarkapp.com) and SpamAssassin's DKIM_VALID_AU.
// Only the TOPMOST header of each kind is read (a receiver prepends its own; anything below it came with the letter and
// can be forged), and only when it names a trusted authserv-id.
import { senderAddress } from "./verify";

export type AuthHeader = [name: string, value: string];
export type AuthVerdict = { pass: boolean; method: "dmarc" | "dkim" | "spf" | "arc" | null; domain: string | null };

/** Headers carrying verdicts (and the forwarding chain) that parse.ts keeps in order, raw. */
export const AUTH_HEADER_NAMES = new Set(["authentication-results", "arc-authentication-results", "received-spf", "x-spam-tests"]);

const DEFAULT_RECEIVERS = ["mx.cloudflare.net", "cloudflare.net", "cloudflare-email.net", "postmarkapp.com"];
/** Our receiving MTA(s). INBOUND_AUTHSERV_IDS (comma-separated) adds more, e.g. a custom Postmark server name. */
export const trustedReceivers = () => [...DEFAULT_RECEIVERS, ...(process.env.INBOUND_AUTHSERV_IDS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)];
/** Mailbox providers whose ARC verdicts count when they auto-forwarded the letter. */
export const TRUSTED_FORWARDERS = ["google.com", "gmail.com", "outlook.com", "protection.outlook.com", "microsoft.com", "hotmail.com", "yandex.ru", "yandex.net", "yandex.com", "yandex.kz", "mail.ru"];

const underDomain = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** Relaxed DMARC alignment: same domain or one is a subdomain of the other (organizational domain approximation). */
export function aligned(a: string, b: string) {
  const x = a.toLowerCase().replace(/\.$/, ""), y = b.toLowerCase().replace(/\.$/, "");
  if (!x || !y || !x.includes(".") || !y.includes(".")) return false;
  return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
}

const domainOf = (v: string) => {
  const s = v.trim().replace(/^<|>$/g, "").replace(/^"|"$/g, "").toLowerCase();
  const d = s.includes("@") ? s.slice(s.lastIndexOf("@") + 1) : s;
  return /^[a-z0-9.-]+\.[a-z]{2,63}$/.test(d) ? d : "";
};

type Parsed = { authserv: string; instance: number | null; results: { method: string; result: string; props: Record<string, string> }[] };

/** RFC 8601 / 8617 value → authserv-id, ARC instance and method results. Comments in parentheses are dropped. */
export function parseAuthResults(value: string, arc = false): Parsed | null {
  const v = value.replace(/\([^()]*\)/g, " ").slice(0, 5000);
  const parts = v.split(";").map((p) => p.trim()).filter(Boolean);
  let instance: number | null = null;
  if (arc) {
    const m = parts[0]?.match(/^i\s*=\s*(\d{1,3})$/i);
    if (!m) return null;
    instance = Number(m[1]);
    parts.shift();
  }
  const authserv = (parts.shift() ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!authserv || authserv.includes("=")) return null;
  const results: Parsed["results"] = [];
  for (const p of parts) {
    const m = p.match(/^([a-z0-9-]+)\s*=\s*([a-z]+)\b(.*)$/i);
    if (!m) continue;
    const props: Record<string, string> = {};
    for (const kv of m[3].matchAll(/([a-z0-9-]+\.[a-z0-9-]+)\s*=\s*("[^"]*"|[^\s;]+)/gi)) props[kv[1].toLowerCase()] = kv[2].replace(/^"|"$/g, "");
    results.push({ method: m[1].toLowerCase(), result: m[2].toLowerCase(), props });
  }
  return { authserv, instance, results };
}

/** An aligned pass in one set of results, or null. */
function alignedPass(r: Parsed, fromDomain: string): AuthVerdict | null {
  for (const x of r.results) {
    if (x.result !== "pass") continue;
    if (x.method === "dmarc") {
      const d = domainOf(x.props["header.from"] ?? "");
      if (d && aligned(d, fromDomain)) return { pass: true, method: "dmarc", domain: d };
    } else if (x.method === "dkim") {
      const d = domainOf(x.props["header.d"] ?? x.props["header.i"] ?? "");
      if (d && aligned(d, fromDomain)) return { pass: true, method: "dkim", domain: d };
    } else if (x.method === "spf") {
      const d = domainOf(x.props["smtp.mailfrom"] ?? x.props["smtp.helo"] ?? "");
      if (d && aligned(d, fromDomain)) return { pass: true, method: "spf", domain: d };
    }
  }
  return null;
}

const FAIL: AuthVerdict = { pass: false, method: null, domain: null };

/**
 * Is this letter authenticated for the domain of `from`? `headers` are the verdict headers in their original order
 * (topmost first), names lowercased. `format` tells which receiver-specific headers apply.
 */
export function authVerdict(from: string, headers: AuthHeader[], format: "postmark" | "generic"): AuthVerdict {
  const fromDomain = senderAddress(from).split("@")[1] ?? "";
  if (!fromDomain) return FAIL;
  const receivers = trustedReceivers();
  const first = (name: string) => headers.find(([n]) => n === name)?.[1];

  // Our receiver's verdict: the topmost Authentication-Results, else the highest-instance ARC-Authentication-Results.
  let receiver: Parsed | null = null;
  const ar = first("authentication-results");
  if (ar) {
    const p = parseAuthResults(ar);
    if (p && underDomain(p.authserv, receivers)) receiver = p;
  }
  const arcSets = headers.filter(([n]) => n === "arc-authentication-results").map(([, v]) => parseAuthResults(v, true)).filter((p): p is Parsed => Boolean(p));
  const top = arcSets.reduce<Parsed | null>((a, b) => (!a || (b.instance ?? 0) > (a.instance ?? 0) ? b : a), null);
  const receiverArc = top && underDomain(top.authserv, receivers) ? top : null;

  for (const r of [receiver, receiverArc]) {
    if (!r) continue;
    const direct = alignedPass(r, fromDomain);
    if (direct) return direct;
  }
  // arc=pass from our receiver: the chain is intact, so the forwarder's own verdict (an earlier instance) is genuine.
  const arcPass = [receiver, receiverArc].some((r) => r?.results.some((x) => x.method === "arc" && x.result === "pass"));
  if (arcPass && top) {
    for (const s of arcSets) {
      if (s === top || (s.instance ?? 0) >= (top.instance ?? 0) || !underDomain(s.authserv, TRUSTED_FORWARDERS)) continue;
      const v = alignedPass(s, fromDomain);
      if (v) return { ...v, method: "arc" };
    }
  }

  if (format === "postmark") {
    // Postmark's documented verdicts: its own Received-SPF (receiver=…@inbound.postmarkapp.com) and SpamAssassin tests.
    const spf = first("received-spf");
    if (spf && /^pass\b/i.test(spf.trim()) && /receiver=[^;\s]*postmarkapp\.com/i.test(spf)) {
      const d = domainOf(spf.match(/envelope-from=("?)([^";\s]+)\1/i)?.[2] ?? "");
      if (d && aligned(d, fromDomain)) return { pass: true, method: "spf", domain: d };
    }
    const tests = first("x-spam-tests");
    if (tests && /(?:^|[\s,])DKIM_VALID_AU(?:$|[\s,])/.test(tests)) return { pass: true, method: "dkim", domain: fromDomain };
  }
  return FAIL;
}

// ——— The forwarding chain ———

/** Headers that name the mailbox a letter was auto-forwarded from. */
const CHAIN_HEADERS = ["x-forwarded-for", "delivered-to", "return-path", "resent-from", "resent-sender", "x-original-from"];

/** Normalize a mailbox: lowercase; Gmail's forwarding envelope "name+caf_=alias=host@gmail.com" → name@gmail.com. */
export function normMailbox(a: string) {
  const s = a.trim().toLowerCase();
  const at = s.lastIndexOf("@");
  if (at < 1) return s;
  let local = s.slice(0, at);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  const host = s.slice(at + 1);
  if (host === "gmail.com" || host === "googlemail.com") local = local.replace(/\./g, "");
  return `${local}@${host === "googlemail.com" ? "gmail.com" : host}`;
}

/** Did the letter pass through one of these mailboxes (the user's confirmed forwarding mailbox or account e-mail)? */
export function forwardedFrom(headers: Record<string, string>, mailboxes: string[]) {
  const want = new Set(mailboxes.filter(Boolean).map(normMailbox));
  if (!want.size) return false;
  for (const h of CHAIN_HEADERS) {
    const v = headers[h];
    if (!v) continue;
    for (const m of v.slice(0, 5000).matchAll(/[A-Za-z0-9._%+=-]{1,128}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g)) if (want.has(normMailbox(m[0]))) return true;
  }
  return false;
}

// ——— Sender ↔ company ———

/** Applicant-tracking systems and job boards that send an employer's decisions on its behalf. */
const ATS_DOMAINS = [
  "greenhouse.io", "greenhouse-mail.io", "lever.co", "hire.lever.co", "ashbyhq.com", "workablemail.com", "workable.com", "hh.kz", "hh.ru", "headhunter.kz",
  "myworkday.com", "myworkdayjobs.com", "workday.com", "smartrecruiters.com", "smartrecruitersmail.com", "recruitee.com", "bamboohr.com", "teamtailor.com",
  "teamtailor-mail.com", "jobvite.com", "icims.com", "personio.de", "personio.com", "breezy.hr", "jazzhr.com", "successfactors.com", "taleo.net", "rabota.kz", "enbek.kz",
];
export const isAtsDomain = (domain: string) => underDomain(domain.toLowerCase(), ATS_DOMAINS);

const GENERIC = new Set(["mail", "email", "e-mail", "smtp", "mx", "noreply", "no-reply", "info", "jobs", "careers", "hr", "us", "eu", "em", "mg", "send", "notify", "notifications", "talent", "recruiting", "www", "co", "com", "kz", "ru", "org", "net"]);

/**
 * Does an (authenticated) sender domain name this company? «jobs@mail.acme.com» ↔ «Acme Inc», «kaspi.kz» ↔ «Kaspi Bank».
 * A label may be the company name or a shorter form of it, never a longer string that merely contains it
 * («acme-careers.io» is anyone's domain). Display names don't count.
 */
export function domainNamesCompany(domain: string, company: string) {
  const slug = company.toLowerCase().replace(/\b(?:inc|llc|ltd|llp|gmbh|corp|corporation|company|group|jsc)\b/g, "").replace(/[^a-z0-9]/g, "");
  if (slug.length < 3) return false;
  const labels = domain.toLowerCase().split(".").slice(0, -1).filter((p) => p.length >= 3 && !GENERIC.has(p));
  return labels.some((l) => {
    const flat = l.replace(/-/g, "");
    return flat === slug || (flat.length >= 4 && slug.startsWith(flat));
  });
}
