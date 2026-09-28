// Journey 3: Opportunities decisions, auto-apply toggle, detail actions, Applications kanban, application detail, CV PDF.
import { Client, db, form, check, findings, signupNew, isNotFound } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const { c, inv } = await newPaidUser("j3", { quiet: true });
await payInvoice(c, inv, "success");
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
const opp = (where) => db.opportunity.findFirst({ where: { campaignId: camp.id, ...where }, include: { job: true } });
const byId = (id) => db.opportunity.findUnique({ where: { id } });
const decide = (id, decision, page = "/app/opportunities") => c.action("opportunities.decideOpportunity", [{}, form({ id, decision })], { page });

// Page renders
let pg = await c.get("/app/opportunities");
check(pg.status === 200, "J3.page", "opportunities page renders", pg.status);
for (const t of ["all", "skipped", "applied", "blocked", "bogus"]) {
  const r = await c.get(`/app/opportunities?tab=${t}`);
  check(r.status === 200, `J3.tab.${t}`, `opportunities ?tab=${t}`, r.status);
}
const r999 = await c.get("/app/opportunities?tab=all&page=999");
check(r999.status === 200, "J3.page999", "page=999 renders (no crash)", r999.status);
const rneg = await c.get("/app/opportunities?tab=all&page=-1");
check(rneg.status === 200, "J3.pageneg", "page=-1 renders", rneg.status);

// SKIP a qualified role, agent run must not revive it, then Вернуть
const q1 = await opp({ status: "qualified" });
let r = await decide(q1.id, "skip");
let o = await byId(q1.id);
check(r.result?.ok && o.status === "skipped" && o.decision === "skip", "J3.skip", "Skip -> skipped", { res: r.result, st: o.status });
await c.action("campaign.runAgentNow", [], { page: "/app" });
o = await byId(q1.id);
check(o.status === "skipped", "J3.skip.sticky", "manual skip survives runAgentNow", o.status);
r = await decide(q1.id, "reset");
o = await byId(q1.id);
check(r.result?.ok && ["qualified", "found"].includes(o.status) && o.decision === "", "J3.reset", "Вернуть -> back in queue", { st: o.status, d: o.decision, res: r.result });

// AUTO on a qualified role -> decision auto; next run prioritises it
const q2 = await opp({ status: "qualified", decision: "" });
r = await decide(q2.id, "auto");
o = await byId(q2.id);
check(r.result?.ok && o.decision === "auto", "J3.auto", "Auto -> decision auto", { res: r.result, d: o.decision });
// Auto toggle off (button sends reset when decision=auto)
r = await decide(q2.id, "reset");
check((await byId(q2.id)).decision === "", "J3.auto.off", "Auto again (reset) clears decision");
await decide(q2.id, "auto");

// APPLY on a qualified role
const q3 = await opp({ status: "qualified", decision: "" });
r = await decide(q3.id, "apply");
o = await byId(q3.id);
const pend = await db.approval.count({ where: { opportunityId: q3.id, status: "pending" } });
console.log("  apply result:", JSON.stringify(r.result), "status:", o.status, "pending approvals:", pend);
check(r.result?.ok && (o.status === "submitted" || (o.status === "prepared" && pend > 0)), "J3.apply", "Apply -> submitted or prepared+approvals", { st: o.status, pend });

// APPLY on a blocked role -> error
const blocked = await opp({ eligibility: "blocked" });
r = await decide(blocked.id, "apply");
check(r.result?.error && (await byId(blocked.id)).status === "skipped", "J3.apply.blocked", "Apply on hard-blocked -> error", r.result);
r = await decide(blocked.id, "reset");
check((await byId(blocked.id)).status === "skipped", "J3.reset.blocked", "Вернуть on blocked keeps it skipped", r.result);

// Invalid decision / foreign opportunity
r = await decide(q3.id, "nuke");
check(r.result?.error, "J3.baddecision", "unknown decision -> error", r.result);
const { c: other } = await signupNew("j3other");
r = await other.action("opportunities.decideOpportunity", [{}, form({ id: q3.id, decision: "skip" })], { page: "/app/opportunities" });
check(r.result?.error && (await byId(q3.id)).status !== "skipped", "J3.foreign", "foreign user cannot decide", r.result);
r = await other.action("ops.setOpportunityStatus", [form({ id: q3.id, status: "skipped" })], { page: "/app/opportunities" });
check((await byId(q3.id)).status !== "skipped", "J3.foreign.move", "foreign user cannot move status");

