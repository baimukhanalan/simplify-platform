// Telegram channel: message formatting/escaping, Bot API client retries, webhook auth, link codes (expiry, reuse,
// racing users), delivery idempotency, notifyPrefs merge, and 200 concurrent webhook updates.
// DB tests use a throwaway SQLite database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-tg-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.SIMPLIFY_MODE = "simulation";
process.env.TELEGRAM_BOT_TOKEN = "123456:TEST-token";
process.env.TELEGRAM_BOT_USERNAME = "SimplifyKzBot";
process.env.TELEGRAM_WEBHOOK_SECRET = "hook_secret-0123456789";
process.env.APP_URL = "https://simplify.kz";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

import { esc, clip, formatNotification, OPEN_BUTTON, TEXT } from "../src/lib/telegram/format";
import { absoluteAppUrl, chatIsLinked, linkCodeExpiry, linkCodeValid, LINK_TTL_MS, newLinkCode, telegramMode } from "../src/lib/telegram/config";
import { callBot, sendMessagePayload } from "../src/lib/telegram/client";

// ——— fetch stub: records Bot API calls; `respond` decides the answer ———
type Call = { method: string; body: Record<string, unknown> };
let calls: Call[] = [];
let respond: (c: Call) => { status?: number; body: unknown } = () => ({ body: { ok: true, result: { message_id: 1 } } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const m = /api\.telegram\.org\/bot[^/]+\/(\w+)$/.exec(url);
  if (!m) return realFetch(input, init);
  const call = { method: m[1], body: JSON.parse(String(init?.body ?? "{}")) };
  calls.push(call);
  await new Promise((r) => setTimeout(r, 2));
  const r = respond(call);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

// ——— 1 · formatting ———
describe("formatting", () => {
  test("HTML is escaped: tags, ampersands and quotes in titles/bodies never become markup", () => {
    assert.equal(esc(`<b>A & B</b> "q"`), "&lt;b&gt;A &amp; B&lt;/b&gt; &quot;q&quot;");
    const m = formatNotification({ type: "interview", title: "Новое интервью", body: "Acme <script>alert(1)</script> & Co · Data Analyst", href: "/app/interviews" });
    assert.ok(m.html.startsWith("🗓 <b>Тебя пригласили на интервью</b>"));
    assert.ok(m.html.includes("Acme &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co"));
    assert.ok(!/<script/.test(m.html));
    // Only <b> tags are ours.
    assert.deepEqual([...m.html.matchAll(/<\/?([a-z]+)/g)].map((x) => x[1]), ["b", "b"]);
  });

  test("per-type wording in Russian; generic engine titles replaced, specific ones kept as a second line", () => {
    const offer = formatNotification({ type: "offer", title: "YOU GOT THE OFFER", body: "Kaspi · BI Analyst", href: "/app/offers" });
    assert.ok(offer.html.startsWith("🎉 <b>Пришёл оффер</b>\n\nKaspi"));
    const hh = formatNotification({ type: "interview", title: "Приглашение на hh.kz", body: "Analyst", href: "" });
    assert.ok(hh.html.includes("\nПриглашение на hh.kz\n"));
    const hired = formatNotification({ type: "hired", title: "HIRED: Data Analyst — Kaspi", body: "Поздравляем!", href: "/app/hired" });
    assert.ok(hired.html.startsWith("🏆 <b>HIRED: Data Analyst — Kaspi</b>"));
    const unknown = formatNotification({ type: "whatever", title: "", body: "", href: "" });
    assert.equal(unknown.html, "🔔 <b>Новое уведомление</b>");
    assert.equal(formatNotification({ type: "rejection", title: "Отказ на hh.kz", body: "", href: "" }).silent, true);
    assert.equal(offer.silent, false);
  });

  test("«Открыть в Simplify» → absolute https app URL; foreign / protocol-relative / non-https links get no button", () => {
    const m = formatNotification({ type: "offer", title: "t", body: "b", href: "/app/offers?id=1" });
    assert.deepEqual(m.buttons, [{ text: OPEN_BUTTON, url: "https://simplify.kz/app/offers?id=1" }]);
    assert.equal(formatNotification({ type: "offer", title: "t", body: "", href: "" }).buttons[0].url, "https://simplify.kz/app");
    assert.equal(absoluteAppUrl("https://evil.com/x"), null);
    assert.equal(absoluteAppUrl("//evil.com/x"), null);
    assert.equal(absoluteAppUrl("/\\evil.com"), null);
    assert.equal(absoluteAppUrl("/app", "http://localhost:3210"), null);
    assert.equal(formatNotification({ type: "offer", title: "t", body: "", href: "/app" }, null).buttons.length, 0);
  });

  test("huge bodies (even all-'&', 5× on escaping) fit Telegram's 4096 limit; clip never splits an emoji", () => {
    for (const body of ["&".repeat(50_000), "я".repeat(50_000), "😀".repeat(10_000)]) {
      const m = formatNotification({ type: "info", title: "x".repeat(1000), body, href: "/app" });
      assert.ok(m.html.length <= 4096, `length ${m.html.length}`);
      assert.ok(m.html.length > 200, "the body is shortened, not dropped");
    }
    assert.equal(clip("😀😀😀", 2), "😀…");
    const p = sendMessagePayload("1", "<b>x</b>", { silent: true, buttons: [{ text: "a", url: "https://simplify.kz/app" }] });
    assert.equal(p.parse_mode, "HTML");
    assert.equal(p.disable_notification, true);
    assert.deepEqual(p.reply_markup, { inline_keyboard: [[{ text: "a", url: "https://simplify.kz/app" }]] });
  });

  test("bot texts: gender-neutral, no «тест»/«демо» wording about the product", () => {
    const all = Object.values(TEXT).map((t) => (typeof t === "function" ? t("Айгерим") : t)).join("\n");
    assert.ok(!/(подключил|отключил|сделал|получил)\b/i.test(all));
    assert.ok(!/демо|симуляц|имитац|тестов(ое|ое сообщение)\b(?! задан)/i.test(all.replace(/тестовые задания|тестовое задание/g, "")));
  });
});

// ——— 2 · link codes ———
describe("link codes", () => {
  test("format fits /start payload, expires after 15 min, garbage is rejected", () => {
    const now = Date.now();
    const code = newLinkCode(now);
    assert.match(code, /^[A-Za-z0-9_-]{1,64}$/);
    assert.ok(Math.abs(linkCodeExpiry(code)! - (now + LINK_TTL_MS)) < 1000);
    assert.equal(linkCodeValid(code, now + LINK_TTL_MS - 2000), true);
    assert.equal(linkCodeValid(code, now + LINK_TTL_MS + 1000), false);
    for (const bad of ["", "abc", "zzzzzz_nothex", `${code}x`, "../../etc", "A".repeat(64)]) assert.equal(linkCodeExpiry(bad), null, bad);
    assert.notEqual(newLinkCode(now), code, "random part differs");
  });

  test("channel mode and which chats count as linked", () => {
    assert.equal(telegramMode(), "live");
    assert.equal(chatIsLinked("sim:u1", "live"), false);
    assert.equal(chatIsLinked("sim:u1", "sim"), true);
    assert.equal(chatIsLinked("12345", "live"), true);
    assert.equal(chatIsLinked(null, "live"), false);
  });
});

// ——— 3 · Bot API client ———
describe("Bot API client", () => {
  beforeEach(() => { calls = []; });

  test("429 is retried after retry_after; 403 is final; network errors never throw", async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => { waits.push(ms); };
    let n = 0;
    respond = () => (++n === 1 ? { status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 3 } } } : { body: { ok: true, result: { message_id: 7 } } });
    const r = await callBot("sendMessage", { chat_id: 1, text: "x" }, { sleep });
    assert.equal(r.ok, true);
    assert.deepEqual(waits, [3000]);
    assert.equal(calls.length, 2);

    respond = () => ({ status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    const f = await callBot("sendMessage", { chat_id: 1, text: "x" }, { sleep });
    assert.equal(f.ok, false);
    assert.equal(!f.ok && f.status, 403);

    // A long retry_after is not waited out inside a request.
    respond = () => ({ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 60 } } });
    const w: number[] = [];
    const g = await callBot("sendMessage", { chat_id: 1, text: "x" }, { sleep: async (ms) => { w.push(ms); } });
    assert.equal(!g.ok && g.status, 429);
    assert.deepEqual(w, []);

    const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const h = await callBot("sendMessage", { chat_id: 1 }, { fetchImpl: boom, sleep });
    assert.deepEqual(h, { ok: false, status: 0, description: "network error" });
    const none = await callBot("getMe", {}, { token: "" });
    assert.equal(none.ok, false);
    respond = () => ({ body: { ok: true, result: { message_id: 1 } } });
  });
});

