// Journey 8: Profile / Goal / Readiness edits persist; Settings consents, export, delete account.
import { Client, db, form, check, findings, signupNew } from "./lib.mjs";
import { newPaidUser, payInvoice, CV } from "./j1.mjs";

const { c, inv } = await newPaidUser("j8", { quiet: true });
await payInvoice(c, inv, "success");
const uid = c.user.id;
const prof = () => db.profile.findUnique({ where: { userId: uid } });
const goal = () => db.goal.findUnique({ where: { userId: uid } });

for (const p of ["/app/profile", "/app/goal", "/app/goal?edit=1", "/app/readiness", "/app/settings"]) { const r = await c.get(p); check(r.status === 200, "J8.page", `${p} renders`, r.status); }

// Profile basics
let r = await c.action("profile.updateBasics", [undefined, form({ name: "Айгерим Нурланова", headline: "Senior Data Analyst", yearsExperience: "5,5", englishLevel: "c1", city: "Astana", country: "kz", phone: "+77010000000", linkedin: "linkedin.com/in/x", github: "", portfolio: "", summary: "Hi" })], { page: "/app/profile" });
let p = await prof();
let u = await db.user.findUnique({ where: { id: uid } });
check(r.result?.ok && u.name === "Айгерим Нурланова" && p.yearsExperience === 5.5 && p.englishLevel === "C1" && p.city === "Astana" && p.linkedin === "https://linkedin.com/in/x", "J8.basics", "basics persisted", { y: p.yearsExperience, en: p.englishLevel, li: p.linkedin });
r = await c.action("profile.updateBasics", [undefined, form({ name: "A" })], { page: "/app/profile" });
check(r.result?.ok === false, "J8.basics.invalid", "short name rejected", r.result);
// Skills
await c.action("profile.addSkill", [form({ skill: "dbt, Looker, sql" })], { page: "/app/profile" });
p = await prof();
const sk = JSON.parse(p.skills);
check(sk.includes("dbt") && sk.includes("Looker") && sk.filter((s) => s.toLowerCase() === "sql").length === 1, "J8.skill.add", "skills added, deduped case-insensitively", sk);
await c.action("profile.removeSkill", [form({ skill: "dbt" })], { page: "/app/profile" });
check(!JSON.parse((await prof()).skills).includes("dbt"), "J8.skill.remove", "skill removed");
// Facts
r = await c.action("profile.saveFact", [undefined, form({ kind: "project", title: "Churn model", org: "Side", details: "XGBoost", metrics: "AUC 0.81", tech: "Python, XGBoost", teamSize: "3", ownership: "led" })], { page: "/app/profile" });
const fact = await db.fact.findFirst({ where: { userId: uid, title: "Churn model" } });
check(r.result?.ok && fact?.teamSize === 3 && fact.ownership === "led", "J8.fact.add", "fact added", r.result);
r = await c.action("profile.saveFact", [undefined, form({ id: fact.id, kind: "project", title: "Churn model v2", org: "Side", ownership: "bogus" })], { page: "/app/profile" });
check((await db.fact.findUnique({ where: { id: fact.id } })).title === "Churn model v2", "J8.fact.edit", "fact edited");
const { c: other } = await signupNew("j8other");
r = await other.action("profile.saveFact", [undefined, form({ id: fact.id, title: "pwned" })], { page: "/app/profile" });
check((await db.fact.findUnique({ where: { id: fact.id } })).title === "Churn model v2", "J8.fact.foreign", "foreign fact edit rejected", r.result);
// Stories
r = await c.action("profile.saveStory", [undefined, form({ title: "Conflict", situation: "S", task: "T", action: "A", result: "R", metric: "+5%", tags: ["conflict", "evil"], factId: fact.id })], { page: "/app/profile" });
const story = await db.story.findFirst({ where: { userId: uid } });
check(r.result?.ok && JSON.parse(story.tags).join() === "conflict" && story.factId === fact.id, "J8.story", "story saved, bad tag dropped", story?.tags);
await c.action("profile.deleteStory", [form({ id: story.id })], { page: "/app/profile" });
check(!(await db.story.findUnique({ where: { id: story.id } })), "J8.story.del", "story deleted");
await c.action("profile.deleteFact", [form({ id: fact.id })], { page: "/app/profile" });
check(!(await db.fact.findUnique({ where: { id: fact.id } })), "J8.fact.del", "fact deleted");
// Re-parse CV (append-only)
const factsBefore = await db.fact.count({ where: { userId: uid } });
r = await c.action("profile.reparseCV", [undefined, form({ cvText: CV + "\nProduct Analyst — Kolesa Group, Almaty — 01/2020 – 05/2021\n- Funnels and retention in Amplitude\n" })], { page: "/app/profile" });
check(r.result?.ok && (await db.fact.count({ where: { userId: uid } })) > factsBefore, "J8.reparse", "re-parse adds only new facts", r.result?.message);
r = await c.action("profile.reparseCV", [undefined, form({ cvText: "short" })], { page: "/app/profile" });
check(r.result?.ok === false, "J8.reparse.short", "short CV rejected");

