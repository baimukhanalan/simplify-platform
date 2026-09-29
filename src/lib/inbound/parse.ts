// Inbound email payloads → one normalized letter. Pure (no DB): safe to unit-test and to run on any runtime.
//
// Two formats are accepted on POST /api/inbound/email:
//   · Postmark Inbound webhook JSON (FromFull, ToFull, OriginalRecipient, TextBody, HtmlBody, Headers: [{Name, Value}]).
//   · A generic JSON { to, from, subject, text, html, messageId, headers } — what scripts/inbound-email-worker.js
//     (Cloudflare Email Routing → Worker) posts. `to` is the envelope recipient; `headers` is an object or [{name, value}].
import { z } from "zod";

/** Plain-text body kept for classification (1 MB); what is stored and shown is capped lower (BODY_MAX). */
export const TEXT_MAX = 1_000_000;
/** HTML accepted for conversion when there is no text part (2 MB of markup). */
export const HTML_MAX = 2_000_000;
/** Body stored in InboxMessage. */
export const BODY_MAX = 100_000;
export const SUBJECT_MAX = 300;
export const FROM_MAX = 320;
/** Addresses considered per letter (To + Cc + Bcc + envelope + Delivered-To…). */
export const RECIPIENTS_MAX = 50;

export type InboundLetter = {
  /** Every candidate recipient address (envelope first), lowercased, unique. */
  recipients: string[];
  from: string;
  subject: string;
  /** Plain text: the text part, else the HTML part converted to text. Capped at TEXT_MAX. */
  text: string;
  /** Message-ID without angle brackets, or null. */
  messageId: string | null;
  /** Header names lowercased; repeated headers joined with ", ". */
  headers: Record<string, string>;
  format: "postmark" | "generic";
};

const str = z.string().max(5_000_000);
const headerList = z.array(z.object({ Name: z.string().max(200), Value: z.string().max(20_000) }).loose()).max(500);
const addrFull = z.array(z.object({ Email: z.string().max(FROM_MAX).optional().default(""), Name: z.string().max(FROM_MAX).optional().default("") }).loose()).max(RECIPIENTS_MAX);

const postmark = z
  .object({
    From: str.optional().default(""),
    FromFull: z.object({ Email: z.string().max(FROM_MAX).optional().default(""), Name: z.string().max(FROM_MAX).optional().default("") }).loose().optional(),
    To: str.optional().default(""),
    ToFull: addrFull.optional().default([]),
    Cc: str.optional().default(""),
    CcFull: addrFull.optional().default([]),
    Bcc: str.optional().default(""),
    BccFull: addrFull.optional().default([]),
    OriginalRecipient: z.string().max(FROM_MAX).optional().default(""),
    Subject: str.optional().default(""),
    TextBody: str.optional().default(""),
    HtmlBody: str.optional().default(""),
    StrippedTextReply: str.optional().default(""),
    MessageID: z.string().max(1000).optional().default(""),
    Headers: headerList.optional().default([]),
  })
  .loose();

const headerInput = z.union([
  z.record(z.string().max(200), z.union([z.string().max(20_000), z.array(z.string().max(20_000)).max(50)])),
  z.array(z.object({ name: z.string().max(200), value: z.string().max(20_000) }).loose()).max(500),
]);

const generic = z
  .object({
    to: z.union([z.string().max(20_000), z.array(z.string().max(FROM_MAX)).max(RECIPIENTS_MAX)]),
    from: z.string().max(20_000).optional().default(""),
    subject: str.optional().default(""),
    text: str.optional().default(""),
    html: str.optional().default(""),
    messageId: z.string().max(1000).nullish(),
    headers: headerInput.optional(),
  })
  .loose();

/** Postmark if it carries Postmark's PascalCase fields; generic if it has a lowercase `to`. */
export function detectFormat(body: unknown): "postmark" | "generic" | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const o = body as Record<string, unknown>;
  if ("FromFull" in o || "TextBody" in o || "HtmlBody" in o || "OriginalRecipient" in o || "ToFull" in o) return "postmark";
  if ("to" in o) return "generic";
  return null;
}

/** Parse a webhook body (already JSON-decoded). Null = not a letter we understand. */
export function parseInbound(body: unknown): InboundLetter | null {
  const format = detectFormat(body);
  if (format === "postmark") {
    const r = postmark.safeParse(body);
    if (!r.success) return null;
    const p = r.data;
    const headers = normHeaders(p.Headers.map((h) => [h.Name, h.Value]));
    const from = p.FromFull?.Email ? (p.FromFull.Name ? `${p.FromFull.Name} <${p.FromFull.Email}>` : p.FromFull.Email) : p.From;
    const recipients = uniqAddrs([
      p.OriginalRecipient,
      headers["x-original-to"] ?? "",
      headers["delivered-to"] ?? "",
      headers["x-forwarded-to"] ?? "",
      ...p.ToFull.map((a) => a.Email),
      ...p.CcFull.map((a) => a.Email),
      ...p.BccFull.map((a) => a.Email),
      p.To,
      p.Cc,
      p.Bcc,
    ]);
    const text = bodyText(p.TextBody, p.HtmlBody);
    return finish({ recipients, from, subject: p.Subject, text, messageId: cleanId(headers["message-id"] || p.MessageID), headers, format });
  }
  if (format === "generic") {
    const r = generic.safeParse(body);
    if (!r.success) return null;
    const g = r.data;
    const pairs: [string, string][] = !g.headers
      ? []
      : Array.isArray(g.headers)
        ? g.headers.map((h) => [h.name, h.value])
        : Object.entries(g.headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x] as [string, string]) : [[k, v] as [string, string]]));
    const headers = normHeaders(pairs);
    const recipients = uniqAddrs([
      ...(Array.isArray(g.to) ? g.to : [g.to]),
      headers["x-original-to"] ?? "",
      headers["delivered-to"] ?? "",
      headers["x-forwarded-to"] ?? "",
      headers["to"] ?? "",
      headers["cc"] ?? "",
    ]);
    const text = bodyText(g.text, g.html);
    return finish({ recipients, from: g.from || headers["from"] || "", subject: g.subject || headers["subject"] || "", text, messageId: cleanId(g.messageId || headers["message-id"] || ""), headers, format });
  }
  return null;
}

