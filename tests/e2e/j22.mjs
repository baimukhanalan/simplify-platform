// Journey 22 (shared dev server): inbound email forwarding. The alias is read from the inbox page; a Postmark-format
// letter is POSTed to /api/inbound/email with INBOUND_EMAIL_SECRET when the server has one (else: 503 is verified and the
// same letter is delivered in-process through the webhook's own parse + deliver code) → the application status moves; a
// Gmail forwarding-confirmation letter → its code is shown on the inbox page.
//   BASE=http://localhost:3500 node tests/e2e/j22.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, db, check, dbUser, visText, textProblems, getStable, done, env, engine } from "./lib-dev.mjs";

const DAY = 86400000;
const u = await dbUser("inbound", { name: "Ерлан Жумабаев" });
const camp = await db.campaign.create({ data: { userId: u.id, plan: "local", priceKzt: 29990, status: "active", startedAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() + 50 * DAY) } });
const job = await db.job.create({ data: { source: "demo", externalId: "e2e", dedupeKey: `e2e-test-${Date.now()}`, company: "Nomad Analytics", title: "Data Analyst", postedAt: new Date(Date.now() - 12 * DAY), countries: JSON.stringify(["KZ"]) } });
const opp = await db.opportunity.create({ data: { campaignId: camp.id, jobId: job.id, match: 88, status: "submitted", submittedAt: new Date(Date.now() - 6 * DAY) } });
const c = await new Client("inbound").asUser(u.id);

const page = await getStable(c, "/app/inbox");
const addr = page.text.match(/[a-z0-9]{2,16}\.[a-z0-9]{5}@[a-z0-9.-]+/)?.[0];
check(page.status === 200 && addr, "J22.alias", "inbox page shows the personal forwarding address", addr);
check((await db.user.findUnique({ where: { id: u.id } })).inboxAlias === addr?.split("@")[0], "J22.alias.db", "alias stored on the user");

const letter = (over = {}) => ({
  From: "talent@nomadanalytics.kz", FromFull: { Email: "talent@nomadanalytics.kz", Name: "Nomad Analytics Talent" },
  To: addr, ToFull: [{ Email: addr, Name: "" }], CcFull: [], BccFull: [], OriginalRecipient: addr,
  Subject: "Interview invitation — Data Analyst", MessageID: `e2e-${Date.now()}-${Math.random()}`,
  TextBody: "Здравствуйте! Приглашаем вас на интервью с рекрутером Nomad Analytics на позицию Data Analyst. Выберите удобное время: calendly.com/nomad/30min",
  HtmlBody: "", Headers: [
    { Name: "Message-ID", Value: `<e2e-${Date.now()}-${Math.random()}@nomadanalytics.kz>` },
    // Our receiver's verdict + the user's own mailbox in the forwarding chain (src/lib/inbound/auth.ts): only such letters move applications.
    { Name: "Authentication-Results", Value: "mx.cloudflare.net; dkim=pass header.d=nomadanalytics.kz; spf=pass smtp.mailfrom=nomadanalytics.kz; dmarc=pass header.from=nomadanalytics.kz" },
    { Name: "X-Forwarded-For", Value: `${u.email} ${addr}` },
  ], Attachments: [],
  ...over,
});

const secret = env.INBOUND_EMAIL_SECRET;
const anon = new Client("postmark");
let viaHttp = false;
if (!secret) {
  const r = await anon.json("POST", "/api/inbound/email", letter());
  check(r.status === 503, "J22.nosecret", "no INBOUND_EMAIL_SECRET on the server → 503", r);
} else {
  const unauth = await anon.json("POST", "/api/inbound/email", letter(), { "x-inbound-secret": "wrong" });
  check(unauth.status === 401, "J22.unauth", "wrong secret → 401", unauth);
  viaHttp = true;
}