// Goal page (profile.saveGoal) with KZT + redirect
r = await c.action("profile.saveGoal", [undefined, form({ after: "goal", primaryRole: "Product Analyst", extraRoles: ["Data Analyst"], seniority: "middle", minSalary: "900000", currency: "KZT", countries: ["KZ", "CIS"], workModes: ["remote", "hybrid"], industries: ["Fintech"], companySize: "any", mode: "autonomous", dreamCompanies: "Kaspi, Halyk", blockedCompanies: "Evil Corp" })], { page: "/app/goal" });
let g = await goal();
check(r.redirect?.startsWith("/app/goal?saved=1") && g.primaryRole === "Product Analyst" && g.currency === "KZT" && g.minSalary === 900000, "J8.goal", "goal saved (KZT) + redirect", { red: r.redirect, cur: g.currency, min: g.minSalary });
r = await c.action("profile.saveGoal", [undefined, form({ primaryRole: "PM", seniority: "middle", countries: ["KZ"], workModes: ["remote"], mode: "target", dreamCompanies: "" })], { page: "/app/goal" });
check(r.result?.ok === false, "J8.goal.target", "Target mode without dream companies rejected", r.result);
let pg = await c.get("/app/goal?saved=1");
check(pg.status === 200 && pg.text.includes("Product Analyst"), "J8.goal.render", "goal page shows saved goal");
// Profile «Ограничения» saved with the form's own default values must not change the goal's currency
p = await prof();
// Submit exactly what the rendered «Ограничения» form pre-fills (read from the page, like a browser would).
const profHtml = (await c.get("/app/profile")).text;
const shownMin = profHtml.match(/name="minSalary"[^>]*value="([^"]*)"/)?.[1] ?? profHtml.match(/value="([^"]*)"[^>]*name="minSalary"/)?.[1] ?? "";
const defaults = { citizenship: p.citizenship, remotePref: p.remotePref, minSalary: shownMin, noticePeriod: p.noticePeriod, workAuth: JSON.parse(p.workAuth), relocation: g.relocation ? "on" : undefined };
if (!defaults.relocation) delete defaults.relocation;
r = await c.action("profile.updateConstraints", [undefined, form(defaults)], { page: "/app/profile" });
const g2 = await goal();
const usdEquivalent = Math.abs(g2.minSalary - Number(shownMin)) <= 1 && g2.currency === "USD";
check((g2.currency === g.currency && g2.minSalary === g.minSalary) || (usdEquivalent && Number(shownMin) < g.minSalary), "J8.constraints.currency", "saving Profile → Ограничения unchanged keeps the goal minimum (same value, or its USD equivalent)", { before: `${g.minSalary} ${g.currency}`, formShows: shownMin, after: `${g2.minSalary} ${g2.currency}` });
// consequence on the agent
await c.action("campaign.runAgentNow", [], { page: "/app" });
const floor = (await db.opportunity.findMany({ where: { campaign: { userId: uid } }, select: { blockers: true } })).filter((o) => o.blockers.includes("Зарплата ниже")).length;
console.log("  roles blocked by the salary floor after that save:", floor);
// Sponsorship toggles
r = await c.action("profile.updateConstraints", [undefined, form({ citizenship: "KZ", workAuth: ["EU"], needsSponsorship: "on", minSalary: "50000", remotePref: "remote", noticePeriod: "1 month" })], { page: "/app/profile" });
p = await prof(); g = await goal();
// Round 8: the «Ограничения» field is in USD but the goal keeps its own currency (a ₸ goal stays in ₸, converted back).
const floorUsd = g.currency === "KZT" ? Math.round(g.minSalary / 500) : g.minSalary;
check(JSON.parse(p.workAuth).includes("DE") && p.needsSponsorship && g.sponsorshipNeeded && g.currency === "KZT" && floorUsd === 50000, "J8.constraints", "constraints persisted & synced to goal (the KZT goal stays KZT: $50 000 → 25 000 000 ₸)", { auth: p.workAuth.slice(0, 40), sp: p.needsSponsorship, goal: `${g.minSalary} ${g.currency}` });

// Readiness fixes
pg = await c.get("/app/readiness");
check(pg.status === 200, "J8.readiness", "readiness renders", pg.status);
await c.action("profile.saveGoal", [undefined, form({ primaryRole: "Data Analyst", seniority: "lead", minSalary: "300000", currency: "USD", countries: ["EU"], workModes: ["remote"], mode: "autonomous" })], { page: "/app/goal" });
await c.action("profile.applyReadinessFix", [form({ fix: "seniority" })], { page: "/app/readiness" });
g = await goal();
check(g.seniority !== "lead", "J8.fix.seniority", "seniority fix applied", g.seniority);
await c.action("profile.applyReadinessFix", [form({ fix: "salary" })], { page: "/app/readiness" });
g = await goal();
check(g.minSalary < 300000, "J8.fix.salary", "salary fix lowered to market median", g.minSalary);
await c.action("profile.applyReadinessFix", [form({ fix: "role", role: "Product Analyst" })], { page: "/app/readiness" });
check(JSON.parse((await goal()).extraRoles).includes("Product Analyst"), "J8.fix.role", "adjacent role added");
await c.action("profile.applyReadinessFix", [form({ fix: "role", role: "<script>" })], { page: "/app/readiness" });
check(!JSON.parse((await goal()).extraRoles).includes("<script>"), "J8.fix.role.invalid", "invalid role ignored");

// Settings: consents
r = await c.action("account.updateConsents", [undefined, form({ emailScan: "on", copilot: "on" })], { page: "/app/settings" });
u = await db.user.findUnique({ where: { id: uid } });
const cons = JSON.parse(u.consents);
const camp = await db.campaign.findFirst({ where: { userId: uid } });
check(r.result?.ok && cons.autoSubmit === false && cons.emailScan === true && camp.autoSubmit === false, "J8.consents", "consents persisted; autoSubmit off switches campaign to manual", { cons, campAuto: camp.autoSubmit });
pg = await c.get("/app/settings");
check(pg.status === 200, "J8.settings.render", "settings renders", pg.status);
for (const q of ["?page=0", "?page=abc", "?page=99999"]) { const x = await c.get("/app/settings" + q); check(x.status === 200, "J8.settings.page", `settings${q}`, x.status); }
r = await c.action("account.updateConsents", [undefined, form({ autoSubmit: "on", emailScan: "on", copilot: "on" })], { page: "/app/settings" });
const camp2 = await db.campaign.findFirst({ where: { userId: uid } });
console.log("  re-granting autoSubmit consent -> campaign.autoSubmit =", camp2.autoSubmit, "(stays manual until Agent screen is saved)");

// Export
const ex = await c.req("GET", "/api/export");
const exj = JSON.parse(await ex.text());
check(ex.status === 200 && exj.user?.email === c.email && !JSON.stringify(exj).includes("passwordHash"), "J8.export", "export JSON, no password hash", ex.status);
check((await new Client("anon").req("GET", "/api/export")).status === 401, "J8.export.401", "export signed-out -> 401");

// Delete account
r = await c.action("account.deleteAccount", [undefined, form({ confirmEmail: "wrong@x.y" })], { page: "/app/settings" });
check(r.result?.ok === false && (await db.user.findUnique({ where: { id: uid } })), "J8.delete.wrong", "wrong email -> not deleted", r.result);
const payIds = (await db.payment.findMany({ where: { userId: uid }, select: { id: true } })).map((p) => p.id);
r = await c.action("account.deleteAccount", [undefined, form({ confirmEmail: c.email.toUpperCase() })], { page: "/app/settings" });
check(r.redirect?.startsWith("/") && !(await db.user.findUnique({ where: { id: uid } })), "J8.delete", "account deleted + redirect", r.redirect);
check((await db.campaign.count({ where: { userId: uid } })) === 0, "J8.delete.cascade", "campaigns cascade-deleted with the account");
// Payments are accounting records: kept, detached from the deleted user (userId -> null, campaignId -> null).
const kept = await db.payment.findMany({ where: { id: { in: payIds } }, select: { userId: true, campaignId: true, status: true } });
check(payIds.length > 0 && kept.length === payIds.length && kept.every((p) => p.userId === null && p.campaignId === null), "J8.delete.payments.kept", "payment rows survive account deletion with userId = null", { before: payIds.length, kept });
const after = await c.get("/app");
check(after.status === 307 && /\/login/.test(after.location ?? ""), "J8.delete.session", "session cleared -> /login", `${after.status} ${after.location}`);
// stale JWT of a deleted user
const ghost = await new Client("ghost").asUser(uid);
const gp = await ghost.get("/app");
check(gp.status === 307, "J8.ghost", "deleted user's still-valid JWT is treated as signed out", gp.status);
const gi = await ghost.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
check(gi.status === 401 || gi.status === 409, "J8.ghost.invoice", "deleted user's JWT can't create invoices (no 500)", gi);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
