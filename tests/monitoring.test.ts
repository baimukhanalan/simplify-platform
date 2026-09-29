// Error monitoring (src/lib/monitoring/**): scrubbing, fingerprints, DB grouping under load, throttle, resolve → reopen,
// the public client endpoint, the Sentry envelope, and "captureError never throws". DB tests use a throwaway SQLite DB.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

import { scrub, scrubValue, normalizeRoute } from "../src/lib/monitoring/scrub";
import { fingerprintOf, normalizeMessage, topAppFrame } from "../src/lib/monitoring/fingerprint";
import { buildEnvelope, parseDsn, sendToSentry, envelopeUrl } from "../src/lib/monitoring/sentry";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-monitoring-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.SESSION_SECRET = "monitoring-test-session-secret-0123456789abcdef";
delete process.env.SENTRY_DSN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let mon: typeof import("../src/lib/monitoring");
let admin: typeof import("../src/lib/monitoring/admin");
let client: typeof import("../src/lib/monitoring/client-report");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  mon = await import("../src/lib/monitoring");
  admin = await import("../src/lib/monitoring/admin");
  client = await import("../src/lib/monitoring/client-report");
});
after(async () => {
  mon?.resetMonitoringState();
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const stackAt = (fn: string, file: string, line: number) =>
  `Error: boom\n    at ${fn} (/var/task/.next/server/chunks/node_modules_prisma_abc.js:1:2)\n    at ${fn} (/var/task/src/lib/${file}:${line}:${line * 3})\n    at async run (/var/task/node_modules/next/dist/server/x.js:9:9)`;

// ——— Scrubbing ———
describe("scrub: PII and secrets never reach the log", () => {
  test("emails, phones, cards, IIN", () => {
    const out = scrub("user alan.b+jobs@gmail.com called +7 701 123 45 67 and 8 (701) 123-45-67 / 87011234567, card 4400 4301 2345 6789, IIN 990101300123");
    for (const leak of ["alan.b", "gmail.com", "701 123", "87011234567", "4400", "990101300123"]) assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
    assert.match(out, /\[email\].*\[phone\].*\[phone\].*\[phone\].*\[card\].*\[iin\]/);
  });

  test("bearer tokens, JWTs, API keys, hh / Kaspi tokens, secret query params", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjbHh5eiJ9.Qm9ndXNTaWduYXR1cmVfX19fX19fX19f";
    const hh = "USERK3J4ILAS1Q2W3E4R5T6Y7U8I9O0PASDFGHJKLZXCVBNM1234567890QWERTYUIOP";
    const s = [
      `Authorization: Bearer ${hh}`,
      `cookie sfy_session=${jwt}`,
      `key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`,
      `fetch https://api.hh.ru/negotiations?access_token=abc123secret&page=2 failed`,
      `GET /api/integrations/hh/callback?code=QWERTY123&state=xyz789 500`,
      `kaspi {"merchantSecret":"S3cr3tV4lu3","password":"hunter2"}`,
      `raw token ${hh}`,
      `webhook signature=deadbeefcafebabe0123 mismatch`,
    ].join("\n");
    const out = scrub(s);
    for (const leak of [hh, jwt, "AbCdEfGhIjKl", "abc123secret", "QWERTY123", "xyz789", "S3cr3tV4lu3", "hunter2", "deadbeefcafebabe0123", "eyJ"]) assert.ok(!out.includes(leak), `${leak} leaked:\n${out}`);
    assert.ok(out.includes("page=2"), "harmless query params stay");
    assert.ok(out.includes("Bearer [redacted]"));
  });

  test("ordinary error text and stack frames survive", () => {
    const m = "TypeError: Cannot read properties of undefined (reading 'id')";
    assert.equal(scrub(m), m);
    const frame = "    at prepare (/var/task/src/lib/engine/agent.ts:512:19)";
    assert.equal(scrub(frame), frame);
    assert.equal(scrub("Unique constraint failed on the fields: (`fingerprint`) code P2002"), "Unique constraint failed on the fields: (`fingerprint`) code P2002");
  });

  test("scrubValue drops secret-named keys and scrubs nested strings", () => {
    const v = scrubValue({ password: "x", accessToken: "y", nested: { note: "mail me at a@b.co", list: ["Bearer abcdefghij"] }, n: 3 }) as Record<string, unknown>;
    assert.equal(v.password, "[redacted]");
    assert.equal(v.accessToken, "[redacted]");
    assert.deepEqual(v.nested, { note: "mail me at [email]", list: ["Bearer [redacted]"] });
    assert.equal(v.n, 3);
  });

  test("routes: query dropped, ids collapsed", () => {
    assert.equal(normalizeRoute("/app/applications/clx1a2b3c4d5e6f7g8h9i0j1k2?token=abc"), "/app/applications/[id]");
    assert.equal(normalizeRoute("https://simplify.kz/share/12345#x"), "/share/[id]");
    assert.equal(normalizeRoute("/app/opportunities/[id]"), "/app/opportunities/[id]");
  });
});

// ——— Fingerprints ———
describe("fingerprint: stable across ids, numbers and deploys", () => {
  test("ids / numbers / quoted values normalize", () => {
    assert.equal(normalizeMessage("Campaign clx1a2b3c4d5e6f7g8h9i0j1k2 not found after 312ms"), normalizeMessage("Campaign cly9z8y7x6w5v4u3t2s1r0q9p8 not found after 95ms"));
    assert.equal(normalizeMessage(`Job "Data Analyst" failed`), normalizeMessage(`Job "Backend Engineer" failed`));
    assert.notEqual(normalizeMessage("Campaign not found"), normalizeMessage("Payment not found"));
  });

  test("top app frame ignores node_modules / Next internals and line numbers", () => {
    assert.equal(topAppFrame(stackAt("prepare", "engine/agent.ts", 10)), "prepare src/lib/engine/agent.ts");
    assert.equal(topAppFrame("Error: x\n    at a (https://simplify.kz/_next/static/chunks/app/app/page-3f2a9c1be0.js:1:2345)"), "a app/page.js");
    assert.equal(topAppFrame(""), "");
    assert.equal(
      topAppFrame("Error: x\n    at GET (/var/task/.next/server/chunks/[root-of-the-server]__1kdip4d._.js:58:11)"),
      topAppFrame("Error: x\n    at GET (/var/task/.next/server/chunks/[root-of-the-server]__9zq2m1x._.js:12:3)"),
      "turbopack chunk ids don't split groups across builds",
    );
  });

  test("same error → same fingerprint across deploys; different frame / route / source → different", () => {
    const a = fingerprintOf({ message: "boom 1", stack: stackAt("prepare", "engine/agent.ts", 10), route: "/api/cron/tick", source: "cron" });
    const b = fingerprintOf({ message: "boom 22", stack: stackAt("prepare", "engine/agent.ts", 99), route: "/api/cron/tick", source: "cron" });
    assert.equal(a, b);
    assert.notEqual(a, fingerprintOf({ message: "boom 1", stack: stackAt("submit", "engine/agent.ts", 10), route: "/api/cron/tick", source: "cron" }));
    assert.notEqual(a, fingerprintOf({ message: "boom 1", stack: stackAt("prepare", "engine/agent.ts", 10), route: "/app", source: "cron" }));
    assert.notEqual(a, fingerprintOf({ message: "boom 1", stack: stackAt("prepare", "engine/agent.ts", 10), route: "/api/cron/tick", source: "server" }));
    assert.match(a, /^[0-9a-f]{40}$/);
  });
});

// ——— Sentry ———
describe("Sentry forwarder (HTTP envelope, no SDK)", () => {
  test("DSN parsing", () => {
    const d = parseDsn("https://pub123@o42.ingest.sentry.io/4507")!;
    assert.deepEqual({ k: d.publicKey, h: d.host, p: d.projectId, pre: d.pathPrefix }, { k: "pub123", h: "o42.ingest.sentry.io", p: "4507", pre: "" });
    assert.equal(envelopeUrl(d), "https://o42.ingest.sentry.io/api/4507/envelope/?sentry_key=pub123&sentry_version=7");
    assert.equal(envelopeUrl(parseDsn("http://k@self.host:9000/sub/path/7")!), "http://self.host:9000/sub/path/api/7/envelope/?sentry_key=k&sentry_version=7");
    for (const bad of ["", "not a dsn", "https://host/1", "https://k@host/abc", "ftp://k@host/1"]) assert.equal(parseDsn(bad), null, bad);
  });

  const input = { message: "boom", type: "TypeError", stack: stackAt("prepare", "engine/agent.ts", 10), level: "error" as const, source: "server", route: "/app", digest: "123", userId: "u1", fingerprint: "f".repeat(40), extra: { step: "x" } };

  test("envelope format: header line, item header with length, event payload", () => {
    const d = parseDsn("https://pub123@o42.ingest.sentry.io/4507")!;
    const { body, eventId, url } = buildEnvelope(d, input, new Date("2026-09-29T10:00:00Z"));
    assert.ok(url.includes("/api/4507/envelope/"));
    const lines = body.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    const header = JSON.parse(lines[0]), item = JSON.parse(lines[1]), event = JSON.parse(lines[2]);
    assert.equal(header.event_id, eventId);
    assert.match(eventId, /^[0-9a-f]{32}$/);
    assert.equal(header.dsn, d.raw);
    assert.equal(header.sent_at, "2026-09-29T10:00:00.000Z");
    assert.equal(item.type, "event");
    assert.equal(item.length, Buffer.byteLength(lines[2]));
    assert.equal(event.level, "error");
    assert.deepEqual(event.fingerprint, [input.fingerprint]);
    assert.equal(event.user.id, "u1");
    assert.equal(event.tags.source, "server");
    assert.equal(event.exception.values[0].type, "TypeError");
    const frames = event.exception.values[0].stacktrace.frames;
    assert.equal(frames.at(-1).filename.includes("node_modules_prisma"), true, "innermost frame last");
    assert.equal(frames.find((f: { filename: string }) => f.filename.includes("src/lib")).in_app, true);
    assert.equal(event.timestamp, Date.parse("2026-09-29T10:00:00Z") / 1000);
  });

  test("POST with sentry_key auth; failures and hangs resolve false within the 2 s timeout", async () => {
    const orig = globalThis.fetch;
    try {
      let seen: { url: string; init: RequestInit } | undefined;
      globalThis.fetch = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 200 }); }) as typeof fetch;
      assert.equal(await sendToSentry(input, "https://pub123@o42.ingest.sentry.io/4507"), true);
      assert.equal(seen!.url, "https://o42.ingest.sentry.io/api/4507/envelope/?sentry_key=pub123&sentry_version=7");
      assert.equal(seen!.init.method, "POST");
      assert.match(String((seen!.init.headers as Record<string, string>)["x-sentry-auth"]), /sentry_key=pub123/);
      assert.ok(seen!.init.signal, "has a timeout signal");

      globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
      assert.equal(await sendToSentry(input, "https://pub123@o42.ingest.sentry.io/4507"), false);
      globalThis.fetch = (async () => new Response("no", { status: 429 })) as typeof fetch;
      assert.equal(await sendToSentry(input, "https://pub123@o42.ingest.sentry.io/4507"), false);

      globalThis.fetch = ((_: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
      const t = Date.now();
      assert.equal(await sendToSentry(input, "https://pub123@o42.ingest.sentry.io/4507"), false);
      assert.ok(Date.now() - t < 3000, "bounded by the 2 s timeout");
      assert.equal(await sendToSentry(input, undefined), false, "no DSN → no call");
    } finally {
      globalThis.fetch = orig;
    }
  });
});

