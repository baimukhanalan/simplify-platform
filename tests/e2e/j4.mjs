// Journey 4: Approvals (approve/edit/reject/handoff), Inbox paste per class, notifications API + mark-read, push moment dismissal.
import { Client, db, form, check, findings, signupNew } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const { c, inv } = await newPaidUser("j4", { quiet: true });
await payInvoice(c, inv, "success");
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
const byId = (id) => db.opportunity.findUnique({ where: { id }, include: { job: true } });
const resolve = (id, decision, answer) => c.action("ops.resolveApproval", [form(answer === undefined ? { id, decision } : { id, decision, answer })], { page: "/app/approvals" });

let pg = await c.get("/app/approvals");
check(pg.status === 200, "J4.page", "approvals page renders", pg.status);
const pending = await db.approval.findMany({ where: { userId: c.user.id, status: "pending" }, include: { opportunity: true } });
console.log("  pending approvals after first tick:", pending.length, "kinds:", [...new Set(pending.map((a) => a.kind))].join(","));

// 1. Approve with empty proposal (sensitive) -> must not be silently ignored by the button that is shown
const sens = pending.find((a) => a.kind === "sensitive");
check(!!sens, "J4.sens.exists", "sensitive approval exists");
let r = await resolve(sens.id, "approve");
let a = await db.approval.findUnique({ where: { id: sens.id } });
check(a.status === "pending", "J4.sens.approve.empty", "approve with empty proposal is a no-op (UI hides the button)", a.status);

// 2. Edit (quick answer) on sensitive — below-threshold role must NOT get auto-submitted by answering
const oppBefore = await byId(sens.opportunityId);
const autonomy = JSON.parse((await db.user.findUnique({ where: { id: c.user.id } })).autonomy || "{}");
r = await resolve(sens.id, "edit", "I don't wish to answer");
a = await db.approval.findUnique({ where: { id: sens.id } });
const oppAfter = await byId(sens.opportunityId);
const pkgAns = JSON.parse((await db.applicationPackage.findUnique({ where: { opportunityId: sens.opportunityId } })).answers).find((x) => x.q === sens.question);
check(a.status === "edited" && a.answer === "I don't wish to answer", "J4.edit", "edit saves the typed answer", { st: a.status, ans: a.answer });
check(pkgAns?.a === "I don't wish to answer" && pkgAns.status === "approved", "J4.edit.pkg", "package answer patched", pkgAns);
console.log(`  role match=${oppBefore.match} decision='${oppBefore.decision}' threshold=${autonomy.autoApplyMinMatch ?? 85}: status ${oppBefore.status} -> ${oppAfter.status}`);
if (oppBefore.match < (autonomy.autoApplyMinMatch ?? 85) && !oppBefore.decision) {
  check(oppAfter.status !== "submitted", "J4.threshold", `answering an approval must not submit a role below the auto-apply threshold the user never chose (match ${oppBefore.match} < 85)`, `${oppBefore.status} -> ${oppAfter.status}`);
}
// standing answer reuse: the next package with the same sensitive question should not ask again
const q2 = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: "qualified" } });
await c.action("opportunities.decideOpportunity", [{}, form({ id: q2.id, decision: "apply" })], { page: "/app/opportunities" });
const again = await db.approval.count({ where: { opportunityId: q2.id, kind: "sensitive", status: "pending" } });
check(again === 0, "J4.standing", "answered sensitive question is reused as a standing answer on the next package", again);

// 3. Approve with a proposal (find one with proposed text; answerStandard-off not needed: sponsorship/legal may have text)
const withProposal = await db.approval.findFirst({ where: { userId: c.user.id, status: "pending", NOT: { proposed: "" }, kind: { not: "handoff" } } });
if (withProposal) {
  r = await resolve(withProposal.id, "approve");
  a = await db.approval.findUnique({ where: { id: withProposal.id } });
  check(a.status === "approved" && a.answer === withProposal.proposed.trim(), "J4.approve", "approve uses the proposal", a.status);
} else console.log("  (no approval with a proposed answer in this run)");