// ——— DB ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let route: typeof import("../src/app/api/telegram/webhook/route");
let hook: typeof import("../src/lib/telegram/webhook");
let link: typeof import("../src/lib/telegram/link");
let notify: typeof import("../src/lib/notify/telegram");
let status: typeof import("../src/lib/telegram/status");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  route = await import("../src/app/api/telegram/webhook/route");
  hook = await import("../src/lib/telegram/webhook");
  link = await import("../src/lib/telegram/link");
  notify = await import("../src/lib/notify/telegram");
  status = await import("../src/lib/telegram/status");
});
after(async () => {
  globalThis.fetch = realFetch;
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
const makeUser = (data: Record<string, unknown> = {}) => db.user.create({ data: { email: `telegram-test-${++seq}-${Date.now()}@example.com`, passwordHash: "x", name: `Айгерим ${seq}`, ...data } });

let upd = 1000;
const update = (chatId: number, text: string, over: Record<string, unknown> = {}) => ({ update_id: ++upd, message: { message_id: upd, date: 0, chat: { id: chatId, type: "private" }, from: { id: chatId, is_bot: false }, text }, ...over });
const post = (body: unknown, secret: string | null = process.env.TELEGRAM_WEBHOOK_SECRET!) =>
  route.POST(new Request("https://simplify.kz/api/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", ...(secret == null ? {} : { "x-telegram-bot-api-secret-token": secret }) }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("webhook auth", () => {
  test("missing or wrong secret → 401; right secret → 200 with the reply as a Bot API call", async () => {
    assert.equal((await post(update(1, "/help"), null)).status, 401);
    assert.equal((await post(update(1, "/help"), "wrong")).status, 401);
    assert.equal((await post(update(1, "/help"), process.env.TELEGRAM_WEBHOOK_SECRET + "x")).status, 401);
    assert.equal((await post(update(1, "/help"), "")).status, 401);
    const ok = await post(update(1, "/help"));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.method, "sendMessage");
    assert.equal(body.chat_id, 1);
    assert.equal(body.text, TEXT.notLinked);
  });

  test("no bot configured → 404; oversize → 413; malformed JSON → 200 (never retried)", async () => {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal((await post(update(1, "/help"))).status, 404);
    process.env.TELEGRAM_BOT_TOKEN = tok;
    assert.equal((await post("x".repeat(70_000))).status, 413);
    assert.equal((await post("{not json")).status, 200);
    assert.deepEqual(await (await post({ hello: "world" })).json(), { ok: true });
  });

  test("group chats are never linked", async () => {
    const u = await makeUser();
    const { code } = await link.issueLinkCode(u.id);
    const r = await (await post(update(-100500, `/start ${code}`, { message: { chat: { id: -100500, type: "group" }, text: `/start ${code}` } }))).json();
    assert.equal(r.text, TEXT.groupOnly);
    assert.equal((await db.user.findUnique({ where: { id: u.id } }))!.telegramChatId, null);
  });
});

describe("linking: /start, /stop, /status", () => {
  test("valid code links the chat, is consumed, and a replayed /start answers «already linked»", async () => {
    const u = await makeUser();
    const { code } = await link.issueLinkCode(u.id);
    const r = await (await post(update(501, `/start ${code}`))).json();
    assert.ok(r.text.startsWith("✅ <b>Telegram подключён</b>"));
    const row = (await db.user.findUnique({ where: { id: u.id } }))!;
    assert.equal(row.telegramChatId, "501");
    assert.equal(row.telegramLinkCode, null);
    assert.ok(row.telegramLinkedAt);
    // Telegram retry of the same update_id: silently acknowledged.
    const same = update(501, `/start ${code}`);
    await post(same);
    assert.deepEqual(await (await post(same)).json(), { ok: true });
    // The code is single-use: from the same chat → already linked; from another chat → invalid.
    assert.equal((await (await post(update(501, `/start ${code}`))).json()).text, TEXT.alreadyLinked);
    assert.equal((await (await post(update(502, `/start ${code}`))).json()).text, TEXT.invalid);
    assert.equal((await db.user.findUnique({ where: { id: u.id } }))!.telegramChatId, "501");
    assert.ok(await db.event.findFirst({ where: { userId: u.id, type: "telegram" } }));
  });

  test("expired code → «устарела», code cleared, nothing linked", async () => {
    const u = await makeUser();
    const { code } = await link.issueLinkCode(u.id, Date.now() - LINK_TTL_MS - 5000);
    assert.equal((await (await post(update(601, `/start ${code}`))).json()).text, TEXT.expired);
    const row = (await db.user.findUnique({ where: { id: u.id } }))!;
    assert.equal(row.telegramChatId, null);
    assert.equal(row.telegramLinkCode, null);
    // A fresh code replaces an old one: the old one stops working.
    const a = await link.issueLinkCode(u.id);
    const b = await link.issueLinkCode(u.id);
    assert.equal((await (await post(update(601, `/start ${a.code}`))).json()).text, TEXT.invalid);
    assert.ok((await (await post(update(601, `/start ${b.code}`))).json()).text.startsWith("✅"));
  });

  test("one user ↔ one chat: a chat moves to another user only with that user's valid code; relinking replaces the old chat", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await post(update(701, `/start ${(await link.issueLinkCode(a.id)).code}`));
    // B cannot take the chat without a code.
    assert.equal((await (await post(update(701, "/start"))).json()).text, TEXT.alreadyLinked);
    assert.equal((await (await post(update(701, "/start not-a-code"))).json()).text, TEXT.invalid);
    assert.equal((await db.user.findUnique({ where: { id: a.id } }))!.telegramChatId, "701");
    // With B's code the chat moves to B, A is unlinked.
    await post(update(701, `/start ${(await link.issueLinkCode(b.id)).code}`));
    assert.equal((await db.user.findUnique({ where: { id: a.id } }))!.telegramChatId, null);
    assert.equal((await db.user.findUnique({ where: { id: b.id } }))!.telegramChatId, "701");
    // B links a different chat: the old one is simply replaced.
    await post(update(702, `/start ${(await link.issueLinkCode(b.id)).code}`));
    assert.equal((await db.user.findUnique({ where: { id: b.id } }))!.telegramChatId, "702");
    assert.equal(await db.user.count({ where: { telegramChatId: "701" } }), 0);
  });

  test("users racing the same chat (50 rounds × 3 users): exactly one ends up linked", async () => {
    for (let round = 0; round < 50; round++) {
      const chat = 8000 + round;
      const users = await Promise.all([makeUser(), makeUser(), makeUser()]);
      const codes = await Promise.all(users.map((u) => link.issueLinkCode(u.id)));
      const res = await Promise.all(codes.map((c) => post(update(chat, `/start ${c.code}`))));
      for (const r of res) assert.equal(r.status, 200);
      assert.equal(await db.user.count({ where: { telegramChatId: String(chat) } }), 1, `round ${round}`);
    }
  });

  test("/stop unlinks, /status summarizes the campaign, unknown text → short help", async () => {
    const u = await makeUser();
    await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - 4.5 * 86400000), endsAt: new Date(Date.now() + 55.5 * 86400000) } });
    await post(update(901, `/start ${(await link.issueLinkCode(u.id)).code}`));
    const st = (await (await post(update(901, "/status"))).json()).text as string;
    assert.match(st, /Кампания идёт/);
    assert.match(st, /День 5 из 60/);
    assert.match(st, /Отправлено: 0 заявок/);
    assert.match(st, /Впереди: 0 интервью/);
    assert.equal((await (await post(update(901, "привет"))).json()).text, TEXT.help);
    assert.equal((await (await post(update(901, "/stop"))).json()).text, TEXT.stopped);
    assert.equal((await db.user.findUnique({ where: { id: u.id } }))!.telegramChatId, null);
    assert.equal((await (await post(update(901, "/stop"))).json()).text, TEXT.notLinked, "idempotent");
    assert.equal((await (await post(update(901, "/status"))).json()).text, TEXT.notLinked);
    const noCampaign = await makeUser();
    assert.match(await status.statusText(noCampaign.id), /ещё не запущена/);
  });
});

