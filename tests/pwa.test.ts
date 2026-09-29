// PWA: manifest, service worker, Web Push subscriptions and delivery (authz, endpoint takeover, 404/410 cleanup,
// prefs, idempotent dispatch, SSRF guard, concurrency). The push service is mocked through the injected sender.
// DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-pwa-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BLgMbqUpBjutTDb9_IYdCEKVSmGIcknGvW6O6pewxn6ok2JL9ntboHPdv5kuWxgOHjb3K0Ok8svJiyyNPIzXqL8";
process.env.VAPID_PRIVATE_KEY = "I8bZiDyAempr8CmQeCsXzTEGDQ6MgzuBisJJUcl3FDw";
process.env.VAPID_SUBJECT = "mailto:support@simplify.kz";

type Db = typeof import("../src/lib/db").db;
let db: Db;
let wp: typeof import("../src/lib/notify/webpush");
let h: typeof import("../src/app/api/push/_handlers");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  wp = await import("../src/lib/notify/webpush");
  h = await import("../src/app/api/push/_handlers");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
const P256 = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
const AUTH = "tBHItJI5svbpez7KI4CCXg";
async function user(prefs: Record<string, unknown> = {}) {
  seq++;
  return db.user.create({ data: { email: `pwa-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name: "Test", notifyPrefs: JSON.stringify(prefs) } });
}
const sub = (id: string) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, keys: { p256dh: P256, auth: AUTH } });
async function notification(userId: string, href = "/app/interviews") {
  return db.notification.create({ data: { userId, type: "interview", title: "Приглашение на интервью", body: "Acme ждёт тебя во вторник", href } });
}
type Call = { endpoint: string; payload: string };
function mockSender(status: (endpoint: string) => number | "throw" = () => 201) {
  const calls: Call[] = [];
  const send: import("../src/lib/notify/webpush").PushSender = async (s, payload) => {
    calls.push({ endpoint: s.endpoint, payload });
    const code = status(s.endpoint);
    if (code === "throw") throw new Error("socket hang up");
    if (code >= 400) throw Object.assign(new Error(`status ${code}`), { statusCode: code });
    return { statusCode: code };
  };
  return { send, calls };
}

// ——— static: manifest + service worker ———
function pngSize(file: string) {
  const b = readFileSync(file);
  assert.equal(b.subarray(1, 4).toString(), "PNG", `${file} is a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe("manifest", () => {
  test("required fields, colors, icons (any + maskable) exist at the declared size, shortcuts", async () => {
    const m = (await import("../src/app/manifest")).default();
    const json = JSON.parse(JSON.stringify(m));
    assert.equal(json.name, "Simplify");
    assert.ok(json.short_name && json.short_name.length <= 12);
    assert.equal(json.start_url, "/app");
    assert.equal(json.scope, "/");
    assert.equal(json.display, "standalone");
    assert.match(json.theme_color, /^#[0-9a-f]{6}$/i);
    assert.match(json.background_color, /^#[0-9a-f]{6}$/i);
    const css = readFileSync("src/app/globals.css", "utf8").toLowerCase();
    assert.ok(css.includes(json.theme_color.toLowerCase()) && css.includes(json.background_color.toLowerCase()), "colors come from the design tokens");
    for (const size of ["192x192", "512x512"])
      for (const purpose of ["any", "maskable"]) assert.ok(json.icons.some((i: { sizes: string; purpose: string }) => i.sizes === size && i.purpose === purpose), `${size} ${purpose}`);
    for (const i of json.icons) {
      const f = path.join("public", i.src);
      assert.ok(existsSync(f), i.src);
      const [w] = i.sizes.split("x").map(Number);
      assert.deepEqual(pngSize(f), { w, h: w });
    }
    assert.deepEqual(json.shortcuts.map((s: { url: string }) => s.url), ["/app", "/app/interviews"]);
    assert.deepEqual(pngSize("public/icons/apple-touch-icon.png"), { w: 180, h: 180 });
    assert.ok(existsSync("public/icons/badge-96.png"));
  });
});

describe("service worker", () => {
  test("parses (node --check), is versioned, caches only the offline page and never stores responses", () => {
    execSync("node --check public/sw.js", { stdio: "pipe" });
    const sw = readFileSync("public/sw.js", "utf8");
    assert.match(sw, /const VERSION = "v\d+"/);
    assert.ok(!/cache\.put\(|\.put\(/.test(sw), "no runtime caching");
    assert.match(sw, /PRECACHE = \[OFFLINE_URL, "\/icons\/icon-192\.png"\]/);
    assert.match(sw, /OFFLINE_URL = "\/offline"/);
    assert.match(sw, /req\.mode !== "navigate"/, "only navigations are intercepted");
    for (const ev of ["push", "notificationclick", "install", "activate", "pushsubscriptionchange"]) assert.ok(sw.includes(`addEventListener("${ev}"`), ev);
  });

  test("the offline page is static and self-contained", async () => {
    const mod = await import("../src/app/offline/route");
    assert.equal(mod.dynamic, "force-static");
    const html = await mod.GET().text();
    assert.match(html, /Нет соединения/);
    assert.ok(!/_next\/|<link[^>]+stylesheet/.test(html), "no app assets");
  });
});

// ——— pure helpers ———
describe("helpers", () => {
  test("endpoint allowlist blocks SSRF targets", () => {
    assert.ok(wp.isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
    assert.ok(wp.isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc"));
    assert.ok(wp.isAllowedEndpoint("https://web.push.apple.com/QAbc"));
    assert.ok(wp.isAllowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=x"));
    for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost/x", "https://fcm.googleapis.com.evil.com/x", "https://evilfcm.googleapis.com.io/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "javascript:alert(1)", "not a url"])
      assert.equal(wp.isAllowedEndpoint(bad), false, bad);
  });
  test("push urls stay in-app", () => {
    assert.equal(wp.pushUrl("/app/offers/1"), "/app/offers/1");
    for (const bad of ["", "https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)"]) assert.equal(wp.pushUrl(bad), "/app", bad);
  });
  test("device labels", () => {
    assert.equal(wp.deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"), "Safari · iPhone");
    assert.equal(wp.deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36"), "Chrome · Android");
    assert.equal(wp.deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0"), "Edge · Windows");
    assert.equal(wp.deviceLabel(""), "Браузер");
  });
});

// ——— API handlers ———
describe("subscribe / unsubscribe authorization", () => {
  test("signed out → 401, nothing stored", async () => {
    assert.equal((await h.subscribe(null, { subscription: sub("anon") }, "")).status, 401);
    assert.equal((await h.unsubscribe(null, { endpoint: sub("anon").endpoint })).status, 401);
    assert.equal((await h.testPush(null, { endpoint: sub("anon").endpoint })).status, 401);
    assert.equal(await db.pushSubscription.count({ where: { endpoint: sub("anon").endpoint } }), 0);
  });

  test("a session of a deleted account can't create an orphan subscription", async () => {
    assert.equal((await h.subscribe("no-such-user", { subscription: sub("ghost") }, "")).status, 401);
  });

  test("invalid bodies → 400 (SSRF endpoint, bad keys, missing fields)", async () => {
    const u = await user();
    for (const body of [null, {}, { subscription: { endpoint: "https://169.254.169.254/x", keys: { p256dh: P256, auth: AUTH } } }, { subscription: { ...sub("k"), keys: { p256dh: "short", auth: AUTH } } }, { subscription: { ...sub("k"), keys: { p256dh: P256 + "<script>", auth: AUTH } } }, { subscription: { endpoint: sub("k").endpoint } }, { subscription: { ...sub("k"), keys: { p256dh: "A" + P256.slice(1), auth: AUTH } } }, { subscription: { ...sub("k"), keys: { p256dh: P256 + "AAAA", auth: AUTH } } }, { subscription: { ...sub("k"), keys: { p256dh: P256, auth: AUTH + "AAAA" } } }])
      assert.equal((await h.subscribe(u.id, body, "")).status, 400, JSON.stringify(body));
    assert.equal((await h.unsubscribe(u.id, { endpoint: "" })).status, 400);
  });

  test("subscribe stores the device, turns the pref on (merging other keys) and lists devices without endpoints", async () => {
    const u = await user({ telegram: true, webpush: false });
    const r = await h.subscribe(u.id, { subscription: sub(`own-${u.id}`) }, "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36");
    assert.equal(r.status, 200);
    const devices = r.body.devices as { key: string; label: string }[];
    assert.equal(devices.length, 1);
    assert.equal(devices[0].label, "Chrome · Windows");
    assert.equal(devices[0].key, wp.endpointKey(sub(`own-${u.id}`).endpoint));
    assert.ok(!JSON.stringify(r.body).includes("fcm.googleapis.com"), "endpoints are never sent back");
    const prefs = JSON.parse((await db.user.findUniqueOrThrow({ where: { id: u.id } })).notifyPrefs);
    assert.deepEqual(prefs, { telegram: true, webpush: true });
  });

  test("another user can't delete or ping someone else's device", async () => {
    const a = await user();
    const b = await user();
    const e = sub(`a-${a.id}`);
    await h.subscribe(a.id, { subscription: e }, "");
    const del = await h.unsubscribe(b.id, { endpoint: e.endpoint });
    assert.equal(del.status, 200);
    assert.equal(del.body.removed, 0);
    assert.equal(await db.pushSubscription.count({ where: { userId: a.id } }), 1);
    const { send, calls } = mockSender();
    assert.equal((await h.testPush(b.id, { endpoint: e.endpoint }, send)).status, 404);
    assert.equal(calls.length, 0);
    // The owner can.
    assert.equal((await h.unsubscribe(a.id, { endpoint: e.endpoint })).body.removed, 1);
  });

  test("endpoint takeover: re-subscribed by another account, the endpoint moves to them", async () => {
    const a = await user();
    const b = await user();
    const e = sub(`shared-${a.id}`);
    await h.subscribe(a.id, { subscription: e }, "ua-a");
    await h.subscribe(b.id, { subscription: { ...e, keys: { p256dh: P256, auth: "zzzzzzzzzzzzzzzzzzzzzz" } } }, "ua-b");
    const rows = await db.pushSubscription.findMany({ where: { endpoint: e.endpoint } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].userId, b.id);
    assert.equal(rows[0].auth, "zzzzzzzzzzzzzzzzzzzzzz");
    // A's notifications no longer reach that browser.
    const { send, calls } = mockSender();
    await wp.deliverWebPush(await notification(a.id), { send });
    assert.equal(calls.length, 0);
  });

  test("rotated subscription (pushsubscriptionchange) replaces only the caller's old endpoint", async () => {
    const a = await user();
    const b = await user();
    await h.subscribe(a.id, { subscription: sub(`old-${a.id}`) }, "");
    await h.subscribe(b.id, { subscription: sub(`bs-${b.id}`) }, "");
    await h.subscribe(a.id, { subscription: sub(`new-${a.id}`), replaces: sub(`old-${a.id}`).endpoint }, "");
    await h.subscribe(a.id, { subscription: sub(`new2-${a.id}`), replaces: sub(`bs-${b.id}`).endpoint }, "");
    assert.deepEqual((await db.pushSubscription.findMany({ where: { userId: a.id }, orderBy: { createdAt: "asc" } })).map((r) => r.endpoint.split("/").pop()), [`new-${a.id}`, `new2-${a.id}`]);
    assert.equal(await db.pushSubscription.count({ where: { userId: b.id } }), 1, "B's row untouched");
    // A rotation never flips the user's switch back on.
    await wp.setPushPref(a.id, false);
    await h.subscribe(a.id, { subscription: sub(`new3-${a.id}`), replaces: sub(`new2-${a.id}`).endpoint }, "");
    assert.equal(await wp.pushPrefOn(a.id), false);
  });

  test("at most 10 devices per account (newest kept)", async () => {
    const u = await user();
    for (let i = 0; i < 13; i++) await h.subscribe(u.id, { subscription: sub(`cap-${u.id}-${i}`) }, "");
    const rows = await db.pushSubscription.findMany({ where: { userId: u.id } });
    assert.equal(rows.length, 10);
    assert.ok(rows.some((r) => r.endpoint.endsWith(`cap-${u.id}-12`)));
  });
});

describe("delivery", () => {
  test("sends to every device with the notification payload; sets pushSentAt; a second dispatch doesn't resend", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`d1-${u.id}`) }, "");
    await h.subscribe(u.id, { subscription: sub(`d2-${u.id}`) }, "");
    const n = await notification(u.id, "https://evil.example/phish");
    const { send, calls } = mockSender();
    await wp.deliverWebPush(n, { send });
    assert.equal(calls.length, 2);
    const p = JSON.parse(calls[0].payload);
    assert.deepEqual(p, { title: n.title, body: n.body, url: "/app", tag: n.id });
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).pushSentAt);
    await Promise.all([wp.deliverWebPush(n, { send }), wp.deliverWebPush(n, { send })]);
    assert.equal(calls.length, 2, "idempotent");
  });

  test("two concurrent dispatches of a fresh notification push once", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`cc-${u.id}`) }, "");
    const n = await notification(u.id);
    const { send, calls } = mockSender();
    await Promise.all(Array.from({ length: 5 }, () => wp.deliverWebPush(n, { send })));
    assert.equal(calls.length, 1);
  });

  test("404/410 subscriptions are deleted; other errors keep the row; pushSentAt set when one device got it", async () => {
    const u = await user();
    for (const k of ["ok", "gone", "missing", "flaky"]) await h.subscribe(u.id, { subscription: sub(`c-${k}-${u.id}`) }, "");
    const n = await notification(u.id);
    const { send, calls } = mockSender((e) => (e.includes("c-gone") ? 410 : e.includes("c-missing") ? 404 : e.includes("c-flaky") ? "throw" : 201));
    await wp.deliverWebPush(n, { send });
    assert.equal(calls.length, 4);
    const left = (await db.pushSubscription.findMany({ where: { userId: u.id } })).map((r) => r.endpoint.split("/").pop()!.split("-")[1]).sort();
    assert.deepEqual(left, ["flaky", "ok"]);
    assert.ok((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).pushSentAt);
  });

  test("no device accepted it → pushSentAt released, so a later dispatch can retry", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`f-${u.id}`) }, "");
    const n = await notification(u.id);
    await wp.deliverWebPush(n, { send: mockSender(() => 500).send });
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).pushSentAt, null);
    const { send, calls } = mockSender();
    await wp.deliverWebPush(n, { send });
    assert.equal(calls.length, 1);
  });

  test("prefs.webpush === false → nothing is sent; missing key counts as on", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`p-${u.id}`) }, "");
    assert.ok(await wp.setPushPref(u.id, false));
    const { send, calls } = mockSender();
    const n = await notification(u.id);
    await wp.deliverWebPush(n, { send });
    assert.equal(calls.length, 0);
    assert.equal((await db.notification.findUniqueOrThrow({ where: { id: n.id } })).pushSentAt, null);
    await db.user.update({ where: { id: u.id }, data: { notifyPrefs: "{}" } });
    await wp.deliverWebPush(n, { send });
    assert.equal(calls.length, 1);
  });

  test("broken prefs JSON / no subscriptions / unknown user: silent no-op, never throws", async () => {
    const u = await user();
    await db.user.update({ where: { id: u.id }, data: { notifyPrefs: "{not json" } });
    const { send, calls } = mockSender();
    await wp.deliverWebPush(await notification(u.id), { send });
    await wp.deliverWebPush({ id: "x", userId: "nobody", type: "t", title: "t", body: "", href: "" }, { send });
    assert.equal(calls.length, 0);
  });

  test("a sender that throws synchronously-ish or hangs up is contained", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`t-${u.id}`) }, "");
    const send: import("../src/lib/notify/webpush").PushSender = () => { throw new Error("boom"); };
    await assert.doesNotReject(wp.deliverWebPush(await notification(u.id), { send }));
  });

  test("«Проверить связь» pushes only to the calling device; a gone device → 410 and removed", async () => {
    const u = await user();
    await h.subscribe(u.id, { subscription: sub(`m1-${u.id}`) }, "");
    await h.subscribe(u.id, { subscription: sub(`m2-${u.id}`) }, "");
    const { send, calls } = mockSender((e) => (e.includes("m2-") ? 410 : 201));
    assert.equal((await h.testPush(u.id, { endpoint: sub(`m1-${u.id}`).endpoint }, send)).status, 200);
    assert.deepEqual(calls.map((c) => c.endpoint), [sub(`m1-${u.id}`).endpoint]);
    assert.equal(JSON.parse(calls[0].payload).url, "/app/settings#notifications");
    assert.equal((await h.testPush(u.id, { endpoint: sub(`m2-${u.id}`).endpoint }, send)).status, 410);
    assert.equal(await db.pushSubscription.count({ where: { userId: u.id } }), 1);
  });

  test("setPushPref never drops a concurrently written key", async () => {
    const u = await user({ telegram: false });
    await Promise.all([wp.setPushPref(u.id, false), wp.setPushPref(u.id, true), wp.setPushPref(u.id, false)]);
    const prefs = JSON.parse((await db.user.findUniqueOrThrow({ where: { id: u.id } })).notifyPrefs);
    assert.equal(prefs.telegram, false);
    assert.equal(typeof prefs.webpush, "boolean");
  });
});

