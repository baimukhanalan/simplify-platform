// PII / secret scrubbing for everything the monitoring layer stores or forwards (pure; no Node APIs).
// Applied to messages, stacks, routes and meta before they reach the DB or Sentry.

const SECRET_KEYS = "access_token|refresh_token|id_token|token|secret|client_secret|password|passwd|pwd|api_key|apikey|authorization|cookie|otp|signature";
/** Generic names that are secrets only as URL query parameters (OAuth `code`, `state`, signed-link `sig`…). */
const QUERY_KEYS = "code|key|sig|state|session|auth|pin|t|k";

const RULES: [RegExp, string | ((m: string, ...a: string[]) => string)][] = [
  // Authorization headers / bearer-style credentials.
  [/\b(Bearer|Basic|Token|Digest)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]"],
  // JSON Web Tokens (header.payload.signature).
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  // Provider API keys (Anthropic sk-ant-…, generic sk_live_/pk_live_, GitHub ghp_ etc.).
  [/\b(?:sk|pk|rk)[-_](?:ant[-_]|live[-_]|test[-_])?[A-Za-z0-9_-]{12,}/g, "[key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[key]"],
  // key=value / key: value pairs with secret-ish names (query strings, form bodies, JSON-ish logs).
  [new RegExp(`(["']?\\b[A-Za-z_]{0,40}?(?:${SECRET_KEYS})\\b["']?\\s*[=:]\\s*["']?)(?!\\[|(?:Bearer|Basic|Token|Digest)\\s)([^\\s&"',;}\\]]+)`, "gi"), (_m, k: string) => `${k}[redacted]`],
  [new RegExp(`([?&](?:${QUERY_KEYS})=)([^\\s&#"']+)`, "gi"), (_m, k: string) => `${k}[redacted]`],
  // E-mail addresses.
  [/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}/g, "[email]"],
  // Card numbers (4×4 groups) before phone rules so they don't half-match.
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/g, "[card]"],
  // Phone numbers: international (+7 701 123 45 67) and KZ/RU local (8 701 123-45-67, 87011234567).
  [/\+\d[\d\s().-]{8,17}\d/g, "[phone]"],
  [/\b[78][\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g, "[phone]"],
  // Kazakh IIN / BIN (12 digits).
  [/\b\d{12}\b/g, "[iin]"],
  // Long opaque tokens (hh.kz / Kaspi access tokens, API secrets): 32+ chars mixing letters and digits.
  [/[A-Za-z0-9+_=-]{32,}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? "[token]" : m)],
];

/** Scrub a single string. */
export function scrub(text: string, max = 20_000): string {
  // Bounded input keeps every rule linear-time on hostile / huge strings.
  let out = text.length > max ? text.slice(0, max) : text;
  for (const [re, rep] of RULES) out = out.replace(re, rep as string);
  return out;
}

const SECRET_KEY_RE = new RegExp(`^(?:${SECRET_KEYS}|.*(?:token|secret|password|cookie|authorization))$`, "i");

/** Deep-scrub a JSON-able value: strings are scrubbed, secret-named keys dropped to "[redacted]". Bounded depth/size. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (v == null || typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return scrub(v.length > 2000 ? `${v.slice(0, 2000)}…` : v);
  if (depth > 4) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => scrubValue(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 40)) out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : scrubValue(x, depth + 1);
    return out;
  }
  return String(v);
}

/** Path without query string / hash; ids replaced so the route groups (e.g. /app/applications/[id]). */
export function normalizeRoute(route: string | undefined | null): string {
  if (!route) return "";
  let p = route.trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch { /* keep as is */ }
  p = p.split(/[?#]/)[0] || "/";
  return scrub(
    p
      .split("/")
      .map((seg) => (/^\[.+\]$/.test(seg) ? seg : /^(?:c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|\d+|[A-Za-z0-9_-]{24,})$/i.test(seg) ? "[id]" : seg))
      .join("/"),
  ).slice(0, 300);
}
