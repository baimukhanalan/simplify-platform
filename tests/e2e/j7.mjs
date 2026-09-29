// Journey 7: Agent screen toggles persist AND change engine behaviour on the next runAgentNow.
import { Client, db, form, check, findings } from "./lib.mjs";
import { newPaidUser, payInvoice } from "./j1.mjs";

const DEFAULTS = { findJobs: "on", personalizeCv: "on", submitApplications: "on", answerStandard: "on", sensitive: "ask", autoApplyMinMatch: "85" };
// Exactly what the browser form sends (see autonomy-form.tsx): checked switches as "on", sensitive radio, range slider. No autoApplyOn field exists in the form.
const save = (c, over = {}) => {
  const f = { ...DEFAULTS, ...over };
  for (const k of Object.keys(f)) if (f[k] === undefined) delete f[k];
  return c.action("agent.saveAutonomy", [{}, form(f)], { page: "/app/agent" });
};
async function fresh(label, opts) {
  const { c, inv } = await newPaidUser(label, { quiet: true, ...opts });
  await payInvoice(c, inv, "success");
  const camp = await db.campaign.findFirst({ where: { userId: c.user.id } });
  return { c, camp };
}
// Reset the daily budget so the next run can prepare again (simulates "tomorrow").
async function newDay(campId) {
  await db.$executeRawUnsafe(`UPDATE "Opportunity" SET "updatedAt" = ?, "submittedAt" = CASE WHEN "submittedAt" IS NULL THEN NULL ELSE ? END WHERE "campaignId" = ?`, new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000), campId);
}
const counts = async (campId) => Object.fromEntries((await db.opportunity.groupBy({ by: ["status"], where: { campaignId: campId }, _count: true })).map((g) => [g.status, g._count]));
const run = (c) => c.action("campaign.runAgentNow", [], { page: "/app/agent" });
const lastTick = async (userId) => (await db.event.findFirst({ where: { userId, type: "tick" }, orderBy: { createdAt: "desc" } }))?.message;

// ——— 0. Persistence round-trip + the threshold
{
  const { c, camp } = await fresh("j7persist");
  let r = await save(c, { autoApplyMinMatch: "95" });
  let a = JSON.parse((await db.user.findUnique({ where: { id: c.user.id } })).autonomy);
  check(r.result?.ok, "J7.save", "saveAutonomy ok", r.result);
  check(a.autoApplyMinMatch === 95, "J7.threshold.persist", "Agent screen: slider at 95% + auto-apply ON persists threshold 95", a);
  const pg = await c.get("/app/agent");
  const shown = pg.text.match(/Автоподача на все вакансии с Match от (?:<!-- -->)?([^%<]+)(?:<!-- -->)?%/)?.[1]; // Russian label since round 6
  check(shown === "95", "J7.threshold.render", "Agent screen re-renders the saved threshold", shown);
  const op = await c.get("/app/opportunities");
  const shownOpp = op.text.match(/Автоподача на все вакансии с Match от <span class="num">(?:<!-- -->)?([^%<]+)/)?.[1];
  console.log("  Opportunities toggle label shows:", shownOpp);
  // behaviour: with threshold lost, the agent submits below 95
  await db.approval.deleteMany({ where: { userId: c.user.id } });
  await save(c, { autoApplyMinMatch: "95", sensitive: "decline" });
  await newDay(camp.id);
  const before = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted" } });
  await run(c);
  const sub = await db.opportunity.findMany({ where: { campaignId: camp.id, status: "submitted" }, select: { match: true, decision: true } });
  const below = sub.filter((s) => s.match < 95 && !s.decision);
  check(below.length === 0, "J7.threshold.engine", "with threshold 95 the agent must not submit roles with Match < 95", { submitted: sub.length - before, belowThreshold: below.map((s) => s.match) });
  // Every switch round-trips
  for (const key of ["findJobs", "personalizeCv", "submitApplications", "answerStandard", "changeSalary", "outsideCountries", "belowSalaryFloor"]) {
    const on = !["changeSalary", "outsideCountries", "belowSalaryFloor"].includes(key);
    await save(c, { [key]: on ? undefined : "on" });
    a = JSON.parse((await db.user.findUnique({ where: { id: c.user.id } })).autonomy);
    check(a[key] === !on, `J7.persist.${key}`, `${key} flip persists`, a[key]);
  }
  r = await save(c, { sensitive: "maybe" });
  check(!!r.result?.error, "J7.sensitive.invalid", "invalid sensitive value rejected", r.result);
  r = await save(c, { sensitive: "decline" });
  a = JSON.parse((await db.user.findUnique({ where: { id: c.user.id } })).autonomy);
  check(a.sensitive === "decline", "J7.sensitive.persist", "sensitive=decline persists");
}