describe("without VAPID keys", () => {
  test("subscribe/test → 503, delivery is a no-op", async () => {
    const saved = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    try {
      const u = await user();
      assert.equal(wp.pushConfigured(), false);
      assert.equal((await h.subscribe(u.id, { subscription: sub(`nv-${u.id}`) }, "")).status, 503);
      assert.equal((await h.testPush(u.id, { endpoint: sub(`nv-${u.id}`).endpoint })).status, 503);
      const { send, calls } = mockSender();
      await wp.deliverWebPush(await notification(u.id), { send });
      assert.equal(calls.length, 0);
    } finally {
      process.env.VAPID_PRIVATE_KEY = saved;
    }
  });
});

describe("stress", () => {
  test("300 concurrent subscribes (30 users × 10 devices): every one stored exactly once", async () => {
    const users = await Promise.all(Array.from({ length: 30 }, () => user()));
    const results = await Promise.all(users.flatMap((u) => Array.from({ length: 10 }, (_, i) => h.subscribe(u.id, { subscription: sub(`s-${u.id}-${i}`) }, "ua"))));
    assert.ok(results.every((r) => r.status === 200), `statuses: ${[...new Set(results.map((r) => r.status))]}`);
    assert.equal(await db.pushSubscription.count({ where: { userId: { in: users.map((u) => u.id) } } }), 300);
  });

  test("60 concurrent subscribes of one endpoint by 20 accounts: one row, owned by one of them", async () => {
    const users = await Promise.all(Array.from({ length: 20 }, () => user()));
    const shared = sub(`race-${Date.now()}`);
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => h.subscribe(users[i % 20].id, { subscription: shared }, "ua")));
    assert.ok(results.every((r) => r.status === 200));
    const rows = await db.pushSubscription.findMany({ where: { endpoint: shared.endpoint } });
    assert.equal(rows.length, 1);
    assert.ok(users.some((u) => u.id === rows[0].userId));
  });
});
