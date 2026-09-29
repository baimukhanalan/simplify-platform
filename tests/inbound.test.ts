// Inbound email → Inbox Intelligence: personal forwarding aliases, both webhook payload formats, recipient mapping
// (+tag, case, several recipients, Delivered-To), Message-ID dedupe, forwarding-confirmation letters (Gmail RU/EN,
// Yandex), non-employer mail, webhook auth, size limits and a 500-letter burst. DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SIMPLIFY_MODE = "live";
process.env.INBOUND_EMAIL_SECRET = "s3cret-inbound-value";
delete process.env.INBOUND_EMAIL_DOMAIN;
const dir = mkdtempSync(path.join(tmpdir(), "simplify-inbound-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

import { ALIAS_RE, aliasBase, aliasOf, aliasesOf, makeAlias, translit } from "../src/lib/inbound/alias";
import { decodeMimeWords, htmlToText, parseInbound, TEXT_MAX } from "../src/lib/inbound/parse";
import { detectForwardingVerification } from "../src/lib/inbound/verify";
import { isNonEmployer, senderNames } from "../src/lib/inbound/filter";
import { authVerdict, domainNamesCompany, forwardedFrom, normMailbox, parseAuthResults } from "../src/lib/inbound/auth";

const SECRET = process.env.INBOUND_EMAIL_SECRET!;
const DAY = 86400000;

// ——— Pure: aliases ———
describe("aliases", () => {
  test("transliterates Russian and Kazakh names, lowercase, readable + 5 random chars", () => {
    assert.equal(translit("Алан"), "alan");
    assert.equal(aliasBase("Алан Баймухан"), "alan");
    assert.equal(aliasBase("Әлия Қасымова"), "aliya");
    assert.equal(aliasBase("Йерлан"), "yerlan", "й is not split into и + breve");
    assert.equal(aliasBase("Жанна"), "zhanna");
    assert.equal(aliasBase("José"), "jose");
    assert.equal(aliasBase(""), "me");
    assert.equal(aliasBase("李"), "me");
    for (let i = 0; i < 200; i++) assert.match(makeAlias("Алан Б."), /^alan\.[a-z2-9]{5}$/);
    assert.ok(ALIAS_RE.test(makeAlias("Very Long Firstname Whatever".repeat(3))));
  });

  test("recipient → alias: case, +tag, quotes; foreign domains and malformed locals are not ours", () => {
    assert.equal(aliasOf("Alan.K7M2Q@IN.WESIMPLIFY.WORKS"), "alan.k7m2q");
    assert.equal(aliasOf("alan.k7m2q+jobs@in.wesimplify.works"), "alan.k7m2q");
    assert.equal(aliasOf("<alan.k7m2q@in.wesimplify.works>"), "alan.k7m2q");
    assert.equal(aliasOf("alan.k7m2q@gmail.com"), null);
    assert.equal(aliasOf("alan.k7m2q@evil-in.wesimplify.works"), null);
    assert.equal(aliasOf("alan@in.wesimplify.works"), null);
    assert.equal(aliasOf("../etc@in.wesimplify.works"), null);
    assert.deepEqual(aliasesOf(["me@gmail.com", "ab.cdefg@in.wesimplify.works", "AB.CDEFG+x@in.wesimplify.works", "zz.qwert@in.wesimplify.works"]), ["ab.cdefg", "zz.qwert"]);
  });
});

// ——— Pure: payload parsing ———
const postmarkPayload = (over: Record<string, unknown> = {}) => ({
  FromName: "Acme Talent",
  From: "jobs@acme.com",
  FromFull: { Email: "jobs@acme.com", Name: "Acme Talent", MailboxHash: "" },
  To: "\"Alan\" <alan@gmail.com>",
  ToFull: [{ Email: "alan@gmail.com", Name: "Alan", MailboxHash: "" }],
  Cc: "",
  CcFull: [],
  OriginalRecipient: "alan.k7m2q@in.wesimplify.works",
  Subject: "Interview invitation — Data Analyst",
  MessageID: "22c74902-a0c1-4511-804f-341342852c90",
  ReplyTo: "",
  MailboxHash: "",
  Date: "Fri, 1 Aug 2026 16:45:32 -04:00",
  TextBody: "Hi Alan, we would love to invite you to an interview for the Data Analyst role at Acme.",
  HtmlBody: "<p>ignored when text exists</p>",
  StrippedTextReply: "",
  Tag: "",
  Headers: [
    { Name: "Message-ID", Value: "<CAF=abc123@mail.acme.com>" },
    { Name: "Delivered-To", Value: "alan@gmail.com" },
    { Name: "X-Original-To", Value: "alan.k7m2q@in.wesimplify.works" },
  ],
  Attachments: [],
  ...over,
});

describe("payload parsing", () => {
  test("Postmark: envelope recipient, headers, Message-ID from the header (not Postmark's own id)", () => {
    const l = parseInbound(postmarkPayload())!;
    assert.equal(l.format, "postmark");
    assert.equal(l.recipients[0], "alan.k7m2q@in.wesimplify.works");
    assert.ok(l.recipients.includes("alan@gmail.com"));
    assert.equal(l.from, "Acme Talent <jobs@acme.com>");
    assert.equal(l.messageId, "CAF=abc123@mail.acme.com");
    assert.equal(l.headers["delivered-to"], "alan@gmail.com");
    assert.match(l.text, /invite you to an interview/);
  });

  test("generic (Worker): to as string/array, headers as object or list, HTML-only body converted", () => {
    const a = parseInbound({ to: "Alan.K7M2Q+x@In.WeSimplify.Works", from: "hr@globex.io", subject: "Hi", text: "Body", messageId: "<m1@globex.io>", headers: { "List-Id": "x", "Delivered-To": ["a@b.co", "c@d.co"] } })!;
    assert.equal(a.format, "generic");
    assert.deepEqual(a.recipients.slice(0, 1), ["alan.k7m2q+x@in.wesimplify.works"]);
    assert.equal(a.messageId, "m1@globex.io");
    assert.equal(a.headers["list-id"], "x");
    assert.equal(a.headers["delivered-to"], "a@b.co, c@d.co");
    const b = parseInbound({ to: ["x@y.kz", "z.abcde@in.wesimplify.works"], from: "a@b.co", html: "<html><head><title>T</title><style>p{}</style></head><body><p>Hello&nbsp;&laquo;there&raquo;</p><script>alert(1)</script><a href=\"https://calendly.com/acme/30\">Book</a><br>Line 2 &#x41;&#66;</body></html>", headers: [{ name: "Message-ID", value: "<q@b.co>" }] })!;
    assert.deepEqual(b.recipients, ["x@y.kz", "z.abcde@in.wesimplify.works"]);
    assert.equal(b.messageId, "q@b.co");
    assert.equal(b.text, "Hello «there»\nBook (https://calendly.com/acme/30)\nLine 2 AB");
  });

  test("rejects what is not a letter; subjects decoded and one-line", () => {
    assert.equal(parseInbound(null), null);
    assert.equal(parseInbound([]), null);
    assert.equal(parseInbound({ hello: 1 }), null);
    assert.equal(parseInbound({ to: "", from: "a@b.co" }), null, "no recipients");
    assert.equal(parseInbound({ to: 5 }), null, "wrong types");
    const l = parseInbound({ to: "a.bcdef@in.wesimplify.works", subject: "=?UTF-8?B?0J/RgNC40LPQu9Cw0YjQtdC90LjQtQ==?=\r\n next" })!;
    assert.equal(l.subject, "Приглашение next");
    assert.equal(decodeMimeWords("=?utf-8?Q?Caf=C3=A9_ok?="), "Café ok");
  });

  test("hostile HTML stays linear and safe; oversized text is capped at 1 MB", () => {
    const evil = "<script>".repeat(50_000) + "<a href='javascript:alert(1)'>x</a>" + "<".repeat(100_000);
    const t0 = Date.now();
    const out = htmlToText(evil);
    assert.ok(Date.now() - t0 < 2000);
    assert.ok(!out.includes("javascript:"));
    assert.equal(htmlToText("<p>a<!-- <script>hidden</script> -->b</p><div onclick=\"x\">c</div>"), "ab\n\nc");
    const big = parseInbound({ to: "a.bcdef@in.wesimplify.works", text: "x".repeat(3_000_000) })!;
    assert.equal(big.text.length, TEXT_MAX);
  });
});

// ——— Pure: forwarding confirmations and non-employer mail ———
const GMAIL_EN = {
  from: "Gmail Team <forwarding-noreply@google.com>",
  subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from alan@gmail.com",
  text: "alan@gmail.com has requested to automatically forward mail to your email address alan.k7m2q@in.wesimplify.works.\nConfirmation code: 123456789\n\nTo allow alan@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\n\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz\n\nIf you click the link and it appears to be broken...",
};
const GMAIL_RU = {
  from: "Команда Gmail <forwarding-noreply@google.com>",
  subject: "(#987654321) Подтверждение пересылки Gmail – получение почты с адреса aliya@gmail.com",
  text: "Пользователь aliya@gmail.com хочет автоматически пересылать письма на адрес aliya.q2w3e@in.wesimplify.works.\nКод подтверждения: 987654321\n\nЧтобы разрешить пересылку, нажмите на ссылку ниже:\nhttps://mail-settings.google.com/mail/vf-%5BXYZ%5D-abc",
};

describe("forwarding confirmation letters", () => {
  test("Gmail EN: code, link, requester", () => {
    const v = detectForwardingVerification(GMAIL_EN.from, GMAIL_EN.subject, GMAIL_EN.text)!;
    assert.deepEqual(v, { provider: "gmail", code: "123456789", link: "https://mail-settings.google.com/mail/vf-%5BANGjdJ_abc%5D-xyz", requester: "alan@gmail.com" });
  });
  test("Gmail RU: code, link, requester", () => {
    const v = detectForwardingVerification(GMAIL_RU.from, GMAIL_RU.subject, GMAIL_RU.text)!;
    assert.equal(v.provider, "gmail");
    assert.equal(v.code, "987654321");
    assert.equal(v.link, "https://mail-settings.google.com/mail/vf-%5BXYZ%5D-abc");
    assert.equal(v.requester, "aliya@gmail.com");
  });
  test("Yandex: link on yandex only; a link to another host is never offered", () => {
    // Yandex's exact confirmation-URL shape isn't known: code only, never a link (not even on a yandex host).
    const y = detectForwardingVerification("Яндекс Почта <noreply@yandex.ru>", "Подтверждение пересылки писем", "Код подтверждения: 4455667788. Или перейдите по ссылке https://mail.yandex.ru/re/confirm?id=abc. Или https://evil.com/x")!;
    assert.equal(y.provider, "yandex");
    assert.equal(y.code, "4455667788");
    assert.equal(y.link, null);
    assert.equal(detectForwardingVerification("noreply@yandex.ru", "Подтверждение пересылки", "https://mail.yandex.ru/re/confirm?id=abc"), null);
    assert.equal(detectForwardingVerification("noreply@yandex.ru", "Подтверждение пересылки", "https://evil.com/confirm"), null);
    // Gmail: only the exact /mail/vf-… shape on mail-settings.google.com / mail.google.com.
    for (const bad of ["https://accounts.google.com/x", "https://mail-settings.google.com/other/vf-abc", "https://mail-settings.google.com/mail/vf-abc?next=https://evil.com", "https://sites.google.com/mail/vf-x"]) {
      const g = detectForwardingVerification("forwarding-noreply@google.com", "(#123456789) Gmail Forwarding Confirmation", `Confirmation code: 123456789 ${bad}`)!;
      assert.equal(g.link, null, bad);
      assert.equal(g.code, "123456789");
    }
    // Spoofed sender with a phishing link: never a Google host → no link, and without a code → ignored.
    assert.equal(detectForwardingVerification("forwarding-noreply@google.com", "Gmail Forwarding Confirmation", "confirm here https://mail-settings.google.com.evil.io/x"), null);
  });
  test("employer mail and non-provider senders are not confirmations", () => {
    assert.equal(detectForwardingVerification("jobs@acme.com", "Please confirm forwarding", "Confirmation code: 123456789"), null);
    assert.equal(detectForwardingVerification("calendar@google.com", "Interview confirmed", "See you at https://meet.google.com/abc"), null);
  });
});

describe("non-employer mail", () => {
  const base = { from: "Acme Talent <jobs@acme.com>", subject: "Your application", headers: {} as Record<string, string> };
  test("mailing lists, spam, bounces and digests never move the pipeline", () => {
    assert.equal(isNonEmployer(base, true), false);
    assert.equal(isNonEmployer({ ...base, headers: { "list-id": "<news.acme.com>" } }, true), true);
    assert.equal(isNonEmployer({ ...base, headers: { precedence: "bulk" } }, true), true);
    assert.equal(isNonEmployer({ ...base, headers: { "x-spam-flag": "YES" } }, true), true);
    assert.equal(isNonEmployer({ ...base, from: "MAILER-DAEMON@mx.google.com" }, true), true);
    assert.equal(isNonEmployer({ ...base, from: "LinkedIn <jobalerts-noreply@linkedin.com>" }, true), true);
    assert.equal(isNonEmployer({ ...base, subject: "Подборка вакансий для тебя" }, true), true);
    // ATS mail through a bulk sender: List-Unsubscribe alone is fine when the From line names the company.
    assert.equal(isNonEmployer({ ...base, headers: { "list-unsubscribe": "<mailto:u@x>" } }, true), false);
    assert.equal(isNonEmployer({ ...base, from: "Weekly <hello@newsletter.io>", headers: { "list-unsubscribe": "<mailto:u@x>" } }, false), true);
  });
  test("senderNames: display name or domain label, never the TLD or a generic host", () => {
    assert.equal(senderNames("Acme Talent <no-reply@us.greenhouse-mail.io>", "Acme"), true);
    assert.equal(senderNames("jobs@acme.com", "ACME"), true);
    assert.equal(senderNames("news@comtech.io", "Com"), false);
    assert.equal(senderNames("hr@gmail.com", "Gmail Partners"), false);
    assert.equal(senderNames("hr@globex.io", "Acme"), false);
  });
});

// ——— DB + webhook ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let svc: typeof import("../src/lib/inbound/service");
let hook: typeof import("../src/lib/inbound/webhook");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  svc = await import("../src/lib/inbound/service");
  hook = await import("../src/lib/inbound/webhook");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(name = "Алан Баймухан") {
  seq++;
  const user = await db.user.create({
    data: {
      email: `inbound-test-${seq}-${Date.now()}@example.com`, passwordHash: "x", name,
      profile: { create: { skills: JSON.stringify(["SQL"]), workAuth: JSON.stringify(["KZ"]), yearsExperience: 3 } },
      goal: { create: { primaryRole: "Data Analyst", minSalary: 0, currency: "USD", countries: JSON.stringify(["KZ"]) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 1, status: "active", startedAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) } });
  const alias = await svc.ensureAlias(user.id);
  return { user, campaign, alias, address: `${alias}@in.wesimplify.works` };
}
async function makeOpp(campaignId: string, company: string, status = "submitted") {
  seq++;
  const job = await db.job.create({
    data: { source: "live", externalId: `j${seq}`, dedupeKey: `inb-${seq}-${Date.now()}`, company, title: "Data Analyst", roleFamily: "data_analyst", countries: JSON.stringify(["KZ"]), remote: "remote", technologies: "[]", sponsorship: "unknown", postedAt: new Date(), currency: "USD" },
  });
  return db.opportunity.create({ data: { campaignId, jobId: job.id, match: 90, status } });
}

const req = (body: unknown, opts: { secret?: string | null; how?: "header" | "basic" | "basic-user" | "token"; raw?: string } = {}) => {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url = "http://localhost/api/inbound/email";
  if (secret !== null) {
    if ((opts.how ?? "header") === "header") headers["x-inbound-secret"] = secret;
    if (opts.how === "basic") headers.authorization = `Basic ${Buffer.from(`inbound:${secret}`).toString("base64")}`;
    if (opts.how === "basic-user") headers.authorization = `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
    if (opts.how === "token") url += `?token=${encodeURIComponent(secret)}`;
  }
  return new Request(url, { method: "POST", headers, body: opts.raw ?? JSON.stringify(body) });
};
const GOOGLE_AUTH = [{ name: "Authentication-Results", value: "mx.cloudflare.net; dkim=pass header.d=google.com header.s=20230601; spf=pass smtp.mailfrom=forwarding-noreply@google.com; dmarc=pass header.from=google.com" }];
const generic = (to: string, over: Record<string, unknown> = {}) => ({ to, from: "Acme Talent <jobs@acme.com>", subject: "Interview invitation", text: "We would love to invite you to an interview for the Data Analyst role at Acme. Please schedule a call.", messageId: `<${Math.random().toString(36).slice(2)}@acme.com>`, ...over });

describe("webhook auth and limits", () => {
  test("no secret configured → 503; wrong/missing secret → 401; header and basic-auth password work, basic user / ?token= don't", async () => {
    const { address } = await makeUser();
    const saved = process.env.INBOUND_EMAIL_SECRET;
    delete process.env.INBOUND_EMAIL_SECRET;
    assert.equal((await hook.handleInbound(req(generic(address), { secret: "anything" }))).status, 503);
    process.env.INBOUND_EMAIL_SECRET = saved;
    assert.equal((await hook.handleInbound(req(generic(address), { secret: null }))).status, 401);
    assert.equal((await hook.handleInbound(req(generic(address), { secret: "wrong" }))).status, 401);
    assert.equal((await hook.handleInbound(req(generic(address), { secret: SECRET + "x" }))).status, 401);
    assert.equal((await hook.handleInbound(req(generic(address), { secret: "wrong", how: "basic" }))).status, 401);
    assert.equal((await hook.handleInbound(req(generic(address), { secret: "wrong", how: "token" }))).status, 401);
    for (const how of ["header", "basic"] as const) assert.equal((await hook.handleInbound(req(generic(address), { how }))).status, 200, how);
    for (const how of ["basic-user", "token"] as const) assert.equal((await hook.handleInbound(req(generic(address), { how }))).status, 401, how);
    assert.ok(hook.safeEqual("abc", "abc") && !hook.safeEqual("abc", "abd") && !hook.safeEqual("abc", "abcd"));
  });

  test("bad JSON → 400, unknown format → 400, oversized → 413, unknown alias → 200 ignored", async () => {
    assert.equal((await hook.handleInbound(req(null, { raw: "{not json" }))).status, 400);
    assert.equal((await hook.handleInbound(req({ hello: "world" }))).status, 400);
    const huge = await hook.handleInbound(req(null, { raw: JSON.stringify({ to: "a.bcdef@in.wesimplify.works", text: "x".repeat(hook.REQUEST_MAX) }) }));
    assert.equal(huge.status, 413);
    const r = await hook.handleInbound(req(generic("nobody.zzzzz@in.wesimplify.works")));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, ignored: true });
    // A 1 MB+ text body is accepted, capped, and stored shorter.
    const { user, address } = await makeUser();
    const ok = await hook.handleInbound(req(generic(address, { text: "Thank you for applying. ".repeat(60_000) })));
    assert.equal(ok.status, 200);
    const m = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(m.body.length <= 100_000);
  });
});

describe("delivery", () => {
  test("Postmark letter to the alias moves the application exactly like the engine path; +tag/case/Delivered-To map", async () => {
    const { user, campaign, alias } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme");
    const p = postmarkPayload({ OriginalRecipient: "", Headers: [
      { Name: "Received-SPF", Value: `Pass (sender SPF authorized) identity=mailfrom; client-ip=209.85.1.1; envelope-from=${user.email.replace("@", "+caf_=x@")}; receiver=abc@inbound.postmarkapp.com` },
      { Name: "X-Spam-Tests", Value: "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU,SPF_PASS" },
      { Name: "Message-ID", Value: "<pm-1@acme.com>" },
      { Name: "Delivered-To", Value: user.email },
      { Name: "X-Original-To", Value: `${alias.toUpperCase()}+Jobs@IN.WESIMPLIFY.WORKS` },
    ] });
    const r = await hook.handleInbound(req(p, { how: "basic" }));
    assert.equal(r.status, 200);
    const msgs = await db.inboxMessage.findMany({ where: { userId: user.id } });
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].source, "forward");
    assert.equal(msgs[0].externalId, "pm-1@acme.com");
    assert.equal(msgs[0].classification, "interview");
    assert.equal(msgs[0].opportunityId, opp.id);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "recruiter");
    assert.equal(await db.interview.count({ where: { opportunityId: opp.id } }), 1);
  });

  test("dedupe by Message-ID, also under 30 concurrent retries", async () => {
    const { user, campaign, address } = await makeUser();
    await makeOpp(campaign.id, "Acme");
    const letter = generic(address, { messageId: "<dup-1@acme.com>", subject: "Unfortunately", text: "Unfortunately we decided to move forward with other candidates for Acme." });
    const all = await Promise.all(Array.from({ length: 30 }, () => hook.handleInbound(req(letter))));
    assert.ok(all.every((x) => x.status === 200));
    assert.equal(await db.inboxMessage.count({ where: { userId: user.id } }), 1);
    const again = await (await hook.handleInbound(req(letter))).json();
    assert.deepEqual(again.outcomes, ["duplicate"]);
  });

  test("one letter to two users' aliases reaches both; a duplicate alias holder never receives", async () => {
    const a = await makeUser("Aliya");
    const b = await makeUser("Bek");
    await hook.handleInbound(req(generic(a.address, { headers: { cc: `${b.address}, someone@gmail.com` } })));
    assert.equal(await db.inboxMessage.count({ where: { userId: a.user.id } }), 1);
    assert.equal(await db.inboxMessage.count({ where: { userId: b.user.id } }), 1);
    // Force a collision (the column is not unique): ambiguous → ignored, nobody gets someone else's mail.
    await db.user.update({ where: { id: b.user.id }, data: { inboxAlias: a.alias } });
    const r = await (await hook.handleInbound(req(generic(a.address)))).json();
    assert.deepEqual(r, { ok: true, ignored: true });
  });

  test("newsletter mentioning the company with «unfortunately» is info and never moves the status", async () => {
    const { user, campaign, address } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme", "recruiter");
    await hook.handleInbound(req(generic(address, { from: "Weekly Jobs <digest@jobsnews.io>", subject: "This week in hiring", text: "Unfortunately Acme had layoffs. Acme is hiring other candidates. Unsubscribe.", headers: { "List-Unsubscribe": "<mailto:u@jobsnews.io>" } })));
    const m = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.ok(["info", "unknown"].includes(m.classification));
    assert.equal(m.opportunityId, opp.id, "still matched to the application by company name");
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: opp.id } })).status, "recruiter");
  });

  test("Gmail confirmation → shown in the setup card, never an inbox message; hidden after a real letter; regenerate kills the old alias", async () => {
    const { user, alias, address } = await makeUser();
    let st = await svc.forwardingStatus(user.id);
    assert.equal(st?.state, "live");
    assert.equal(st?.address, address);
    assert.equal(st?.lastAt, null);
    await hook.handleInbound(req({ to: address, from: GMAIL_RU.from, subject: GMAIL_RU.subject, text: GMAIL_RU.text, messageId: "<v1@google.com>", headers: GOOGLE_AUTH }));
    assert.equal(await db.inboxMessage.count({ where: { userId: user.id } }), 0);
    st = await svc.forwardingStatus(user.id);
    assert.equal(st?.verification?.code, "987654321");
    assert.match(st?.verification?.link ?? "", /^https:\/\/mail-settings\.google\.com\//);
    await svc.dismissVerification(user.id);
    assert.equal((await svc.forwardingStatus(user.id))?.verification, null);
    await hook.handleInbound(req({ to: address, from: GMAIL_EN.from, subject: GMAIL_EN.subject, text: GMAIL_EN.text, headers: GOOGLE_AUTH }));
    assert.equal((await svc.forwardingStatus(user.id))?.verification?.code, "123456789");
    await new Promise((r) => setTimeout(r, 5));
    await hook.handleInbound(req(generic(address)));
    st = await svc.forwardingStatus(user.id);
    assert.equal(st?.verification, null, "a real letter after the code means forwarding works");
    assert.ok(st?.lastAt);

    const next = await svc.regenerateAlias(user.id);
    assert.notEqual(next, alias);
    assert.equal((await svc.forwardingStatus(user.id))?.lastAt, null, "the new address waits for its first letter");
    assert.deepEqual(await (await hook.handleInbound(req(generic(address)))).json(), { ok: true, ignored: true });
    assert.equal((await hook.handleInbound(req(generic(`${next}@in.wesimplify.works`)))).status, 200);
  });

  test("a letter forwarded by hand («Fwd:») is read as the original sender's", () => {
    const l = svc.unwrapManualForward({ from: "Alan <alan@gmail.com>", subject: "Fwd: Interview", text: "see below\n\n---------- Forwarded message ---------\nFrom: Acme Talent <jobs@acme.com>\nDate: Mon\nSubject: Interview invitation — Data Analyst\nTo: alan@gmail.com\n\nWe would love to invite you..." });
    assert.equal(l.from, "Acme Talent <jobs@acme.com>");
    assert.equal(l.subject, "Interview invitation — Data Analyst");
    const ru = svc.unwrapManualForward({ from: "a@mail.ru", subject: "Пересл: Отклик", text: "-------- Пересылаемое сообщение --------\nОт кого: HR Kaspi <hr@kaspi.kz>\nТема: Ваш отклик\n\nК сожалению..." });
    assert.equal(ru.from, "HR Kaspi <hr@kaspi.kz>");
    assert.equal(ru.subject, "Ваш отклик");
    const plain = { from: "jobs@acme.com", subject: "Interview", text: "From: someone@else.com" };
    assert.deepEqual(svc.unwrapManualForward(plain), plain, "only Fwd: letters are unwrapped");
  });

  test("lazy alias: 20 concurrent first views agree on one address", async () => {
    const u = await db.user.create({ data: { email: `inbound-test-lazy-${Date.now()}@example.com`, passwordHash: "x", name: "Жанна" } });
    const got = await Promise.all(Array.from({ length: 20 }, () => svc.ensureAlias(u.id)));
    assert.equal(new Set(got).size, 1);
    assert.match(got[0], /^zhanna\.[a-z2-9]{5}$/);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).inboxAlias, got[0]);
  });

  test("simulation: always «connected», last time from the latest simulated employer reply", async () => {
    const { user } = await makeUser();
    process.env.SIMPLIFY_MODE = "simulation";
    const saved = process.env.INBOUND_EMAIL_SECRET;
    delete process.env.INBOUND_EMAIL_SECRET;
    try {
      assert.equal(svc.forwardingState(), "simulated");
      const at = new Date(Date.now() - 3600000);
      await db.inboxMessage.create({ data: { userId: user.id, fromAddr: "a@b.co", subject: "s", body: "b", simulated: true, receivedAt: at } });
      const st = await svc.forwardingStatus(user.id);
      assert.equal(st?.state, "simulated");
      assert.equal(st?.lastAt?.getTime(), at.getTime());
      process.env.SIMPLIFY_MODE = "live";
      assert.equal(svc.forwardingState(), "off");
      assert.equal(await svc.forwardingStatus(user.id), null);
    } finally {
      process.env.SIMPLIFY_MODE = "live";
      process.env.INBOUND_EMAIL_SECRET = saved;
    }
  });

  test("stress: 500-letter burst across 5 aliases — all accepted, none lost or doubled; the 101st in an hour is 429", async () => {
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => makeUser(`Stress${i}`)));
    for (const u of users) await makeOpp(u.campaign.id, "Acme");
    const t0 = Date.now();
    const res = await Promise.all(
      users.flatMap((u) => Array.from({ length: 100 }, (_, i) => hook.handleInbound(req(generic(u.address, { messageId: `<b-${u.alias}-${i}@acme.com>`, subject: i % 2 ? "Thank you for applying" : "Update", text: `Thank you for applying to Acme, letter ${i}.` }))))),
    );
    assert.ok(res.every((r) => r.status === 200), `statuses: ${[...new Set(res.map((r) => r.status))]}`);
    for (const u of users) assert.equal(await db.inboxMessage.count({ where: { userId: u.user.id, source: { in: svc.FORWARD_SOURCES } } }), 100);
    const over = await hook.handleInbound(req(generic(users[0].address)));
    assert.equal(over.status, 429);
    console.log(`  500 letters in ${Date.now() - t0} ms`);
  });
});

// ——— Sender authentication: who may move an application ———
const AR = (v: string) => ({ name: "Authentication-Results", value: v });
const AAR = (v: string) => ({ name: "ARC-Authentication-Results", value: v });

describe("sender authentication (pure)", () => {
  test("parses RFC 8601 / ARC results; comments dropped", () => {
    const p = parseAuthResults("mx.cloudflare.net; dkim=pass (2048-bit key) header.d=acme.com header.s=s1; spf=softfail smtp.mailfrom=x@y.io; dmarc=pass (p=REJECT) header.from=acme.com")!;
    assert.equal(p.authserv, "mx.cloudflare.net");
    assert.deepEqual(p.results.map((r) => `${r.method}=${r.result}`), ["dkim=pass", "spf=softfail", "dmarc=pass"]);
    assert.equal(parseAuthResults("i=2; mx.cloudflare.net; arc=pass", true)?.instance, 2);
    assert.equal(parseAuthResults("mx.cloudflare.net; arc=pass", true), null, "an ARC set needs its instance");
  });

  const H = (...xs: { name: string; value: string }[]) => xs.map((x) => [x.name.toLowerCase(), x.value] as [string, string]);
  test("our receiver's aligned pass counts; unaligned, failed, foreign-authserv and lower (injected) verdicts don't", () => {
    assert.ok(authVerdict("HR <hr@acme.com>", H(AR("mx.cloudflare.net; dmarc=pass header.from=acme.com")), "generic").pass);
    assert.ok(authVerdict("hr@careers.acme.com", H(AR("mx.cloudflare.net; dkim=pass header.d=acme.com")), "generic").pass, "subdomain alignment");
    assert.ok(authVerdict("hr@acme.com", H(AR("mx.cloudflare.net; spf=pass smtp.mailfrom=bounce@mail.acme.com")), "generic").pass);
    assert.ok(!authVerdict("hr@acme.com", H(AR("mx.cloudflare.net; dkim=pass header.d=evil.com")), "generic").pass, "not aligned");
    assert.ok(!authVerdict("hr@acme.com", H(AR("mx.cloudflare.net; dkim=fail header.d=acme.com; dmarc=fail header.from=acme.com")), "generic").pass);
    assert.ok(!authVerdict("hr@acme.com", H(AR("evil-mx.example; dmarc=pass header.from=acme.com")), "generic").pass, "untrusted authserv-id");
    assert.ok(!authVerdict("hr@acme.com", H(AR("mx.cloudflare.net; dkim=none"), AR("mx.cloudflare.net; dkim=pass header.d=acme.com")), "generic").pass, "only the topmost header");
    assert.ok(!authVerdict("hr@acme.com", [], "generic").pass);
    // Postmark's own headers only for Postmark payloads.
    const pm = H({ name: "X-Spam-Tests", value: "DKIM_SIGNED,DKIM_VALID,DKIM_VALID_AU" });
    assert.ok(authVerdict("hr@acme.com", pm, "postmark").pass);
    assert.ok(!authVerdict("hr@acme.com", pm, "generic").pass);
    assert.ok(!authVerdict("hr@acme.com", H({ name: "Received-SPF", value: "Pass identity=mailfrom; envelope-from=hr@acme.com; receiver=x@evil.io" }), "postmark").pass);
  });

  test("ARC: a trusted forwarder's verdict counts only behind our receiver's arc=pass", () => {
    const chain = (arc: string) => H(AAR(`i=2; mx.cloudflare.net; arc=${arc}; spf=pass smtp.mailfrom=aliya+caf_=x@gmail.com`), AAR("i=1; mx.google.com; dkim=pass header.i=@acme.com; dmarc=pass header.from=acme.com"));
    const v = authVerdict("hr@acme.com", chain("pass"), "generic");
    assert.equal(v.pass, true);
    assert.equal(v.method, "arc");
    assert.ok(!authVerdict("hr@acme.com", chain("fail"), "generic").pass);
    assert.ok(!authVerdict("hr@acme.com", H(AAR("i=2; mx.cloudflare.net; arc=pass"), AAR("i=1; mx.evil.io; dmarc=pass header.from=acme.com")), "generic").pass, "untrusted forwarder");
  });

  test("forwarding chain and company domain", () => {
    assert.equal(normMailbox("A.Liya+caf_=x=in.wesimplify.works@GoogleMail.com"), "aliya@gmail.com");
    assert.ok(forwardedFrom({ "x-forwarded-for": "aliya@gmail.com alias.abcde@in.wesimplify.works" }, ["aliya@gmail.com"]));
    assert.ok(forwardedFrom({ "return-path": "<a.liya+caf_=alias=in.wesimplify.works@gmail.com>" }, ["aliya@gmail.com"]));
    assert.ok(!forwardedFrom({ "x-forwarded-for": "other@gmail.com" }, ["aliya@gmail.com"]));
    assert.ok(!forwardedFrom({}, []));
    assert.ok(domainNamesCompany("mail.acme.com", "Acme Inc"));
    assert.ok(domainNamesCompany("kaspi.kz", "Kaspi.kz"));
    assert.ok(!domainNamesCompany("evil.com", "Acme"));
    assert.ok(!domainNamesCompany("acme-careers.io", "Acme"), "a longer lookalike label");
    assert.ok(domainNamesCompany("kaspi.kz", "Kaspi Bank"));
  });
});

describe("delivery: forged vs authenticated letters", () => {
  const OFFER = { subject: "Job offer — Data Analyst", text: "We are pleased to offer you the Data Analyst position at Acme. Base salary $90,000. Please sign the offer letter by Friday." };
  const REJECT = { subject: "Your application", text: "Unfortunately we decided to move forward with other candidates for the Data Analyst role at Acme." };
  const INTERVIEW = { subject: "Interview invitation", text: "We would love to invite you to an interview for the Data Analyst role at Acme. Please schedule a call." };
  const mid = () => `<${Math.random().toString(36).slice(2)}@acme.com>`;
  /** A letter the user's Gmail auto-forwarded: ARC chain sealed by Google, verified by our receiver. */
  const forwarded = (mailbox: string, domain = "acme.com") => [
    AAR(`i=2; mx.cloudflare.net; arc=pass; spf=pass smtp.mailfrom=${mailbox.replace("@", "+caf_=x@")}`),
    AR(`mx.cloudflare.net; arc=pass; spf=pass smtp.mailfrom=${mailbox.replace("@", "+caf_=x@")}`),
    AAR(`i=1; mx.google.com; dkim=pass header.i=@${domain}; spf=pass smtp.mailfrom=bounce@${domain}; dmarc=pass header.from=${domain}`),
    { name: "X-Forwarded-For", value: `${mailbox} alias@in.wesimplify.works` },
    { name: "Delivered-To", value: mailbox },
  ];
  const statusOf = async (id: string) => (await db.opportunity.findUniqueOrThrow({ where: { id } })).status;

  test("a forged, unauthenticated offer is stored and shown but inert: no status move, no Offer, no Interview", async () => {
    const { user, campaign, address } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme", "recruiter");
    // Claims to come through the user's own mailbox, but nothing authenticates acme.com.
    const r = await (await hook.handleInbound(req(generic(address, { ...OFFER, from: "Acme HR <hr@acme.com>", messageId: mid(), headers: [{ name: "X-Forwarded-For", value: user.email }] })))).json();
    assert.deepEqual(r.outcomes, ["unverified"]);
    const m = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(m.source, svc.UNVERIFIED_SOURCE);
    assert.equal(m.classification, "offer", "classification kept for display");
    assert.equal(m.opportunityId, opp.id);
    assert.equal(await statusOf(opp.id), "recruiter");
    assert.equal(await db.offer.count({ where: { userId: user.id } }), 0);
    // A forged interview / rejection: the same.
    await hook.handleInbound(req(generic(address, { ...INTERVIEW, messageId: mid() })));
    await hook.handleInbound(req(generic(address, { ...REJECT, messageId: mid(), headers: [AR("mx.cloudflare.net; dkim=none; spf=fail smtp.mailfrom=x@evil.io"), AR("mx.cloudflare.net; dmarc=pass header.from=acme.com"), { name: "Delivered-To", value: user.email }] })));
    assert.equal(await statusOf(opp.id), "recruiter");
    assert.equal(await db.interview.count({ where: { opportunityId: opp.id } }), 0);
    assert.equal(await db.inboxMessage.count({ where: { userId: user.id, source: svc.UNVERIFIED_SOURCE } }), 3);
  });

  test("authenticated auto-forward from the confirmed mailbox with the company's domain applies (rejection, offer)", async () => {
    const { user, campaign, address } = await makeUser();
    const a = await makeOpp(campaign.id, "Acme", "submitted");
    // Authenticated Gmail confirmation names the mailbox that forwards: aliya@gmail.com.
    await hook.handleInbound(req({ to: address, from: GMAIL_RU.from, subject: GMAIL_RU.subject, text: GMAIL_RU.text, headers: GOOGLE_AUTH }));
    const r = await (await hook.handleInbound(req(generic(address, { ...REJECT, from: "Acme Talent <jobs@acme.com>", messageId: mid(), headers: forwarded("aliya@gmail.com") })))).json();
    assert.deepEqual(r.outcomes, ["delivered"]);
    assert.equal(await statusOf(a.id), "rejected");
    const m = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(m.source, "forward");

    const b = await makeOpp(campaign.id, "Globex", "final");
    await hook.handleInbound(req(generic(address, { subject: "Offer from Globex", text: "We are pleased to offer you the Data Analyst position at Globex. Base salary $90,000.", from: "Globex People <people@globex.io>", messageId: mid(), headers: forwarded("a.liya@gmail.com", "globex.io") })));
    assert.equal(await statusOf(b.id), "offer");
    assert.equal(await db.offer.count({ where: { opportunityId: b.id } }), 1);
  });

  test("the account e-mail counts as the forwarding mailbox; an ATS domain naming the company applies", async () => {
    const { user, campaign, address } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme", "submitted");
    await hook.handleInbound(req(generic(address, { ...INTERVIEW, from: "Acme via Greenhouse <no-reply@us.greenhouse-mail.io>", messageId: mid(), headers: forwarded(user.email, "us.greenhouse-mail.io") })));
    assert.equal(await statusOf(opp.id), "recruiter");
  });

  test("authenticated but inert: another mailbox, a sender domain that isn't the company, a display name only", async () => {
    const { user, campaign, address } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme", "submitted");
    // Not through the user's mailbox (direct to the alias, or someone else's forwarding).
    await hook.handleInbound(req(generic(address, { ...REJECT, messageId: mid(), headers: [AR("mx.cloudflare.net; dmarc=pass header.from=acme.com")] })));
    await hook.handleInbound(req(generic(address, { ...REJECT, messageId: mid(), headers: forwarded("stranger@gmail.com") })));
    // The attacker's own authenticated domain with the company in the display name.
    await hook.handleInbound(req(generic(address, { ...REJECT, from: "Acme Talent <hr@acme-careers-team.io>", messageId: mid(), headers: forwarded(user.email, "acme-careers-team.io") })));
    await hook.handleInbound(req(generic(address, { ...REJECT, from: "Acme Talent <hr@evil.io>", messageId: mid(), headers: forwarded(user.email, "evil.io") })));
    assert.equal(await statusOf(opp.id), "submitted");
    assert.equal(await db.inboxMessage.count({ where: { userId: user.id, source: svc.UNVERIFIED_SOURCE } }), 4);
  });

  test("a letter forwarded by hand («Fwd:» in the body) is shown with its classification but never applied", async () => {
    const { user, campaign, address } = await makeUser();
    const opp = await makeOpp(campaign.id, "Acme", "recruiter");
    const text = "see below\n\n---------- Forwarded message ---------\nFrom: Acme Talent <jobs@acme.com>\nSubject: Job offer — Data Analyst\n\nWe are pleased to offer you the Data Analyst position at Acme. Base salary $90,000.";
    // Even from the user's own authenticated mailbox.
    await hook.handleInbound(req(generic(address, { subject: "Fwd: Job offer", text, from: `Me <${user.email}>`, messageId: mid(), headers: [AR(`mx.cloudflare.net; dmarc=pass header.from=${user.email.split("@")[1]}`), { name: "Delivered-To", value: user.email }] })));
    const m = await db.inboxMessage.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(m.fromAddr, "Acme Talent <jobs@acme.com>");
    assert.equal(m.classification, "offer");
    assert.equal(m.source, svc.UNVERIFIED_SOURCE);
    assert.equal(await statusOf(opp.id), "recruiter");
    assert.equal(await db.offer.count({ where: { userId: user.id } }), 0);
  });

  test("phishing confirmation: an unauthenticated letter never shows a link, never names a mailbox, never replaces a pending code", async () => {
    const { user, address } = await makeUser();
    // Forged «Gmail» confirmation with a well-formed Google link: code only, no link, no requester.
    await hook.handleInbound(req({ to: address, from: GMAIL_EN.from, subject: GMAIL_EN.subject, text: GMAIL_EN.text }));
    let st = await svc.forwardingStatus(user.id);
    assert.equal(st?.verification?.code, "123456789");
    assert.equal(st?.verification?.link, null);
    assert.equal(st?.verification?.requester, null);
    // The genuine one replaces it; a later forgery can't overwrite the genuine pending code.
    await hook.handleInbound(req({ to: address, from: GMAIL_RU.from, subject: GMAIL_RU.subject, text: GMAIL_RU.text, headers: GOOGLE_AUTH }));
    await hook.handleInbound(req({ to: address, from: GMAIL_EN.from, subject: GMAIL_EN.subject.replace("123456789", "111111111"), text: GMAIL_EN.text.replace("123456789", "111111111") }));
    st = await svc.forwardingStatus(user.id);
    assert.equal(st?.verification?.code, "987654321");
    assert.match(st?.verification?.link ?? "", /^https:\/\/mail-settings\.google\.com\/mail\/vf-/);
    // The forged requester (alan@gmail.com) is not a trusted mailbox: its forwards stay inert.
    const { campaign } = { campaign: await db.campaign.findFirstOrThrow({ where: { userId: user.id } }) };
    const opp = await makeOpp(campaign.id, "Acme", "submitted");
    await hook.handleInbound(req(generic(address, { ...REJECT, messageId: mid(), headers: forwarded("alan@gmail.com") })));
    assert.equal(await statusOf(opp.id), "submitted");
    await hook.handleInbound(req(generic(address, { ...REJECT, messageId: mid(), headers: forwarded("aliya@gmail.com") })));
    assert.equal(await statusOf(opp.id), "rejected");
  });
});