// ——— 1. submitApplications OFF -> nothing submitted; Auto-marked roles?
{
  const { c, camp } = await fresh("j7submit");
  await save(c, { submitApplications: undefined, sensitive: "decline" });
  const autoRole = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: "qualified" }, orderBy: { match: "desc" } });
  await c.action("opportunities.decideOpportunity", [{}, form({ id: autoRole.id, decision: "auto" })], { page: "/app/opportunities" });
  // answer anything the role would ask (sponsorship etc.) so only the Submit switch decides
  // (prepareOpportunity is a preview now and routes no questions — a cycle prepares the Auto role for real;
  //  the payment tick already spent today's budget, so start a new day first or the role stays "qualified")
  await newDay(camp.id);
  await run(c);
  check((await db.opportunity.findUnique({ where: { id: autoRole.id } })).status !== "qualified", "J7.submit.off.prepared", "Auto role is prepared by the next cycle", autoRole.status);
  // Round 10: standing questions are one card per user (it may sit on another role) — answer every open card.
  for (const ap of await db.approval.findMany({ where: { userId: c.user.id, status: "pending", kind: { not: "handoff" } } })) await c.action("ops.resolveApproval", [form({ id: ap.id, decision: "edit", answer: "Yes" })], { page: "/app/approvals" });
  await newDay(camp.id);
  const before = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted" } });
  await run(c);
  const after = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted" } });
  const auto = await db.opportunity.findUnique({ where: { id: autoRole.id } });
  console.log("  tick:", await lastTick(c.user.id));
  const own = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted", decision: "" } });
  check(own === 0, "J7.submit.off", "Submit OFF -> agent submits no role you did not mark Apply/Auto", { newSubmitted: after - before, withoutDecision: own });
  check(auto.status === "submitted", "J7.submit.off.auto", "Submit OFF: hint says the agent still submits roles you marked Auto", auto.status);
  // Turning auto-apply back ON from the Opportunities switch must re-enable submission
  await c.action("opportunities.setAutoApply", [true], { page: "/app/opportunities" });
  const cm2 = await db.campaign.findUnique({ where: { id: camp.id } });
  await newDay(camp.id);
  const b2 = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted" } });
  await run(c);
  const a2 = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted" } });
  check(a2 > b2, "J7.submit.reenable.opps", "Opportunities «Auto-apply» ON after Agent-screen OFF resumes submission", { campaignAutoSubmit: cm2.autoSubmit, submitted: a2 - b2, tick: await lastTick(c.user.id) });
}

// ——— 2. answerStandard OFF -> approvals created for standard questions
{
  const { c, camp } = await fresh("j7std");
  await save(c, { answerStandard: undefined, sensitive: "decline" });
  await newDay(camp.id);
  const before = await db.approval.count({ where: { userId: c.user.id, kind: "standard" } });
  await run(c);
  const std = await db.approval.count({ where: { userId: c.user.id, kind: "standard" } });
  check(std > before, "J7.std.off", "answerStandard OFF -> standard questions go to approvals", { before, after: std, tick: await lastTick(c.user.id) });
  const sub = await db.opportunity.count({ where: { campaignId: camp.id, status: "submitted", updatedAt: { gte: new Date(Date.now() - 60000) } } });
  check(sub === 0, "J7.std.off.nosubmit", "packages waiting on standard answers are not submitted", sub);
  const pg = await c.get("/app/approvals");
  check(pg.status === 200, "J7.std.page", "approvals page renders with standard items", pg.status);
}

// ——— 3. sensitive=decline -> no sensitive approvals on new packages
{
  const { c, camp } = await fresh("j7sens");
  const beforeSens = await db.approval.count({ where: { userId: c.user.id, kind: "sensitive" } });
  await save(c, { sensitive: "decline" });
  await newDay(camp.id);
  await run(c);
  const newSens = await db.approval.count({ where: { userId: c.user.id, kind: "sensitive" } }) - beforeSens;
  check(newSens === 0, "J7.sens.decline", "sensitive=decline -> no new sensitive approvals", newSens);
  const pk = await db.applicationPackage.findFirst({ where: { opportunity: { campaignId: camp.id, updatedAt: { gte: new Date(Date.now() - 60000) } } } });
  const ans = pk && JSON.parse(pk.answers).find((x) => x.kind === "sensitive");
  // Round 8: the employer-facing opt-out is "I prefer not to answer" (SENSITIVE_DECLINE, src/lib/engine/autonomy.ts); the UI shows «Предпочитаю не указывать».
  check(ans?.a === "I prefer not to answer" && ans.status === "approved", "J7.sens.answer", "sensitive answered 'I prefer not to answer'", ans);
  const stillPending = await db.approval.count({ where: { userId: c.user.id, kind: "sensitive", status: "pending" } });
  console.log(`  sensitive approvals created before switching to decline still pending: ${stillPending} (queue not cleaned up)`);
  check(stillPending === 0, "J7.sens.decline.backlog", "switching to 'prefer not to say' resolves the already-queued sensitive questions", stillPending);
}