// Auto-apply toggle
r = await c.action("opportunities.setAutoApply", [false], { page: "/app/opportunities" });
let u = await db.user.findUnique({ where: { id: c.user.id } });
check(r.result?.ok && JSON.parse(u.autonomy).submitApplications === false, "J3.autoapply.off", "auto-apply off persisted", u.autonomy);
pg = await c.get("/app/opportunities");
check(/aria-checked="false"/.test(pg.text), "J3.autoapply.render", "toggle renders off after reload");
const agentPg = await c.get("/app/agent");
check(!/name="submitApplications"[^>]*checked/.test(agentPg.text), "J3.autoapply.agent", "Agent screen shows Submit applications OFF too");
r = await c.action("opportunities.setAutoApply", [true], { page: "/app/opportunities" });
u = await db.user.findUnique({ where: { id: c.user.id } });
check(JSON.parse(u.autonomy).submitApplications === true, "J3.autoapply.on", "auto-apply on persisted");
r = await c.action("opportunities.setAutoApply", ["yes please"], { page: "/app/opportunities" });
u = await db.user.findUnique({ where: { id: c.user.id } });
check(typeof JSON.parse(u.autonomy).submitApplications === "boolean", "J3.autoapply.type", "setAutoApply stores a boolean even for non-boolean input", u.autonomy);
await c.action("opportunities.setAutoApply", [true], { page: "/app/opportunities" });

// Opportunity detail
const found = await opp({ status: { in: ["found", "qualified"] }, decision: "" });
pg = await c.get(`/app/opportunities/${found.id}`);
check(pg.status === 200, "J3.detail", "opportunity detail renders", pg.status);
check(isNotFound(await other.get(`/app/opportunities/${found.id}`)), "J3.detail.foreign", "foreign opportunity detail -> 404");
check(isNotFound(await c.get(`/app/opportunities/nope`)), "J3.detail.missing", "missing opportunity -> 404");
r = await c.action("campaign.prepareOpportunity", [form({ id: found.id })], { page: `/app/opportunities/${found.id}` });
o = await byId(found.id);
const pkg = await db.applicationPackage.findUnique({ where: { opportunityId: found.id } });
check(!!pkg, "J3.detail.prepare", "«Показать версию сейчас» builds a package", { status: o.status });
check(o.status === found.status, "J3.detail.prepare.status", "«Показать версию сейчас» (preview) should not move the role out of the agent queue", { before: found.status, after: o.status });
pg = await c.get(`/app/opportunities/${found.id}`);
check(pg.status === 200, "J3.detail.after", "detail renders after prepare", pg.status);

// Applications kanban: submit something first
const sub = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: "prepared" } });
await db.approval.updateMany({ where: { opportunityId: sub.id, status: "pending" }, data: { status: "approved", answer: "x", resolvedAt: new Date() } });
r = await decide(sub.id, "apply");
o = await byId(sub.id);
check(o.status === "submitted", "J3.submit", "prepared role with no approvals -> Apply submits", { st: o.status, res: r.result });
pg = await c.get("/app/applications");
check(pg.status === 200 && pg.text.includes(sub.id), "J3.apps", "applications shows the submitted role", pg.status);
const move = async (status) => { await c.action("ops.setOpportunityStatus", [form({ id: sub.id, status })], { page: "/app/applications" }); return (await byId(sub.id)).status; };
for (const st of ["pending", "assessment", "recruiter", "hiring_manager", "technical", "final", "offer"]) {
  const got = await move(st);
  check(got === st, `J3.move.${st}`, `kanban move -> ${st}`, got);
}
const ev = await db.event.findFirst({ where: { opportunityId: sub.id, type: "status_change" }, orderBy: { createdAt: "desc" } });
check(ev && /вручную/.test(ev.message), "J3.move.audit", "manual move logged in audit trail", ev?.message);
check((await move("rejected")) === "rejected", "J3.move.rejected", "kanban can move an application to Rejected (column exists on the board)");
check((await move("bogus")) !== "bogus", "J3.move.bogus", "invalid status ignored");
const offersPg = await c.get("/app/offers");
const offerCount = await db.offer.count({ where: { userId: c.user.id } });
console.log("  after manual move to 'offer': offers rows =", offerCount, "offers page has company:", offersPg.text.includes(sub.id) || offersPg.text.includes((await db.job.findUnique({ where: { id: sub.jobId } })).company));

