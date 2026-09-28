// Journey 6: Offers -> HIRED -> share -> Career Mode -> next campaign.
import { Client, db, form, check, findings, signupNew, isNotFound } from "./lib.mjs";
import { userWithApps, email, OFFER } from "./setup.mjs";
import { payInvoice } from "./j1.mjs";
import { crawl } from "./crawl.mjs";

const { c, apps, camp } = await userWithApps("j6", 3);
await email(c, apps[0], ...OFFER(apps[0], 70000));
await email(c, apps[1], ...OFFER(apps[1], 65000));
const offers = await db.offer.findMany({ where: { userId: c.user.id }, orderBy: { createdAt: "asc" } });
check(offers.length === 2, "J6.setup", "two offers from inbox", offers.length);
const [o1, o2] = offers;
const { c: other } = await signupNew("j6other");
let pg = await c.get("/app/offers");
check(pg.status === 200, "J6.page", "offers page renders", pg.status);

// edit terms
const terms = { offerId: o1.id, base: "75,000", currency: "EUR", bonus: "5000", equity: "0.1%", signingBonus: "2000", benefits: "Health, Gym\nLearning", vacationDays: "28", probationMonths: "3", remote: "hybrid", relocation: "Paid", noticePeriod: "1 month" };
let r = await c.action("offer.updateOffer", [undefined, form(terms)], { page: "/app/offers" });
let o = await db.offer.findUnique({ where: { id: o1.id } });
check(r.result?.ok && o.base === 75000 && o.currency === "EUR" && JSON.parse(o.benefits).length === 3 && o.remote === "hybrid", "J6.update", "edit terms persisted", { base: o.base, cur: o.currency, ben: o.benefits });
r = await c.action("offer.updateOffer", [undefined, form({ ...terms, base: "75" })], { page: "/app/offers" });
check(!!r.result?.error, "J6.update.monthly", "monthly-looking base rejected", r.result);
r = await other.action("offer.updateOffer", [undefined, form({ ...terms, base: "1000000" })], { page: "/app/offers" });
check(!!r.result?.error && (await db.offer.findUnique({ where: { id: o1.id } })).base === 75000, "J6.update.foreign", "foreign update rejected", r.result);
pg = await c.get("/app/offers");
check(pg.status === 200, "J6.page.eur", "offers page renders with EUR offer", pg.status);

// negotiation levels + plan
for (const level of ["soft", "balanced", "assertive", "nuclear"]) {
  await c.action("offer.saveNegotiation", [form({ offerId: o1.id, level, target: "82000", ask: "85000", walkaway: "72000", notes: "remote 2 days" })], { page: "/app/offers" });
  const n = JSON.parse((await db.offer.findUnique({ where: { id: o1.id } })).negotiation);
  check(n.level === (level === "nuclear" ? "balanced" : level) && n.ask === 85000, `J6.nego.${level}`, `negotiation level ${level} saved`, n.level);
}
o = await db.offer.findUnique({ where: { id: o1.id } });
check(o.status === "negotiating", "J6.nego.status", "offer -> negotiating", o.status);
pg = await c.get("/app/offers");
check(pg.status === 200 && pg.text.includes("85"), "J6.nego.render", "offer desk renders saved plan", pg.status);

// record final base
await c.action("offer.recordFinal", [form({ offerId: o1.id, finalBase: "500" })], { page: "/app/offers" });
check((await db.offer.findUnique({ where: { id: o1.id } })).finalBase == null, "J6.final.small", "final base < 1000 ignored");
await c.action("offer.recordFinal", [form({ offerId: o1.id, finalBase: "80000" })], { page: "/app/offers" });
o = await db.offer.findUnique({ where: { id: o1.id } });
check(o.finalBase === 80000 && JSON.parse(o.negotiation).result?.delta === 5000, "J6.final", "final base recorded with delta", { fb: o.finalBase, n: JSON.parse(o.negotiation).result });