// 4. Reject -> vacancy skipped + other approvals on it rejected
// Standing answers (approve/edit above) now close every identical pending question, so the queue can be empty here.
// Seed non-standing questions (unknown_question) on two untouched roles so reject / blank-edit / foreign checks still run.
if (!(await db.approval.count({ where: { userId: c.user.id, status: "pending", kind: { not: "handoff" } } }))) {
  const spare = await db.opportunity.findMany({ where: { campaignId: camp.id, status: "qualified", decision: "" }, take: 2 });
  for (const [i, o] of spare.entries()) await db.approval.create({ data: { userId: c.user.id, opportunityId: o.id, kind: "unknown_question", question: `E2E custom question ${i}`, proposed: "" } });
}
const rej = await db.approval.findFirst({ where: { userId: c.user.id, status: "pending", kind: { not: "handoff" } }, include: { opportunity: true } });
r = await resolve(rej.id, "reject");
const ro = await byId(rej.opportunityId);
const left = await db.approval.count({ where: { opportunityId: rej.opportunityId, status: "pending" } });
check(ro.status === "skipped" && left === 0, "J4.reject", "reject -> vacancy skipped, no pending left", { st: ro.status, left });
await c.action("campaign.runAgentNow", [], { page: "/app" });
check((await byId(rej.opportunityId)).status === "skipped", "J4.reject.sticky", "rejected vacancy stays skipped after a run");
// edit with empty answer -> no-op
const e2 = await db.approval.findFirst({ where: { userId: c.user.id, status: "pending", kind: { not: "handoff" } } });
if (e2) { await resolve(e2.id, "edit", "   "); check((await db.approval.findUnique({ where: { id: e2.id } })).status === "pending", "J4.edit.empty", "edit with blank answer ignored"); }
// foreign user can't resolve
const { c: other } = await signupNew("j4other");
if (e2) { await other.action("ops.resolveApproval", [form({ id: e2.id, decision: "reject" })], { page: "/app/approvals" }); check((await db.approval.findUnique({ where: { id: e2.id } })).status === "pending", "J4.foreign", "foreign user can't resolve approval"); }

// 5. Handoff: live (non-demo) vacancy
const base = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: "qualified" }, include: { job: true } });
const { id: _i, opportunities: _o, ...jobData } = base.job;
const live = await db.job.create({ data: { ...jobData, source: "remotive", externalId: "e2e-live-" + Date.now(), dedupeKey: "e2e-live-" + Date.now(), company: "LiveCo", url: "https://jobs.lever.co/liveco/e2e-apply" } });
const lopp = await db.opportunity.create({ data: { campaignId: camp.id, jobId: live.id, match: 90, eligibility: "eligible", status: "qualified", pInterview: 0.2, priority: 0.2, segment: base.segment } });
r = await c.action("opportunities.decideOpportunity", [{}, form({ id: lopp.id, decision: "apply" })], { page: "/app/opportunities" });
console.log("  apply on live vacancy ->", JSON.stringify(r.result));
// answer any non-handoff question first
for (const ap of await db.approval.findMany({ where: { opportunityId: lopp.id, status: "pending", kind: { not: "handoff" } } })) await resolve(ap.id, "edit", "Yes");
let ho = await db.approval.findFirst({ where: { opportunityId: lopp.id, kind: "handoff", status: "pending" } });
if (!ho) { await c.action("opportunities.decideOpportunity", [{}, form({ id: lopp.id, decision: "apply" })], { page: "/app/opportunities" }); ho = await db.approval.findFirst({ where: { opportunityId: lopp.id, kind: "handoff", status: "pending" } }); }
check(!!ho, "J4.handoff.created", "live vacancy creates a handoff item", (await byId(lopp.id)).status);
pg = await c.get("/app/approvals");
check(pg.status === 200 && pg.text.includes("LiveCo") && pg.text.includes("https://jobs.lever.co/liveco/e2e-apply"), "J4.handoff.render", "handoff card renders with the official form link (a real host: demo *.example / example.com links are never rendered — round 6)");
if (ho) {
  r = await resolve(ho.id, "approve");
  check((await db.approval.findUnique({ where: { id: ho.id } })).status === "pending", "J4.handoff.noresolve", "resolveApproval refuses handoff items");
  r = await c.action("ops.confirmUserSubmitted", [form({ id: lopp.id })], { page: "/app/approvals" });
  const lo = await byId(lopp.id);
  const hs = await db.approval.findUnique({ where: { id: ho.id } });
  check(lo.status === "submitted" && hs.status === "approved", "J4.handoff.done", "«Я отправил» -> submitted, handoff closed", { st: lo.status, ho: hs.status });
  const pk = await db.applicationPackage.findUnique({ where: { opportunityId: lopp.id } });
  check(pk.submitMethod === "user-handoff", "J4.handoff.method", "submitMethod user-handoff", pk.submitMethod);
}