// ——— DB: grouping, throttle, reopen ———
describe("captureError → ErrorLog", () => {
  beforeEach(async () => {
    mon.resetMonitoringState();
    mon.configureMonitoring({ throttleMs: 150, store: null, writesPerMinute: 120 });
    await db.errorLog.deleteMany({});
  });

  test("500 concurrent captures of the same error → one row, count 500, and only a handful of DB writes", async () => {
    let writes = 0;
    mon.configureMonitoring({
      store: {
        errorLog: {
          findUnique: ((a: never) => db.errorLog.findUnique(a)) as never,
          create: ((a: never) => { writes++; return db.errorLog.create(a); }) as never,
          update: ((a: never) => { writes++; return db.errorLog.update(a); }) as never,
        },
      },
    });
    const users = Array.from({ length: 30 }, (_, i) => `user-${i}`);
    await Promise.all(Array.from({ length: 500 }, (_, i) => {
      const e = new Error(`Opportunity clx${String(i).padStart(22, "0")} failed after ${i}ms`);
      e.stack = stackAt("prepare", "engine/agent.ts", 100 + i);
      return mon.captureError(e, { source: "cron", route: "/api/cron/tick", userId: users[i % users.length] });
    }));
    await mon.flushMonitoring();
    const rows = await db.errorLog.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].count, 500);
    assert.equal(rows[0].source, "cron");
    assert.ok(writes <= 3, `throttled: ${writes} writes`);
    const meta = admin.readMeta(rows[0].meta);
    assert.equal(meta.users?.length, 30, "affected users tracked");
    assert.equal(admin.hourlySeries(meta).reduce((a, b) => a + b, 0), 500, "24 h sparkline buckets");
  });

  test("throttle: a steady storm writes at most once per window, counts stay exact", async () => {
    let writes = 0;
    mon.configureMonitoring({
      throttleMs: 100,
      store: { errorLog: { findUnique: ((a: never) => db.errorLog.findUnique(a)) as never, create: ((a: never) => { writes++; return db.errorLog.create(a); }) as never, update: ((a: never) => { writes++; return db.errorLog.update(a); }) as never } },
    });
    const started = Date.now();
    let n = 0;
    while (Date.now() - started < 450) {
      await mon.captureError(new Error("storm"), { route: "/app" });
      n++;
      await new Promise((r) => setTimeout(r, 2));
    }
    await mon.flushMonitoring();
    const row = await db.errorLog.findFirstOrThrow();
    assert.equal(row.count, n);
    assert.ok(n > 50, `storm size ${n}`);
    assert.ok(writes <= 8, `${writes} writes for ${n} occurrences`);
  });

  test("distinct errors are separate groups; Next control flow (redirect / notFound) is ignored", async () => {
    await mon.captureError(new Error("A failed"), { route: "/a" });
    await mon.captureError(new Error("B failed"), { route: "/a" });
    await mon.captureError(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }));
    await mon.captureError(Object.assign(new Error("x"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }));
    await mon.flushMonitoring();
    assert.equal(await db.errorLog.count(), 2);
  });

  test("stored message / stack / meta are scrubbed", async () => {
    const e = new Error("login failed for alan@example.com with token=supersecret123");
    e.stack = `Error: login failed for alan@example.com\n    at login (/var/task/src/lib/actions/auth.ts:10:5)`;
    await mon.captureError(e, { userId: "u1", meta: { email: "alan@example.com", apiKey: "k", note: "Bearer abcdefghijkl" } });
    const row = await db.errorLog.findFirstOrThrow();
    const all = JSON.stringify(row);
    for (const leak of ["alan@example.com", "supersecret123", "abcdefghijkl"]) assert.ok(!all.includes(leak), leak);
    assert.equal(row.userId, "u1");
  });

  test("resolved → recurs → re-opens (count continues, reopenedAt recorded)", async () => {
    await mon.captureError(new Error("flaky"), { route: "/x" });
    await mon.flushMonitoring();
    const row = await db.errorLog.findFirstOrThrow();
    assert.equal(await admin.resolveErrorById(row.id), 1);
    assert.equal(await admin.resolveErrorById(row.id), 0, "idempotent");
    assert.ok((await db.errorLog.findFirstOrThrow()).resolvedAt);
    const open = await admin.listErrors({ tab: "open", sort: "last", q: "" });
    assert.equal(open.rows.length, 0);
    assert.equal((await admin.listErrors({ tab: "resolved", sort: "last", q: "flaky" })).rows.length, 1);

    await new Promise((r) => setTimeout(r, 200)); // past the throttle window
    await mon.captureError(new Error("flaky"), { route: "/x" });
    await mon.flushMonitoring();
    const again = await db.errorLog.findFirstOrThrow();
    assert.equal(again.resolvedAt, null);
    assert.equal(again.count, 2);
    assert.ok(admin.readMeta(again.meta).reopenedAt);
    const list = await admin.listErrors({ tab: "open", sort: "count", q: "" });
    assert.equal(list.rows[0].reopenedAt instanceof Date, true);
  });

  test("two instances racing to create the same row (P2002) both count", async () => {
    // Simulate: findUnique says "absent" for both, the second create hits the unique constraint → falls back to update.
    mon.configureMonitoring({ store: { errorLog: { findUnique: ((a: { select?: { id?: boolean } }) => (a.select?.id ? Promise.resolve(null) : db.errorLog.findUnique(a as never))) as never, create: ((a: never) => db.errorLog.create(a)) as never, update: ((a: never) => db.errorLog.update(a)) as never } } });
    await mon.captureError(new Error("race"));
    mon.resetMonitoringState(); // a second instance: its own throttle state
    await mon.captureError(new Error("race"));
    await mon.flushMonitoring();
    assert.equal((await db.errorLog.findFirstOrThrow()).count, 2);
  });

  test("never throws: DB down, DB hanging, odd inputs, huge inputs", async () => {
    mon.configureMonitoring({ store: { errorLog: { findUnique: (async () => { throw new Error("db down"); }) as never, create: (async () => { throw new Error("db down"); }) as never, update: (async () => { throw new Error("db down"); }) as never } } });
    await mon.captureError(new Error("while db down"));
    mon.configureMonitoring({ store: { errorLog: { findUnique: (() => new Promise(() => {})) as never, create: (() => new Promise(() => {})) as never, update: (() => new Promise(() => {})) as never } } });
    const t = Date.now();
    await mon.captureError(new Error("while db hangs"), { timeoutMs: 200 });
    assert.ok(Date.now() - t < 1000, "bounded wait");
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    for (const weird of [null, undefined, 42, "plain string", Symbol("s"), circular, { message: 5 }, Object.create(null)]) {
      await mon.captureError(weird, { meta: { circular } });
    }
    await mon.flushMonitoring(300);
    mon.resetMonitoringState();
    mon.configureMonitoring({ store: null });
    await mon.captureError(new Error("x".repeat(1_000_000)), { meta: { big: "y".repeat(1_000_000) } });
    const row = await db.errorLog.findFirstOrThrow({ where: { message: { startsWith: "xxx" } } });
    assert.ok(row.message.length <= 1000 && row.meta.length < 10_000);
  });

  test("DB comes back: occurrences counted while it was down are written later", async () => {
    let down = true;
    const real = { findUnique: (a: never) => db.errorLog.findUnique(a), create: (a: never) => db.errorLog.create(a), update: (a: never) => db.errorLog.update(a) };
    const wrap = <F extends (a: never) => unknown>(f: F) => ((a: never) => (down ? Promise.reject(new Error("down")) : f(a))) as never;
    mon.configureMonitoring({ store: { errorLog: { findUnique: wrap(real.findUnique), create: wrap(real.create), update: wrap(real.update) } } });
    for (let i = 0; i < 5; i++) await mon.captureError(new Error("outage"));
    await mon.flushMonitoring();
    assert.equal(await db.errorLog.count(), 0);
    down = false;
    await mon.flushMonitoring();
    assert.equal((await db.errorLog.findFirstOrThrow()).count, 5);
  });

  test("forwards to Sentry when SENTRY_DSN is set (once per window), DB write still happens", async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response(null, { status: 200 }); }) as typeof fetch;
    process.env.SENTRY_DSN = "https://pub@o1.ingest.sentry.io/1";
    try {
      await Promise.all(Array.from({ length: 50 }, () => mon.captureError(new Error("to sentry"))));
      await mon.flushMonitoring();
      assert.equal(calls, 1);
      assert.equal((await db.errorLog.findFirstOrThrow()).count, 50);
    } finally {
      delete process.env.SENTRY_DSN;
      globalThis.fetch = orig;
    }
  });
});

