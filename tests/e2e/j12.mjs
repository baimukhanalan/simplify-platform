import { Client, db, form, check, findings } from "./lib.mjs";
import { userWithApps, email, OFFER } from "./setup.mjs";
import { payInvoice } from "./j1.mjs";
import { needsMode } from "./lib.mjs";

// Rounds and offers are set up by pasting employer mail (setup.mjs → email()); simulation disables pasting — employers of
// the fictional corpus write on their own there (covered by j18).
needsMode("live", "rounds / offers are set up by pasting employer mail — pasting is disabled in simulation");
const { c, apps } = await userWithApps("j12", 1);
await email(c, apps[0], ...OFFER(apps[0]));
const offer = await db.offer.findFirst({ where: { userId: c.user.id } });
await c.action("campaign.markHired", [form({ offerId: offer.id })], { page: "/app/offers" });
const anon = new Client("anon");
let r = await c.action("share.createShareLink", [], { page: "/app/hired" });
const p1 = r.result.path;
check((await anon.get(p1)).status === 200, "J12.share", "share works", p1);
r = await c.action("share.rotateShareLink", [], { page: "/app/hired" });
const p2 = r.result?.path;
check(p2 && p2 !== p1 && (await anon.get(p2)).status === 200, "J12.rotate.new", "rotate -> new link works", r.result);
const old = await anon.get(p1);
check(old.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404/.test(old.text), "J12.rotate.old", "rotate -> old link dead", old.status);
r = await c.action("share.revokeShareLink", [], { page: "/app/hired" });
const rv = await anon.get(p2);
check(rv.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404/.test(rv.text), "J12.revoke", "revoke -> link dead", rv.status);
// next campaign, then /app/hired copy
const co = await c.action("campaign.checkout", [form({ plan: "local" })], { page: "/app/campaign" });
await payInvoice(c, co.redirect.split(";")[0].split("/").pop(), "success");
const h = await c.get("/app/hired");
const v = h.text.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
check(!/Passive Mode включён: заявки не подаются/.test(v), "J12.hired.copy", "/app/hired doesn't claim Passive Mode while a new campaign is running", v.match(/Passive Mode.{0,120}/)?.[0]);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