// decline the second offer
await c.action("offer.declineOffer", [form({ offerId: o2.id })], { page: "/app/offers" });
check((await db.offer.findUnique({ where: { id: o2.id } })).status === "declined", "J6.decline", "decline offer");
// manual add offer
r = await c.action("offer.addOffer", [undefined, form({ company: "ManualCo", role: "Analyst", base: "60000", currency: "USD" })], { page: "/app/offers" });
check(r.result?.ok, "J6.add", "manual offer added", r.result);
r = await c.action("offer.addOffer", [undefined, form({ company: "", role: "Analyst", base: "60000" })], { page: "/app/offers" });
check(!!r.result?.error, "J6.add.invalid", "manual offer without company rejected", r.result);

// foreign accept must not HIRE the attacker's own campaign silently? (markHired with foreign offerId)
const { c: bystander, apps: bApps } = await userWithApps("j6by", 1);
r = await bystander.action("campaign.markHired", [form({ offerId: o1.id })], { page: "/app/offers" });
const byCamp = await db.campaign.findFirst({ where: { userId: bystander.user.id }, orderBy: { createdAt: "desc" } });
check((await db.offer.findUnique({ where: { id: o1.id } })).status !== "accepted", "J6.accept.foreign", "foreign user can't accept someone else's offer");
check(byCamp.status === "active", "J6.accept.foreign.self", "markHired with an offer id that is not yours should not mark your own campaign HIRED", byCamp.status);

// accept -> HIRED
r = await c.action("campaign.markHired", [form({ offerId: o1.id })], { page: "/app/offers" });
check(r.redirect?.startsWith("/app/career?hired=1"), "J6.accept", "accept redirects to career?hired=1", r.redirect);
const hiredCamp = await db.campaign.findUnique({ where: { id: camp.id } });
const u = await db.user.findUnique({ where: { id: c.user.id }, include: { profile: true } });
check(hiredCamp.status === "hired" && hiredCamp.hiredAt, "J6.hired", "campaign HIRED", hiredCamp.status);
check((await db.offer.findUnique({ where: { id: o1.id } })).status === "accepted", "J6.accepted", "offer accepted");
check((await db.opportunity.findUnique({ where: { id: apps[0].id } })).status === "hired", "J6.opp.hired", "opportunity hired");
check(u.careerMode === "passive", "J6.passive", "career mode passive");
console.log("  profile.salaryExpectation after accepting EUR 80k:", u.profile.salaryExpectation);
let cr = await c.get("/app/career?hired=1");
check((cr.status === 307 && cr.location === "/app/hired") || /NEXT_REDIRECT;[a-z]+;\/app\/hired/.test(cr.text), "J6.career.redirect", "career?hired=1 -> /app/hired", `${cr.status} ${cr.location}`);
pg = await c.get("/app/hired");
check(pg.status === 200, "J6.hiredpage", "/app/hired renders", pg.status);
pg = await c.get("/app/offers");
check(pg.status === 200, "J6.offers.after", "offers page after HIRED", pg.status);
// second accept attempt / accept declined offer
r = await c.action("campaign.markHired", [form({ offerId: o2.id })], { page: "/app/offers" });
check((await db.offer.findUnique({ where: { id: o2.id } })).status === "declined", "J6.accept.declined", "a declined offer can't be accepted afterwards", (await db.offer.findUnique({ where: { id: o2.id } })).status);

