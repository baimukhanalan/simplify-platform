// Cloudflare Email Worker: <alias>@in.simplify.kz → POST https://<app>/api/inbound/email
//
// Personal forwarding addresses ("Пересылка писем" on /app/inbox) receive employer mail that users auto-forward from
// Gmail / Outlook / Mail.ru / Yandex. This Worker parses each raw message and hands it to the app as generic JSON:
//   { to, from, subject, text, html, messageId, headers: [{ name, value }] }
// The app classifies it with Inbox Intelligence (or, for a forwarding-confirmation letter, shows the code to the user).
//
// ——— Setup (once) ———
// 1. DNS: add the receiving domain (default in.simplify.kz) to Cloudflare. Dashboard → Email → Email Routing →
//    enable for the zone (Cloudflare adds the MX + SPF records for in.simplify.kz).
// 2. Worker:
//      mkdir inbound-email && cd inbound-email
//      npm init -y && npm i postal-mime
//      cp <repo>/scripts/inbound-email-worker.js src/index.js
//    wrangler.toml:
//      name = "simplify-inbound-email"
//      main = "src/index.js"
//      compatibility_date = "2025-01-01"
//      [vars]
//      INBOUND_URL = "https://<your-app-domain>/api/inbound/email"
//    Secret (the same value as INBOUND_EMAIL_SECRET in the app's environment):
//      npx wrangler secret put INBOUND_EMAIL_SECRET
//      npx wrangler deploy
// 3. Email Routing → Routing rules → Catch-all address → Action "Send to a Worker" → simplify-inbound-email.
// 4. App env (Vercel): INBOUND_EMAIL_SECRET=<same secret>, INBOUND_EMAIL_DOMAIN=in.simplify.kz (if different).
// 5. Check: send a letter to your own alias (copy it from /app/inbox) — it shows up in the inbox within seconds.
//
// Behaviour: the Worker never rejects a message (a bounce could make Gmail switch forwarding off); failures are logged
// (`npx wrangler tail`). Unknown aliases are ignored by the app with 200. Letters above MAX_RAW are skipped. A 429/5xx
// from the app is retried a few times with backoff within the Worker's time budget.
//
// Postmark alternative: point a Postmark Inbound stream at https://inbound:<secret>@<app>/api/inbound/email (or
// ...?token=<secret>) — the endpoint accepts Postmark's JSON as is; no Worker needed.

import PostalMime from "postal-mime";

const MAX_RAW = 10 * 1024 * 1024; // 10 MB of MIME (attachments included); the app keeps 1 MB of text
const TEXT_MAX = 1_000_000;
const HTML_MAX = 2_000_000;
const KEEP_HEADERS = new Set([
  "message-id", "date", "from", "to", "cc", "subject", "delivered-to", "x-original-to", "x-forwarded-to", "x-forwarded-for",
  "list-id", "list-unsubscribe", "precedence", "auto-submitted", "x-spam-flag", "x-spam-status", "reply-to",
]);

const worker = {
  async email(message, env, ctx) {
    if (message.rawSize > MAX_RAW) {
      console.warn("inbound: skipped oversized message", message.rawSize);
      return;
    }
    let parsed;
    try {
      const raw = await new Response(message.raw).arrayBuffer();
      parsed = await PostalMime.parse(raw);
    } catch (e) {
      console.error("inbound: MIME parse failed", e);
      return;
    }
    const headers = [];
    for (const [name, value] of message.headers) if (KEEP_HEADERS.has(name.toLowerCase())) headers.push({ name, value: String(value).slice(0, 5000) });
    const fromHeader = parsed.from ? (parsed.from.name ? `${parsed.from.name} <${parsed.from.address}>` : parsed.from.address) : message.from;
    const payload = {
      to: message.to, // the envelope recipient: <alias>@in.simplify.kz even when To: says the user's own mailbox
      from: fromHeader || message.from,
      subject: parsed.subject || "",
      text: (parsed.text || "").slice(0, TEXT_MAX),
      html: parsed.text ? "" : (parsed.html || "").slice(0, HTML_MAX),
      messageId: parsed.messageId || message.headers.get("message-id") || null,
      headers,
    };
    ctx.waitUntil(post(env, payload));
  },
};

export default worker;

async function post(env, payload) {
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(env.INBOUND_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-inbound-secret": env.INBOUND_EMAIL_SECRET },
        body,
      });
      if (res.ok) return;
      if (res.status !== 429 && res.status < 500) {
        console.error("inbound: app rejected the letter", res.status, await res.text().catch(() => ""));
        return;
      }
    } catch (e) {
      console.error("inbound: POST failed", e);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  console.error("inbound: gave up after retries", payload.messageId);
}