// ——— 4. outsideCountries ON -> fewer blockers
// Round 8: a Local / CIS plan never applies outside KZ/CIS («Вне тарифа Local / CIS»), whatever the Agent screen says —
// so the toggle is exercised on an International campaign with a KZ-only goal, and the Local plan is checked to stay scoped.
{
  const { c, camp } = await fresh("j7ctry", { where: ["kz"], plan: "international", salary: 0 });
  const blockedBefore = await db.opportunity.count({ where: { campaignId: camp.id, eligibility: "blocked" } });
  await save(c, { outsideCountries: "on" });
  await run(c);
  const blockedAfter = await db.opportunity.count({ where: { campaignId: camp.id, eligibility: "blocked" } });
  check(blockedAfter < blockedBefore, "J7.ctry", "outsideCountries ON -> fewer blocked roles", { blockedBefore, blockedAfter });
  await save(c, {});
  await run(c);
  const blockedBack = await db.opportunity.count({ where: { campaignId: camp.id, eligibility: "blocked" } });
  // Roles the agent prepared while the toggle was ON must be re-checked too: otherwise the next cycle submits them outside the goal.
  const stale = await db.opportunity.findMany({ where: { campaignId: camp.id, status: "prepared", eligibility: { not: "blocked" }, softGaps: { contains: "Страна вне цели" } }, include: { job: { select: { title: true, company: true } } } });
  check(blockedBack >= blockedBefore - 1 && stale.length === 0, "J7.ctry.back", "turning it OFF re-blocks (prepared packages included)", { blockedBefore, blockedBack, preparedStillEligibleOutsideGoal: stale.map((o) => `${o.job.title} — ${o.job.company}`) });
}
{
  const { c, camp } = await fresh("j7ctryl", { where: ["kz"], plan: "local", salary: 0 });
  await save(c, { outsideCountries: "on" });
  await run(c);
  const opps = await db.opportunity.findMany({ where: { campaignId: camp.id }, include: { job: { select: { countries: true, title: true } } } });
  const outside = opps.filter((o) => o.blockers.includes("Вне тарифа"));
  const leaked = outside.filter((o) => o.eligibility !== "blocked" || ["prepared", "submitted"].includes(o.status));
  check(outside.length > 0 && leaked.length === 0, "J7.ctry.local", "Local plan + outsideCountries ON: roles outside KZ/CIS stay blocked «Вне тарифа Local / CIS», none prepared/submitted", { outside: outside.length, leaked: leaked.map((o) => `${o.job.title} ${o.job.countries} ${o.status}`).slice(0, 5) });
}

// ——— 5. belowSalaryFloor
{
  const { c, camp } = await fresh("j7sal", { salary: 150000 });
  const floorBlocked = async () => (await db.opportunity.findMany({ where: { campaignId: camp.id }, select: { blockers: true } })).filter((o) => o.blockers.includes("Зарплата ниже")).length;
  const b = await floorBlocked();
  await save(c, { belowSalaryFloor: "on" });
  await run(c);
  const a = await floorBlocked();
  check(b > 0 && a < b, "J7.salary", "belowSalaryFloor ON removes the salary-floor blocker", { before: b, after: a });
}

// ——— 6. findJobs OFF -> no discovery; personalizeCv OFF -> no packages
{
  const { c, camp } = await fresh("j7find");
  const tmpl = await db.job.findFirst({ where: { roleFamily: "data_analyst", source: "demo" } });
  const { id, opportunities, ...jd } = tmpl;
  const mk = (n) => db.job.create({ data: { ...jd, externalId: `e2e-${n}-${Date.now()}`, dedupeKey: `e2e-${n}-${Date.now()}`, company: `E2E ${n} Co`, postedAt: new Date() } });
  await save(c, { findJobs: undefined });
  const j1 = await mk("off");
  await run(c);
  check(!(await db.opportunity.findFirst({ where: { campaignId: camp.id, jobId: j1.id } })), "J7.find.off", "findJobs OFF -> new job not discovered");
  await save(c, {});
  await run(c);
  check(!!(await db.opportunity.findFirst({ where: { campaignId: camp.id, jobId: j1.id } })), "J7.find.on", "findJobs ON -> discovered on next run");
  await save(c, { personalizeCv: undefined });
  await newDay(camp.id);
  const pBefore = await db.applicationPackage.count({ where: { opportunity: { campaignId: camp.id } } });
  await run(c);
  const pAfter = await db.applicationPackage.count({ where: { opportunity: { campaignId: camp.id } } });
  check(pAfter === pBefore, "J7.cv.off", "personalizeCv OFF -> no new packages", { pBefore, pAfter, tick: await lastTick(c.user.id) });
  await db.job.update({ where: { id: j1.id }, data: { active: false } });
}

