import { Client, db, form, check, findings } from "./lib.mjs";
import { userWithApps, email, OFFER } from "./setup.mjs";
import { crawl } from "./crawl.mjs";
import { needsMode } from "./lib.mjs";

// Rounds and offers are set up by pasting employer mail (setup.mjs → email()); simulation disables pasting — employers of
// the fictional corpus write on their own there (covered by j18).
needsMode("live", "rounds / offers are set up by pasting employer mail — pasting is disabled in simulation");
// (a) after HIRED: leftovers
{
  const { c, apps, camp } = await userWithApps("j11h", 2);
  await email(c, apps[0], ...OFFER(apps[0]));
  const offer = await db.offer.findFirst({ where: { userId: c.user.id } });
  const pendBefore = await db.approval.count({ where: { userId: c.user.id, status: "pending" } });
  await c.action("campaign.markHired", [form({ offerId: offer.id })], { page: "/app/offers" });
  const pend = await db.approval.count({ where: { userId: c.user.id, status: "pending" } });
  const unread = await db.notification.count({ where: { userId: c.user.id, readAt: null } });
  const today = await c.get("/app");
  const v = today.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  console.log("  after HIRED: pending approvals", pendBefore, "->", pend, "; unread notifications", unread);
  console.log("  Today after HIRED:", v.slice(v.indexOf("Приватность") + 11, v.indexOf("Приватность") + 700));
  check(pend === 0, "J11.hired.approvals", "pending approvals of a finished (HIRED) campaign are closed", pend);
  check(!/YOU GOT THE OFFER/.test(v), "J11.hired.push", "the 'YOU GOT THE OFFER' push moment is gone once the offer is accepted");
  const other = await db.opportunity.findUnique({ where: { id: apps[1].id } });
  console.log("  other in-flight application after HIRED:", other.status);
}
// (c) expired campaign
{
  const { c, camp } = await userWithApps("j11e", 1);
  await db.campaign.update({ where: { id: camp.id }, data: { endsAt: new Date(Date.now() - 1000) } });
  await c.action("campaign.runAgentNow", [], { page: "/app" });
  const cp = await c.get("/app/campaign");
  const cpv = cp.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ");
  check(/Оплатить через Kaspi Pay/.test(cpv) && !/Кампания в работе/.test(cpv), "J11.expired", "campaign past endsAt: /app/campaign offers a new campaign instead of «Кампания в работе» with Pause/Run", (await db.campaign.findUnique({ where: { id: camp.id } })).status);
  const res = await crawl(c, "expired-campaign user", { max: 200 });
  check(!res.problems.length, "J11.expired.crawl", "no broken pages for an expired campaign", res.problems.map((p) => `${p.kind} ${p.path}`));
  const r = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
  check(r.status === 201, "J11.expired.renew", "new invoice allowed after expiry", r.status);
  const ag = await c.get("/app/agent");
  const v = ag.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  console.log("  /app/agent header for expired:", v.slice(0, 160));
}
console.log(`\n${findings.length} failures`);
await db.$disconnect();