async function deliver(body) {
  if (viaHttp) return (await anon.json("POST", "/api/inbound/email", body, { "x-inbound-secret": secret })).data;
  const f = path.join(os.tmpdir(), `e2e-inbound-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, JSON.stringify(body));
  try { return engine("deliver", f); } finally { fs.unlinkSync(f); }
}

// Unauthenticated letter (anyone can write to an alias): shown, but never moves the application.
const forged = await deliver(letter({ Headers: [{ Name: "Message-ID", Value: `<forged-${Date.now()}@x>` }] }));
check(JSON.stringify(forged).includes("unverified") && (await db.opportunity.findUnique({ where: { id: opp.id } })).status === "submitted", "J22.forged", "unauthenticated letter → unverified, status unchanged", forged);
const d1 = await deliver(letter());
check(JSON.stringify(d1).includes("delivered"), "J22.deliver", "employer letter delivered", d1);
const o1 = await db.opportunity.findUnique({ where: { id: opp.id } });
const msg = await db.inboxMessage.findFirst({ where: { userId: u.id, source: "forward", opportunityId: { not: null } }, orderBy: { receivedAt: "desc" } });
check(msg?.opportunityId === opp.id && msg.classification === "interview", "J22.classify", "letter linked to the application, classified interview", msg && { opp: msg.opportunityId, cls: msg.classification });
check(o1.status !== "submitted", "J22.status", "application status moved", o1.status);
const dupL = letter(); dupL.Headers[0].Value = `<dup-${Date.now()}@nomadanalytics.kz>`;
const dup = await deliver(dupL);
const dup2 = await deliver(dupL);
check(JSON.stringify(dup2).includes("duplicate"), "J22.dedupe", "same Message-ID delivered twice → duplicate", [dup, dup2]);
const stranger = await deliver(letter({ To: "nobody.zzzzz@in.wesimplify.works", ToFull: [{ Email: "nobody.zzzzz@in.wesimplify.works", Name: "" }], OriginalRecipient: "nobody.zzzzz@in.wesimplify.works", Headers: [] }));
check(JSON.stringify(stranger).includes("unknown_recipient"), "J22.unknown", "unknown alias → unknown_recipient", stranger);

// Gmail forwarding confirmation → code on the inbox page
const gmail = await deliver(letter({
  From: "forwarding-noreply@google.com", FromFull: { Email: "forwarding-noreply@google.com", Name: "Gmail Team" },
  Subject: "(#482913756) Gmail Forwarding Confirmation - Receive Mail from erlan@gmail.com",
  TextBody: `erlan@gmail.com has requested to automatically forward mail to your email address ${addr}.\nConfirmation code: 482913756\n\nTo allow erlan@gmail.com to automatically forward mail to your address, please click the link below to confirm the request:\nhttps://mail-settings.google.com/mail/vf-%5BANGjdJ8%5D-abc`,
  Headers: [{ Name: "Message-ID", Value: `<gmail-${Date.now()}@google.com>` }],
}));
check(JSON.stringify(gmail).includes("verification"), "J22.gmail", "Gmail confirmation recognised", gmail);
const p2 = await getStable(c, "/app/inbox");
const t2 = visText(p2.text);
check(t2.includes("482913756"), "J22.gmail.code", "confirmation code shown on the inbox page", t2.match(/.{0,120}482913756.{0,80}/)?.[0]);
for (const prob of textProblems(p2.text)) check(false, "J22.inbox.text", "inbox visible text", prob);
check(!(await db.inboxMessage.findFirst({ where: { userId: u.id, subject: { contains: "Gmail Forwarding" } } })), "J22.gmail.notmail", "confirmation letter isn't stored as employer mail");
const ap = await getStable(c, `/app/applications/${opp.id}`);
check(ap.status === 200 && /Nomad Analytics/.test(ap.text), "J22.appPage", "application page renders after the status move", ap.status);

await db.opportunity.deleteMany({ where: { jobId: job.id } });
await db.job.delete({ where: { id: job.id } });
await done();