// share link
r = await c.action("share.createShareLink", [], { page: "/app/hired" });
const sharePath = r.result?.path;
check(r.result?.ok && /^\/share\//.test(r.result.path), "J6.share", "share link created", r.result);
const r2 = await c.action("share.createShareLink", [], { page: "/app/hired" });
check(r2.result?.path === r.result?.path, "J6.share.idem", "share link reused");
const anon = new Client("anon");
const sh = await anon.get(r.result.path);
const text = sh.text;
const visible = text.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");
const first = u.name.split(" ")[0], last = u.name.split(" ").slice(1).join(" ");
check(sh.status === 200 && visible.includes(first), "J6.share.public", "public share page renders first name", sh.status);
check(!text.includes(u.email), "J6.share.noemail", "no email in share page");
check(!last || !text.includes(u.name), "J6.share.nolast", "no full name in share page", u.name);
check(!/80[, ]?000|75[, ]?000|€/.test(visible), "J6.share.nosalary", "no salary in share page");
const og = await anon.req("GET", r.result.path + "/opengraph-image");
check(og.status === 200 && /image\//.test(og.headers.get("content-type")), "J6.share.og", "OG image renders", `${og.status} ${og.headers.get("content-type")}`);
check(isNotFound(await anon.get("/share/not-a-real-token-123456")), "J6.share.404", "unknown token -> 404");
const nobody = await other.action("share.createShareLink", [], { page: "/app/hired" });
check(nobody.result?.ok === false, "J6.share.nothired", "non-hired user can't create share", nobody.result);

// Career mode + snapshot
pg = await c.get("/app/career");
check(pg.status === 200 && /Start Next Campaign/.test(pg.text), "J6.career", "career page with Start Next Campaign", pg.status);
await c.action("account.setCareerMode", [form({ mode: "active" })], { page: "/app/career" });
check((await db.user.findUnique({ where: { id: c.user.id } })).careerMode === "active", "J6.mode.active", "career mode -> active");
await c.action("account.setCareerMode", [form({ mode: "passive" })], { page: "/app/career" });
check((await db.user.findUnique({ where: { id: c.user.id } })).careerMode === "passive", "J6.mode.passive", "career mode -> passive");
r = await c.action("account.recordSnapshot", [], { page: "/app/career" });
check((await db.careerSnapshot.count({ where: { userId: c.user.id } })) >= 1 && !r.error, "J6.snapshot", "career snapshot recorded", r.error?.slice(0, 200));

// crawl as hired user
const hiredCrawl = await crawl(c, "hired user", { max: 250 });
check(!hiredCrawl.problems.length, "J6.crawl", "no broken pages for a HIRED user", hiredCrawl.problems.map((p) => `${p.kind} ${p.path}`));

// next campaign
pg = await c.get("/app/campaign");
check(pg.status === 200 && /Start New Campaign|Запустите/.test(pg.text), "J6.campaign.new", "campaign page offers a new campaign", pg.status);
r = await c.action("campaign.checkout", [form({ plan: "local", partner: "" })], { page: "/app/campaign" });
check(r.redirect?.startsWith("/pay/kaspi/"), "J6.next.invoice", "checkout after HIRED creates a new invoice", r.redirect);
const inv = r.redirect.split(";")[0].split("/").pop();
const p = await payInvoice(c, inv, "success");
const camps = await db.campaign.findMany({ where: { userId: c.user.id }, orderBy: { createdAt: "asc" } });
check(p.data.status === "paid" && camps.length === 2 && camps[1].status === "active" && camps[0].status === "hired", "J6.next.active", "second campaign active, first stays hired", camps.map((x) => x.status));
check((await db.user.findUnique({ where: { id: c.user.id } })).careerMode === "active", "J6.next.mode", "career mode back to active");
const newOpps = await db.opportunity.count({ where: { campaignId: camps[1].id } });
console.log("  opportunities in new campaign:", newOpps);
check(newOpps > 0, "J6.next.discover", "new campaign discovers vacancies (not blocked by old campaign's jobs)");
check((await anon.get(sharePath)).status === 200, "J6.share.persist", "share link still valid after next campaign");
pg = await c.get("/app/hired");
console.log("  /app/hired after next campaign ->", pg.status, pg.location ?? "");
for (const path of ["/app", "/app/offers", "/app/applications", "/app/career", "/app/interviews"]) { const x = await c.get(path); check(x.status === 200, "J6.next.page", `${path} after 2nd campaign`, x.status); }
console.log(`USER ${c.user.id} ${c.email}`);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