describe("delivery", () => {
  beforeEach(() => { calls = []; respond = () => ({ body: { ok: true, result: { message_id: 1 } } }); });

  const mkNote = async (userId: string, type = "interview") => db.notification.create({ data: { userId, type, title: "Новое интервью", body: "Kaspi · Analyst", href: "/app/interviews" } });

  test("sent once even when dispatched 10× concurrently; formatted with the button", async () => {
    const u = await makeUser({ telegramChatId: "1111", telegramLinkedAt: new Date() });
    const n = await mkNote(u.id);
    await Promise.all(Array.from({ length: 10 }, () => notify.deliverTelegram(n)));
    const sends = calls.filter((c) => c.method === "sendMessage");
    assert.equal(sends.length, 1);
    assert.equal(sends[0].body.chat_id, "1111");
    assert.equal(sends[0].body.parse_mode, "HTML");
    assert.deepEqual(sends[0].body.reply_markup, { inline_keyboard: [[{ text: OPEN_BUTTON, url: "https://simplify.kz/app/interviews" }]] });
    assert.ok((await db.notification.findUnique({ where: { id: n.id } }))!.telegramSentAt);
    await notify.deliverTelegram(n);
    assert.equal(calls.length, 1, "already sent → skipped");
  });

  test("not linked / prefs.telegram === false → nothing sent; other prefs keys survive the toggle", async () => {
    const lone = await makeUser();
    await notify.deliverTelegram(await mkNote(lone.id));
    const u = await makeUser({ telegramChatId: "2222", telegramLinkedAt: new Date(), notifyPrefs: JSON.stringify({ webpush: true, email: false }) });
    assert.equal(await link.setTelegramPref(u.id, false), true);
    assert.deepEqual(JSON.parse((await db.user.findUnique({ where: { id: u.id } }))!.notifyPrefs), { webpush: true, email: false, telegram: false });
    const n = await mkNote(u.id);
    await notify.deliverTelegram(n);
    assert.equal(calls.length, 0);
    assert.equal((await db.notification.findUnique({ where: { id: n.id } }))!.telegramSentAt, null);
    await link.setTelegramPref(u.id, true);
    await notify.deliverTelegram(n);
    assert.equal(calls.length, 1);
  });

  test("concurrent prefs writers never clobber each other (CAS merge)", async () => {
    const u = await makeUser({ notifyPrefs: "{}" });
    // Another channel writing its own key with the same CAS pattern at the same time.
    const other = async (k: string) => {
      for (;;) {
        const cur = (await db.user.findUnique({ where: { id: u.id } }))!.notifyPrefs;
        const r = await db.user.updateMany({ where: { id: u.id, notifyPrefs: cur }, data: { notifyPrefs: JSON.stringify({ ...JSON.parse(cur), [k]: true }) } });
        if (r.count) return;
      }
    };
    await Promise.all([link.setTelegramPref(u.id, false), other("webpush"), other("email"), link.setTelegramPref(u.id, false)]);
    assert.deepEqual(JSON.parse((await db.user.findUnique({ where: { id: u.id } }))!.notifyPrefs), { telegram: false, webpush: true, email: true });
  });

  test("failed send releases the claim; a blocked bot (403) unlinks the chat; low-importance types are silent", async () => {
    const u = await makeUser({ telegramChatId: "3333", telegramLinkedAt: new Date() });
    respond = () => ({ status: 400, body: { ok: false, error_code: 400, description: "Bad Request: something" } });
    const n = await mkNote(u.id);
    await notify.deliverTelegram(n);
    assert.equal((await db.notification.findUnique({ where: { id: n.id } }))!.telegramSentAt, null);
    respond = () => ({ status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } });
    await notify.deliverTelegram(n);
    assert.equal((await db.user.findUnique({ where: { id: u.id } }))!.telegramChatId, null);
    respond = () => ({ body: { ok: true, result: {} } });
    const v = await makeUser({ telegramChatId: "4444", telegramLinkedAt: new Date() });
    await notify.deliverTelegram(await mkNote(v.id, "rejection"));
    assert.equal(calls.at(-1)!.body.disable_notification, true);
  });

  test("simulated chats: marked sent without any API call (simulation, no token)", async () => {
    const tok = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      assert.equal(telegramMode(), "sim");
      const u = await makeUser();
      await link.linkChatDirect(u.id, `sim:${u.id}`);
      const n = await mkNote(u.id);
      await notify.deliverTelegram(n);
      assert.equal(calls.length, 0);
      assert.ok((await db.notification.findUnique({ where: { id: n.id } }))!.telegramSentAt);
      // Live mode without a bot: nothing happens at all.
      process.env.SIMPLIFY_MODE = "live";
      assert.equal(telegramMode(), "off");
      const m = await mkNote(u.id);
      await notify.deliverTelegram(m);
      assert.equal((await db.notification.findUnique({ where: { id: m.id } }))!.telegramSentAt, null);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = tok;
      process.env.SIMPLIFY_MODE = "simulation";
    }
  });
});

