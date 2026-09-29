#!/usr/bin/env node
// Register the Telegram webhook (owner task, run once per environment / after changing the secret or domain).
//
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs            # uses APP_URL
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs https://simplify.kz
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs --info     # show the current webhook
//   node --env-file=.env.local scripts/telegram-set-webhook.mjs --delete   # remove it
//
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (1–256 chars of A-Z a-z 0-9 _ -), APP_URL (or pass the base URL).
// Also sets the bot's command menu (/status, /stop).

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const args = process.argv.slice(2);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function call(method, payload = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) fail(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

if (!token) fail("TELEGRAM_BOT_TOKEN is not set");

if (args.includes("--info")) {
  const info = await call("getWebhookInfo");
  console.log(JSON.stringify({ ...info, url: info.url || "(none)" }, null, 2));
  process.exit(0);
}

if (args.includes("--delete")) {
  await call("deleteWebhook", { drop_pending_updates: false });
  console.log("✓ webhook removed");
  process.exit(0);
}

if (!secret) fail("TELEGRAM_WEBHOOK_SECRET is not set (e.g. `openssl rand -hex 32`)");
if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) fail("TELEGRAM_WEBHOOK_SECRET may contain only A-Z a-z 0-9 _ - (1–256 chars)");

const baseArg = args.find((a) => !a.startsWith("--"));
const base = (baseArg || process.env.APP_URL || "").trim().replace(/\/+$/, "");
if (!base) fail("pass the public base URL or set APP_URL");
let url;
try {
  url = new URL("/api/telegram/webhook", base);
} catch {
  fail(`not a URL: ${base}`);
}
if (url.protocol !== "https:") fail("Telegram requires an https webhook URL");

const me = await call("getMe");
await call("setWebhook", { url: url.toString(), secret_token: secret, allowed_updates: ["message"], max_connections: 40, drop_pending_updates: false });
await call("setMyCommands", {
  commands: [
    { command: "status", description: "Как идёт кампания" },
    { command: "stop", description: "Отключить уведомления" },
  ],
});
const info = await call("getWebhookInfo");
console.log(`✓ @${me.username}: webhook → ${info.url}`);
console.log(`  pending updates: ${info.pending_update_count}${info.last_error_message ? `, last error: ${info.last_error_message}` : ""}`);
console.log(`  set TELEGRAM_BOT_USERNAME=${me.username} in the app's environment`);
