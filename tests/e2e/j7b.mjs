import { db, form, check, findings } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";
const { c, inv } = await newPaidUser("j7b", { quiet: true });
await payInvoice(c, inv, "success");
const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
const a = JSON.parse((await db.user.findUnique({ where: { id: c.user.id } })).autonomy || "{}");
console.log("autonomy:", a, "campaign.autoSubmit:", camp.autoSubmit);
const low = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: { in: ["qualified", "found"] }, match: { lt: 85 }, eligibility: { not: "blocked" }, decision: "" }, orderBy: { match: "asc" } });
console.log("role match", low.match, low.status);
// user clicks «Показать версию сейчас» on the detail page just to look at the tailored CV
await c.action("campaign.prepareOpportunity", [form({ id: low.id })], { page: `/app/opportunities/${low.id}` });
const aps = await db.approval.findMany({ where: { opportunityId: low.id, status: "pending" } });
console.log("pending approvals:", aps.map((x) => x.kind));
// then answers the self-identification question in Approvals (it's in the queue)
for (const ap of aps) await c.action("ops.resolveApproval", [form({ id: ap.id, decision: "edit", answer: "I don't wish to answer" })], { page: "/app/approvals" });
const after = await db.opportunity.findUnique({ where: { id: low.id } });
check(after.status !== "submitted", "J7.bypass", `answering approvals of a ${low.match}% role (below 85% threshold, never Apply/Auto; only previewed) must not submit it`, after.status);
await db.$disconnect();