// 6. Inbox paste for each class
const submittedOpps = await db.opportunity.findMany({ where: { campaignId: camp.id, status: "submitted" }, include: { job: true } });
// make sure we have >= 5 submitted demo roles
const prepared = await db.opportunity.findMany({ where: { campaignId: camp.id, status: { in: ["prepared", "qualified"] }, job: { source: "demo" } }, take: 8 });
for (const p of prepared) {
  if (submittedOpps.length >= 6) break;
  await db.approval.updateMany({ where: { opportunityId: p.id, status: "pending" }, data: { status: "approved", answer: "x", resolvedAt: new Date() } });
  await c.action("opportunities.decideOpportunity", [{}, form({ id: p.id, decision: "apply" })], { page: "/app/opportunities" });
  const s = await byId(p.id);
  if (s.status === "submitted") submittedOpps.push(s);
}
check(submittedOpps.length >= 5, "J4.setup.submitted", "have ≥5 submitted roles for inbox tests", submittedOpps.length);
const uniq = []; const seenCo = new Set();
for (const o of submittedOpps) if (!seenCo.has(o.job.company)) { seenCo.add(o.job.company); uniq.push(o); }
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const EMAILS = [
  { cls: "confirmation", to: "pending", subject: "We received your application", body: (o) => `Hi, thank you for applying to ${o.job.company}. We have received your application for ${o.job.title} and will review it shortly.` },
  { cls: "rejection", to: "rejected", subject: "Your application", body: (o) => `Hi, thank you for your interest in ${o.job.company}. Unfortunately, we have decided to move forward with other candidates.` },
  { cls: "assessment", to: "assessment", subject: "Online assessment", body: (o) => `Hi, as a next step at ${o.job.company} please complete this coding challenge on HackerRank within 5 days.` },
  { cls: "interview", to: "technical", subject: "Technical interview", body: (o) => `Hi, we would like to invite you to an interview: a technical round with live coding at ${o.job.company}. Please pick a time via calendly.com/x` },
  { cls: "offer", to: "offer", subject: "Offer letter", body: (o) => `Hi, we are pleased to extend a job offer for ${o.job.title} at ${o.job.company}. Base salary $72,000 per year. Offer letter attached.` },
];
const notifBefore = await db.notification.count({ where: { userId: c.user.id } });
for (let i = 0; i < EMAILS.length && i < uniq.length; i++) {
  const E = EMAILS[i], o = uniq[i];
  r = await c.action("ops.ingestPastedEmail", [{}, form({ from: `talent@${slug(o.job.company)}.example`, subject: E.subject, body: E.body(o) })], { page: "/app/inbox" });
  const res = r.result?.result;
  const after = await byId(o.id);
  check(res?.classification === E.cls && res.opportunityId === o.id, `J4.inbox.${E.cls}.class`, `paste ${E.cls} email classified + matched`, { cls: res?.classification, matched: res?.opportunityId === o.id, err: r.result?.error ?? r.error });
  check(after.status === E.to, `J4.inbox.${E.cls}.status`, `${E.cls} moves pipeline to ${E.to}`, after.status);
}
const ivs = await db.interview.findMany({ where: { userId: c.user.id } });
check(ivs.some((i) => i.round === "assessment") && ivs.some((i) => i.round === "technical"), "J4.inbox.rooms", "assessment + technical Interview Rooms created", ivs.map((i) => i.round));
const offer = await db.offer.findFirst({ where: { userId: c.user.id } });
check(offer?.base === 72000, "J4.inbox.offer", "offer created with base parsed from email", offer?.base);
r = await c.action("ops.ingestPastedEmail", [{}, form({ from: "", subject: "", body: "" })], { page: "/app/inbox" });
check(!!r.result?.error, "J4.inbox.empty", "empty paste -> validation error", r.result);
r = await c.action("ops.ingestPastedEmail", [{}, form({ from: "x@unknown.example", subject: "Hello", body: "Just a random newsletter about gardening tips and tricks for you" })], { page: "/app/inbox" });
check(r.result?.result && r.result.result.opportunityId === null, "J4.inbox.unmatched", "unrelated email saved unmatched", r.result?.result?.classification);
// rejection after offer must not reopen / regress; a rejection for a rejected role shouldn't notify
pg = await c.get("/app/inbox");
check(pg.status === 200, "J4.inbox.page", "inbox renders", pg.status);
for (const cl of ["interview", "assessment", "offer", "rejection", "confirmation", "info", "unknown", "bogus"]) { const x = await c.get(`/app/inbox?c=${cl}`); if (x.status !== 200) check(false, "J4.inbox.filter", `inbox ?c=${cl}`, x.status); }
const msg = await db.inboxMessage.findFirst({ where: { userId: c.user.id } });
check((await c.get(`/app/inbox?m=${msg.id}`)).status === 200, "J4.inbox.msg", "inbox message view");
const foreignMsg = await other.get(`/app/inbox?m=${msg.id}`);
check(!foreignMsg.text.includes(msg.subject) || msg.subject.length < 6, "J4.inbox.msg.foreign", "foreign user can't read the message");