// Application detail + CV PDF
pg = await c.get(`/app/applications/${sub.id}`);
check(pg.status === 200, "J3.appdetail", "application detail renders", pg.status);
check(isNotFound(await other.get(`/app/applications/${sub.id}`)), "J3.appdetail.foreign", "foreign application detail -> 404");
const unsub = await opp({ status: "found" });
if (unsub) { const x = await c.get(`/app/applications/${unsub.id}`); check([404, 307, 308, 200].includes(x.status), "J3.appdetail.notapplied", "application detail for a not-applied role", x.status); console.log("  /app/applications/<found id> ->", x.status, x.location ?? ""); }
const pdfRes = await c.req("GET", `/api/applications/${sub.id}/cv`);
const buf = Buffer.from(await pdfRes.arrayBuffer());
const head = buf.subarray(0, 5).toString(), tail = buf.subarray(-8).toString();
check(pdfRes.status === 200 && pdfRes.headers.get("content-type") === "application/pdf" && head === "%PDF-" && /%%EOF/.test(tail), "J3.pdf", "CV PDF valid bytes", { status: pdfRes.status, head, tail: JSON.stringify(tail), len: buf.length, cd: pdfRes.headers.get("content-disposition") });
check(Number(pdfRes.headers.get("content-length")) === buf.length, "J3.pdf.len", "Content-Length matches body");
// xref sanity: startxref offset points at "xref"
const txt = buf.toString("latin1");
const sx = Number(txt.match(/startxref\s+(\d+)/)?.[1]);
check(txt.slice(sx, sx + 4) === "xref", "J3.pdf.xref", "startxref offset points to xref table", { sx, at: txt.slice(sx, sx + 10) });
const anonPdf = await new Client("anon").req("GET", `/api/applications/${sub.id}/cv`);
check(anonPdf.status === 401, "J3.pdf.401", "signed-out PDF -> 401", anonPdf.status);
const foreignPdf = await other.req("GET", `/api/applications/${sub.id}/cv`);
check(foreignPdf.status === 404, "J3.pdf.404", "foreign PDF -> 404", foreignPdf.status);
const nopkg = await opp({ status: "found" });
if (nopkg) { const x = await c.req("GET", `/api/applications/${nopkg.id}/cv`); check(x.status === 404, "J3.pdf.nopkg", "PDF for role without package -> 404", x.status); }
// Cyrillic CV content survives into the PDF? (package text for a KZ user)
const cyr = /[А-Яа-яЁё]/.test((await db.applicationPackage.findUnique({ where: { opportunityId: sub.id } })).cvText);
console.log("  package cvText contains Cyrillic:", cyr);

// Demo user's real applications: PDF for every applied role
const demo = await db.user.findUnique({ where: { email: "demo@simplify.kz" } });
const dc = await new Client("demo").asUser(demo.id);
const dApps = await db.opportunity.findMany({ where: { campaign: { userId: demo.id }, pkg: { isNot: null } }, select: { id: true }, take: 20 }); // CV downloads are rate-limited (30 / 10 min / user)
let bad = [];
for (const a of dApps) { const x = await dc.req("GET", `/api/applications/${a.id}/cv`); const b = Buffer.from(await x.arrayBuffer()); if (x.status === 429) continue; /* per-user CV download limit */ if (x.status !== 200 || b.subarray(0, 5).toString() !== "%PDF-") bad.push([a.id, x.status]); }
check(!bad.length, "J3.pdf.demo", `all ${dApps.length} demo CV PDFs valid`, bad);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
