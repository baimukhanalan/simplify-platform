// Misc: exported server functions, admin gating, CV parse, free Career Check.
import { Client, db, form, check, findings, signupNew } from "./lib.mjs";
import { CV } from "./j1.mjs";
const demo = await db.user.findUnique({ where: { email: "aruzhan@simplify.kz" } });
const anon = new Client("anon");
// activeCampaign is exported from a "use server" file -> callable as an endpoint with any userId
import { ACTIONS } from "./lib.mjs";
let r = { text: "" };
if (!ACTIONS["campaign.activeCampaign"]) console.log("  activeCampaign is no longer an exported server action");
else r = await anon.action("campaign.activeCampaign", [demo.id], { page: "/onboarding" });
console.log("  anon activeCampaign(demoId) ->", r.status, r.redirect ?? "", (r.text.match(/^1:.*$/m)?.[0] ?? "").slice(0, 300));
check(!/"userId"/.test(r.text), "J10.activeCampaign.anon", "signed-out caller must not read another user's campaign via the exported activeCampaign server action");
const { c: nu } = await signupNew("j10");
if (ACTIONS["campaign.activeCampaign"]) r = await nu.action("campaign.activeCampaign", [demo.id], { page: "/onboarding" });
check(!/"userId"/.test(r.text), "J10.activeCampaign.user", "signed-in user must not read another user's campaign via activeCampaign(userId)", (r.text.match(/^1:.*$/m)?.[0] ?? "").slice(0, 200));
// admin actions as a normal user
const camp = await db.campaign.findFirst({ where: { userId: demo.id, status: "active" } });
const before = camp.lastRunAt;
r = await nu.action("admin.adminRunTick", [form({ campaignId: camp.id })], { page: "/admin" });
check(+((await db.campaign.findUnique({ where: { id: camp.id } })).lastRunAt ?? 0) === +(before ?? 0), "J10.admin", "non-admin can't run adminRunTick", r.redirect);
check((await nu.get("/admin")).status === 307, "J10.admin.page", "/admin redirects non-admin");
check((await anon.req("GET", "/api/cron/tick")).status === 401, "J10.cron", "cron without secret -> 401");
check((await anon.req("POST", "/api/admin/seed-demo")).status === 404, "J10.seed", "seed-demo disabled");
// CV parse roundtrip: a PDF we generated
const admin = await db.user.findUnique({ where: { email: "admin@simplify.kz" } }); // fresh rate-limit bucket
const dApp = await db.opportunity.findFirst({ where: { campaign: { userId: demo.id }, pkg: { isNot: null } } });
const dc = await new Client("d").asUser(demo.id);
let pdfRes = await dc.req("GET", `/api/applications/${dApp.id}/cv`);
if (pdfRes.status === 429) console.log("  (demo CV download rate-limited — reuse skipped)");
const pdf = Buffer.from(await pdfRes.arrayBuffer());
const fd = new FormData(); fd.append("file", new Blob([pdf], { type: "application/pdf" }), "cv.pdf");
let res = await anon.req("POST", "/api/cv/parse", { body: fd });
let j = await res.json();
check(pdfRes.status !== 200 || (res.status === 200 && j.text?.length > 200), "J10.cvparse.pdf", "PDF upload parsed to text", { status: res.status, len: j.text?.length, err: j.error });
const fd2 = new FormData(); fd2.append("file", new Blob(["hello"], { type: "application/pdf" }), "x.pdf");
res = await anon.req("POST", "/api/cv/parse", { body: fd2 });
check(res.status === 415, "J10.cvparse.fake", "fake PDF -> 415", res.status);
const fd3 = new FormData(); fd3.append("file", new Blob([CV], { type: "text/plain" }), "cv.txt");
res = await anon.req("POST", "/api/cv/parse", { body: fd3 });
check(res.status === 200, "J10.cvparse.txt", "txt upload", res.status);
res = await anon.req("POST", "/api/cv/parse", { body: "nope", headers: { "content-type": "text/plain" } });
check(res.status === 400, "J10.cvparse.bad", "non-multipart -> 400", res.status);
// Free career check (anonymous)
r = await anon.action("onboarding.runCareerCheck", [undefined, form({ cvText: CV, target: "Data Analyst" })], { page: "/check" });
check(r.redirect?.startsWith("/check/"), "J10.check", "career check -> /check/[id]", r.redirect ?? r.result);
if (r.redirect) { const p = await anon.get(r.redirect.split(";")[0]); check(p.status === 200, "J10.check.page", "career check result renders", p.status); const links = [...p.text.matchAll(/href="(\/[^"]*)"/g)].map((m) => m[1]); console.log("  check page links:", [...new Set(links)].join(" ")); }
r = await anon.action("onboarding.runCareerCheck", [undefined, form({ cvText: "short", target: "" })], { page: "/check" });
check(!!r.result?.error, "J10.check.short", "short CV rejected", r.result);
// signup edge cases
r = await anon.action("auth.signup", [undefined, form({ name: "Dup", email: "ARUZHAN@simplify.kz", password: "Passw0rd!23", terms: "on" })], { page: "/login" });
check(/уже есть/.test(r.result?.error ?? ""), "J10.signup.dup", "duplicate email (case-insensitive) rejected", r.result);
r = await anon.action("auth.signup", [undefined, form({ name: "No terms", email: `nt-${Date.now()}@test.local`, password: "Passw0rd!23" })], { page: "/login" });
check(!!r.result?.error, "J10.signup.terms", "signup without terms rejected", r.result);
r = await anon.action("auth.login", [undefined, form({ email: "aruzhan@simplify.kz", password: "simplify2026", next: "//evil.com" })], { page: "/login" });
check(r.redirect?.split(";")[0] === "/app", "J10.login.next", "open redirect blocked", r.redirect);
r = await anon.action("auth.login", [undefined, form({ email: "aruzhan@simplify.kz", password: "wrong", next: "/app" })], { page: "/login" });
check(/Неверный/.test(r.result?.error ?? ""), "J10.login.wrong", "wrong password message", r.result);
// signup with ?plan= carried through
const pc = new Client("plan");
r = await pc.action("auth.signup", [undefined, form({ name: "Plan User", email: `plan-${Date.now()}@test.local`, password: "Passw0rd!23", terms: "on", plan: "international" })], { page: "/login" });
console.log("  signup with plan=international ->", r.redirect);
const lp = await anon.get("/login?mode=signup&plan=international");
console.log("  /login?mode=signup&plan=international has hidden plan input:", /name="plan"/.test(lp.text));
// logout
r = await nu.action("auth.logout", [], { page: "/app" });
check(r.redirect?.startsWith("/login") && !nu.cookies.sfy_session, "J10.logout", "logout clears cookie", r.redirect);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