// 7. Notifications API + mark read + push moment
const notifs = await db.notification.findMany({ where: { userId: c.user.id, readAt: null }, orderBy: { createdAt: "desc" } });
check(notifs.length >= 3 && notifs.length > notifBefore - 1, "J4.notif.created", "interview/assessment/offer notifications created", notifs.map((n) => n.type));
let api = await c.json("GET", "/api/notifications");
check(api.status === 200 && api.data.items.length === Math.min(10, notifs.length), "J4.notif.api", "GET /api/notifications lists unread", api.data.items?.length);
check((await new Client("anon").json("GET", "/api/notifications")).status === 401, "J4.notif.401", "signed-out -> 401");
pg = await c.get("/app");
check(pg.text.includes(notifs[0].title), "J4.push.render", "push moment shows the newest notification", notifs[0].title);
r = await c.action("notifications.dismissNotification", [form({ id: notifs[0].id })], { page: "/app" });
check((await db.notification.findUnique({ where: { id: notifs[0].id } })).readAt, "J4.push.dismiss", "dismiss marks read");
api = await c.json("GET", "/api/notifications");
check(!api.data.items.some((i) => i.id === notifs[0].id), "J4.notif.markread", "dismissed item gone from API");
// open -> redirect to target
r = await c.action("notifications.openNotification", [form({ id: notifs[1].id })], { page: "/app" });
check(r.redirect && /^\/app\//.test(r.redirect), "J4.push.open", "open notification redirects in-app", r.redirect);
const target = r.redirect?.split(";")[0];
if (target) check((await c.get(target)).status === 200, "J4.push.target", `notification target ${target} renders`);
// foreign dismiss
await other.action("notifications.dismissNotification", [form({ id: notifs[2].id })], { page: "/app" });
check(!(await db.notification.findUnique({ where: { id: notifs[2].id } })).readAt, "J4.push.foreign", "foreign user can't dismiss");
r = await other.action("notifications.openNotification", [form({ id: notifs[2].id })], { page: "/app" });
check(r.redirect?.startsWith("/app;") || r.redirect === "/app;replace" || r.redirect?.split(";")[0] === "/app", "J4.push.foreign.open", "foreign open -> /app", r.redirect);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