// ——— 7. changeSalary has any effect?
{
  const { c, camp } = await fresh("j7chg");
  await save(c, { sensitive: "decline" });
  await newDay(camp.id);
  await run(c);
  const pk1 = await db.applicationPackage.findFirst({ where: { opportunity: { campaignId: camp.id } }, orderBy: { id: "desc" } });
  const s1 = JSON.parse(pk1.answers).find((x) => x.kind === "salary")?.a;
  await save(c, { sensitive: "decline", changeSalary: "on" });
  const o = await db.opportunity.findUnique({ where: { id: pk1.opportunityId } });
  await db.opportunity.update({ where: { id: o.id }, data: { status: "qualified" } });
  await c.action("campaign.prepareOpportunity", [form({ id: o.id })], { page: `/app/opportunities/${o.id}` });
  const s2 = JSON.parse((await db.applicationPackage.findUnique({ where: { opportunityId: o.id } })).answers).find((x) => x.kind === "salary")?.a;
  check(s1 !== s2 || false, "J7.changeSalary", "«Change salary expectation» switch changes anything in the engine (grep: only defined in autonomy.ts)", { off: s1, on: s2 });
}

// ——— 8. Approval resolution bypasses the auto-apply threshold
{
  const { c, camp } = await fresh("j7bypass");
  // restore a real threshold (Opportunities switch writes it back) and find a prepared role below it
  await c.action("opportunities.setAutoApply", [true], { page: "/app/opportunities" });
  const low = await db.opportunity.findFirst({ where: { campaignId: camp.id, status: "prepared", match: { lt: 85 }, decision: "" }, include: { approvals: { where: { status: "pending" } } } });
  if (low && low.approvals.length) {
    for (const ap of low.approvals) await c.action("ops.resolveApproval", [form({ id: ap.id, decision: "edit", answer: "I don't wish to answer" })], { page: "/app/approvals" });
    const after = await db.opportunity.findUnique({ where: { id: low.id } });
    check(after.status !== "submitted", "J7.bypass", `answering the questions of a ${low.match}% role (< 85% threshold, never marked Apply/Auto) must not submit it`, after.status);
  } else console.log("  (no below-threshold prepared role with approvals in this run)", low?.match);
}

// ——— 9. Pause stops the agent
{
  const { c, camp } = await fresh("j7pause");
  await c.action("campaign.setCampaignStatus", [form({ status: "paused" })], { page: "/app/agent" });
  check((await db.campaign.findUnique({ where: { id: camp.id } })).status === "paused", "J7.pause", "pause persists");
  const before = await db.campaign.findUnique({ where: { id: camp.id } });
  await run(c);
  const after = await db.campaign.findUnique({ where: { id: camp.id } });
  check(+after.lastRunAt === +before.lastRunAt, "J7.pause.norun", "paused campaign: Run now does nothing");
  await c.action("campaign.setCampaignStatus", [form({ status: "active" })], { page: "/app/agent" });
  check((await db.campaign.findUnique({ where: { id: camp.id } })).status === "active", "J7.resume", "resume persists");
  await c.action("campaign.updateCampaignSettings", [form({ dailyLimit: "99", autoSubmit: "on" })], { page: "/app/agent" });
  // The ceiling is the plan's daily limit (PLANS[plan].dailyLimit: local 6, international 10), not a global 25.
  const planMax = { local: 6, international: 10 }[camp.plan];
  check((await db.campaign.findUnique({ where: { id: camp.id } })).dailyLimit === planMax, "J7.limit.clamp", `daily limit clamped to the ${camp.plan} plan maximum (${planMax})`, (await db.campaign.findUnique({ where: { id: camp.id } })).dailyLimit);
  await c.action("campaign.updateCampaignSettings", [form({ dailyLimit: "3", autoSubmit: "on" })], { page: "/app/agent" });
  check((await db.campaign.findUnique({ where: { id: camp.id } })).dailyLimit === 3, "J7.limit.set", "daily limit below the plan max is saved", (await db.campaign.findUnique({ where: { id: camp.id } })).dailyLimit);
  await c.action("campaign.updateCampaignSettings", [form({ dailyLimit: "abc", autoSubmit: "on" })], { page: "/app/agent" });
  const cm = await db.campaign.findUnique({ where: { id: camp.id } });
  check(cm.dailyLimit === 3, "J7.limit.nan", "non-numeric limit keeps previous", cm.dailyLimit);
  // Run now on the same day right after activation: does it do anything?
  await run(c);
  console.log("  same-day Run now tick:", await lastTick(c.user.id));
}
console.log(`\n${findings.length} failures`);
await db.$disconnect();