// ——— Public client endpoint ———
describe("POST /api/monitoring/client", () => {
  beforeEach(async () => {
    mon.resetMonitoringState();
    mon.configureMonitoring({ throttleMs: 0, store: null });
    client.resetClientReportLimits();
    await db.errorLog.deleteMany({});
  });
  const good = { message: "Cannot read properties of null (reading 'map')", name: "TypeError", stack: "TypeError: x\n    at Today (https://simplify.kz/_next/static/chunks/app/app/page-abc123def.js:1:200)", route: "/app/today", boundary: "app" };
  const req = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
    new Request("http://localhost:3000/api/monitoring/client", { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", ...headers }, body: raw ?? JSON.stringify(body) });

  test("valid report → 204, stored as source=client, userId from the session cookie", async () => {
    const token = await new SignJWT({ sub: "user-42" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.SESSION_SECRET));
    const res = await client.handleClientReport(req(good, { cookie: `a=b; sfy_session=${token}` }));
    assert.equal(res.status, 204);
    const row = await db.errorLog.findFirstOrThrow();
    assert.equal(row.source, "client");
    assert.equal(row.route, "/app/today");
    assert.equal(row.userId, "user-42");
    assert.ok(row.stack.includes("at Today"));
  });

  test("anonymous and forged sessions are accepted without a userId", async () => {
    assert.equal((await client.handleClientReport(req(good))).status, 204);
    assert.equal((await client.handleClientReport(req({ ...good, message: "other" }, { cookie: "sfy_session=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.bad" }))).status, 204);
    assert.equal(await db.errorLog.count({ where: { userId: { not: null } } }), 0);
  });

  test("validation: bad JSON, missing / extra fields, bad route, wrong content type, cross-site", async () => {
    assert.equal((await client.handleClientReport(req(null, {}, "{not json"))).status, 400);
    assert.equal((await client.handleClientReport(req({ route: "/x" }))).status, 400);
    assert.equal((await client.handleClientReport(req({ ...good, admin: true }))).status, 400);
    assert.equal((await client.handleClientReport(req({ ...good, route: "https://evil.com/" }))).status, 400);
    assert.equal((await client.handleClientReport(req({ ...good, message: "" }))).status, 400);
    assert.equal((await client.handleClientReport(req(good, { "content-type": "text/plain" }))).status, 415);
    assert.equal((await client.handleClientReport(req(good, { "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await client.handleClientReport(req(good, { origin: "https://evil.com", "sec-fetch-site": "" }))).status, 403);
    assert.equal(await db.errorLog.count(), 0);
  });

  test("size limit: declared and actual body over 16 KB → 413", async () => {
    const big = { ...good, stack: "x".repeat(20_000) };
    assert.equal((await client.handleClientReport(req(big, { "content-length": "20100" }))).status, 413);
    assert.equal((await client.handleClientReport(req(big))).status, 413, "no / lying content-length");
  });

  test("spam is rejected", async () => {
    for (const message of ["Buy now http://a.com http://b.com http://c.com", `<a href="http://x">cheap</a>`, "best casino bonus", "\u0001\u0002\u0003\u0004\u0005\u0006\u0007\u0008\u000e\u000f ok"]) {
      assert.equal((await client.handleClientReport(req({ ...good, message }))).status, 400, message);
    }
    assert.equal(await db.errorLog.count(), 0);
  });

  test("rate limit per IP: 20 per minute, then 429 with Retry-After", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await client.handleClientReport(req({ ...good, message: `e ${i}` }, { "x-vercel-forwarded-for": "203.0.113.9" }))).status);
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(204));
    assert.deepEqual(statuses.slice(20), Array(5).fill(429));
    const other = await client.handleClientReport(req(good, { "x-vercel-forwarded-for": "203.0.113.10" }));
    assert.equal(other.status, 204, "another IP is unaffected");
    const limited = await client.handleClientReport(req(good, { "x-vercel-forwarded-for": "203.0.113.9" }));
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
  });
});

// ——— Health ———
describe("GET /api/health", () => {
  test("db ok → 200, no secrets in the body", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    const { GET } = await import("../src/app/api/health/route");
    const res = await GET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.db, "ok");
    assert.equal(body.version, "abc123");
    assert.deepEqual(Object.keys(body).sort(), ["db", "latencyMs", "ok", "time", "version"]);
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });
});
