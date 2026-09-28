import { db, form } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Paid user with `n` submitted demo roles (distinct companies). */
export async function userWithApps(label, n = 4, opts = {}) {
  const { c, inv } = await newPaidUser(label, { quiet: true, ...opts });
  await payInvoice(c, inv, "success");
  const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
  const apps = [];
  const seen = new Set();
  for (const p of await db.opportunity.findMany({ where: { campaignId: camp.id, status: { in: ["prepared", "qualified", "submitted"] }, job: { source: "demo" } }, include: { job: true }, orderBy: { match: "desc" } })) {
    if (apps.length >= n) break;
    if (seen.has(p.job.company)) continue;
    if (p.status !== "submitted") {
      await db.approval.updateMany({ where: { opportunityId: p.id, status: "pending" }, data: { status: "approved", answer: "x", resolvedAt: new Date() } });
      await c.action("opportunities.decideOpportunity", [{}, form({ id: p.id, decision: "apply" })], { page: "/app/opportunities" });
    }
    const s = await db.opportunity.findUnique({ where: { id: p.id }, include: { job: true } });
    if (s.status === "submitted") { apps.push(s); seen.add(s.job.company); }
  }
  return { c, camp, apps };
}
export async function email(c, o, subject, body) {
  return c.action("ops.ingestPastedEmail", [{}, form({ from: `talent@${slug(o.job.company)}.example`, subject, body })], { page: "/app/inbox" });
}
export const INTERVIEW = (o) => [`Interview invitation — ${o.job.title}`, `Hi, we would like to invite you to an interview call with our recruiter at ${o.job.company}. Please pick a time via calendly.com/x`];
export const ASSESS = (o) => [`${o.job.company} online assessment`, `Hi, as a next step please complete this online assessment on TestGorilla within 5 days. ${o.job.company}`];
export const OFFER = (o, base = 72000) => [`Offer letter — ${o.job.title}`, `Hi, we are pleased to extend a job offer for ${o.job.title} at ${o.job.company}. Base salary $${base.toLocaleString("en-US")} per year.`];