describe("stress", () => {
  test("200 concurrent webhook updates (links, /status, chatter, Telegram retries) — every one answered correctly", async () => {
    hook._resetSeen();
    const users = await Promise.all(Array.from({ length: 40 }, () => makeUser()));
    const codes = await Promise.all(users.map((u) => link.issueLinkCode(u.id)));
    const updates: { body: ReturnType<typeof update>; kind: string }[] = [];
    users.forEach((_, i) => updates.push({ body: update(20_000 + i, `/start ${codes[i].code}`), kind: "start" }));
    for (let i = 0; i < 80; i++) updates.push({ body: update(30_000 + i, i % 2 ? "/status" : "что нового?"), kind: "unlinked" });
    // 40 Telegram retries of the /start updates (same update_id) and 40 more messages from the linking chats.
    for (let i = 0; i < 40; i++) updates.push({ body: updates[i].body, kind: "retry" });
    for (let i = 0; i < 40; i++) updates.push({ body: update(20_000 + i, "/help"), kind: "chatter" });
    assert.equal(updates.length, 200);
    const res = await Promise.all(updates.map((u) => post(u.body)));
    const bodies = await Promise.all(res.map((r) => r.json()));
    assert.ok(res.every((r) => r.status === 200));
    const replies = bodies.filter((b) => b.method === "sendMessage");
    // Each update_id answered exactly once (retries are acknowledged with { ok: true }).
    assert.equal(replies.length, 160);
    for (let i = 0; i < 40; i++) {
      const row = (await db.user.findUnique({ where: { id: users[i].id } }))!;
      assert.equal(row.telegramChatId, String(20_000 + i));
      assert.equal(row.telegramLinkCode, null);
    }
    assert.ok(bodies.slice(40, 120).every((b) => b.text === TEXT.notLinked));
  });
});