function finish(l: InboundLetter): InboundLetter | null {
  if (!l.recipients.length) return null;
  return { ...l, from: oneLine(l.from).slice(0, FROM_MAX), subject: decodeMimeWords(oneLine(l.subject)).slice(0, SUBJECT_MAX) };
}

const oneLine = (s: string) => s.replace(/\0/g, "").replace(/\s+/g, " ").trim();

function normHeaders(pairs: [string, string][]) {
  const out: Record<string, string> = {};
  for (const [k, v] of pairs.slice(0, 500)) {
    const key = String(k).trim().toLowerCase();
    if (!key) continue;
    const val = oneLine(String(v)).slice(0, 5000);
    out[key] = out[key] ? `${out[key]}, ${val}`.slice(0, 20_000) : val;
  }
  return out;
}

const cleanId = (id: string) => {
  const v = oneLine(id).replace(/^<|>$/g, "").trim().slice(0, 500);
  return v || null;
};

/** Pull e-mail addresses out of header-ish strings ("Name" <a@b>, c@d; …). */
export function extractAddresses(s: string): string[] {
  const out: string[] = [];
  const re = /[A-Za-z0-9._%+'=!#$&*/?^`{|}~-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}/g;
  let m: RegExpExecArray | null;
  const src = s.slice(0, 20_000);
  while ((m = re.exec(src)) && out.length < RECIPIENTS_MAX) out.push(m[0].toLowerCase());
  return out;
}

function uniqAddrs(list: string[]) {
  const seen = new Set<string>();
  for (const s of list) for (const a of extractAddresses(s ?? "")) if (seen.size < RECIPIENTS_MAX) seen.add(a);
  return [...seen];
}

function bodyText(text: string, html: string) {
  const t = text.replace(/\0/g, "").trim();
  if (t) return t.slice(0, TEXT_MAX);
  return html ? htmlToText(html.slice(0, HTML_MAX)).slice(0, TEXT_MAX) : "";
}

/** RFC 2047 encoded words in a subject (=?UTF-8?B?…?= / =?UTF-8?Q?…?=), when a provider passed them through raw. */
export function decodeMimeWords(s: string) {
  if (!s.includes("=?")) return s;
  return s.replace(/=\?([\w-]{1,40})\?([BbQq])\?([^?]{0,2000})\?=(?:\s+(?==\?))?/g, (all, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
    } catch {
      return all;
    }
  });
}

// ——— HTML → text (linear scanner: no regex backtracking on hostile markup) ———

const DROP = new Set(["script", "style", "head", "title", "noscript", "template", "svg", "iframe", "object"]);
const BREAK = new Set(["br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article", "header", "footer", "blockquote", "hr", "ul", "ol"]);
const ENT: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", mdash: "—", ndash: "–", hellip: "…",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", zwnj: "", zwj: "",
};

export function decodeEntities(s: string) {
  return s.replace(/&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
    }
    return ENT[e.toLowerCase()] ?? all;
  });
}

export function htmlToText(html: string): string {
  const s = html.slice(0, HTML_MAX);
  const out: string[] = [];
  let i = 0;
  let href: string | null = null;
  let linkStart = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      out.push(s.slice(i));
      break;
    }
    if (lt > i) out.push(s.slice(i, lt));
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    const gt = s.indexOf(">", lt + 1);
    if (gt < 0) break; // an unterminated tag: drop the rest
    const inner = s.slice(lt + 1, gt);
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9]{0,15})/.exec(inner);
    i = gt + 1;
    if (!m) continue;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!closing && DROP.has(name) && !inner.endsWith("/")) {
      const end = s.toLowerCase().indexOf(`</${name}`, i);
      if (end < 0) break;
      const close = s.indexOf(">", end);
      i = close < 0 ? s.length : close + 1;
      continue;
    }
    if (name === "a") {
      if (!closing) {
        const h = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(inner);
        href = h ? decodeEntities(h[2] ?? h[3] ?? h[4] ?? "").trim() : null;
        linkStart = out.length;
      } else if (href) {
        const label = decodeEntities(out.slice(linkStart).join("")).replace(/\s+/g, " ").trim();
        if (/^https?:\/\//i.test(href) && !label.includes(href)) out.push(` (${href})`);
        href = null;
      }
      continue;
    }
    if (BREAK.has(name)) out.push("\n");
    else if (name === "td" || name === "th") out.push(" ");
  }
  return decodeEntities(out.join(""))
    .replace(/\r/g, "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
