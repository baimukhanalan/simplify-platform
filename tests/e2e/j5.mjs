// Journey 5: Interview rooms.
import { Client, db, form, check, findings, signupNew, isNotFound, needsMode } from "./lib.mjs";
import { userWithApps, email, INTERVIEW, ASSESS } from "./setup.mjs";

// Rounds and offers are set up by pasting employer mail (setup.mjs → email()); simulation disables pasting — employers of
// the fictional corpus write on their own there (covered by j18).
needsMode("live", "rounds / offers are set up by pasting employer mail — pasting is disabled in simulation");

const { c, apps } = await userWithApps("j5", 3);
await email(c, apps[0], ...INTERVIEW(apps[0]));
await email(c, apps[1], ...ASSESS(apps[1]));
const rec = await db.interview.findFirst({ where: { opportunityId: apps[0].id } });
const asm = await db.interview.findFirst({ where: { opportunityId: apps[1].id } });
check(rec?.round === "recruiter" && asm?.round === "assessment", "J5.setup", "recruiter + assessment rooms exist", [rec?.round, asm?.round]);
const { c: other } = await signupNew("j5other");

let pg = await c.get("/app/interviews");
check(pg.status === 200 && pg.text.includes(rec.id), "J5.list", "interviews list shows rooms", pg.status);
for (const tab of ["", "brief", "questions", "mock", "sent", "debrief", "assessment", "bogus"]) {
  const r = await c.get(`/app/interviews/${rec.id}${tab ? `?tab=${tab}` : ""}`);
  check(r.status === 200, `J5.tab.${tab || "default"}`, `recruiter room tab=${tab || "(default)"}`, r.status);
}
for (const tab of ["", "assessment", "brief", "mock", "sent", "debrief", "questions"]) {
  const r = await c.get(`/app/interviews/${asm.id}${tab ? `?tab=${tab}` : ""}`);
  check(r.status === 200, `J5.atab.${tab || "default"}`, `assessment room tab=${tab || "(default)"}`, r.status);
}
check(isNotFound(await other.get(`/app/interviews/${rec.id}`)), "J5.foreign", "foreign interview room -> 404");
check(isNotFound(await other.get(`/app/interviews/${rec.id}/copilot`)), "J5.foreign.copilot", "foreign copilot -> 404");

// Regenerate brief
const before = JSON.parse(rec.pack);
let r = await c.action("interview.regeneratePack", [form({ id: rec.id })], { page: `/app/interviews/${rec.id}` });
const after = JSON.parse((await db.interview.findUnique({ where: { id: rec.id } })).pack);
check(!r.error && after.brief && after.generatedAt, "J5.regen", "regenerate writes brief + generatedAt", { err: r.error?.slice(0, 200), keys: Object.keys(after) });
pg = await c.get(`/app/interviews/${rec.id}?tab=brief`);
check(pg.status === 200, "J5.regen.render", "brief renders after regenerate", pg.status);
r = await other.action("interview.regeneratePack", [form({ id: rec.id })], { page: `/app/interviews/${rec.id}` });
check(r.redirect?.startsWith("/app/interviews"), "J5.regen.foreign", "foreign regenerate redirected away", r.redirect);

// Mock session save
r = await c.action("interview.saveMockSession", [{ interviewId: rec.id, persona: "recruiter", transcript: [{ role: "interviewer", text: "Tell me about yourself" }, { role: "candidate", text: "I am a data analyst with 4 years..." }], feedback: { answered: 1, avg: 70 } }], { page: `/app/interviews/${rec.id}` });
check(r.result?.ok === true, "J5.mock", "saveMockSession ok", r.result);
check((await db.mockSession.count({ where: { interviewId: rec.id } })) === 1, "J5.mock.db", "mock persisted");
r = await c.action("interview.saveMockSession", [{ interviewId: rec.id, persona: "villain", transcript: [], feedback: {} }], { page: `/app/interviews/${rec.id}` });
check(r.result?.ok === false, "J5.mock.badpersona", "unknown persona rejected", r.result);
r = await other.action("interview.saveMockSession", [{ interviewId: rec.id, persona: "recruiter", transcript: [], feedback: {} }], { page: `/app/interviews/${rec.id}` });
check(r.result?.ok === false, "J5.mock.foreign", "foreign mock save rejected", r.result);
pg = await c.get(`/app/interviews/${rec.id}?tab=mock`);
check(pg.status === 200, "J5.mock.render", "mock tab renders with a saved session", pg.status);

// Debrief
r = await c.action("interview.saveDebrief", [undefined, form({ id: rec.id, transcript: "too short", outcome: "passed" })], { page: `/app/interviews/${rec.id}` });
check(!!r.result?.error, "J5.debrief.short", "short debrief rejected", r.result);
r = await c.action("interview.saveDebrief", [undefined, form({ id: rec.id, transcript: "They asked about my SQL experience and a hard question about A/B test sample sizes. The recruiter said the next step is a hiring manager call next week and they will answer by Friday.", outcome: "maybe" })], { page: `/app/interviews/${rec.id}` });
check(!!r.result?.error, "J5.debrief.outcome", "missing outcome rejected", r.result);
r = await c.action("interview.saveDebrief", [undefined, form({ id: rec.id, transcript: "They asked about my SQL experience and a hard question about A/B test sample sizes. The recruiter said the next step is a hiring manager call next week and they will answer by Friday. Salary was discussed.", outcome: "passed" })], { page: `/app/interviews/${rec.id}` });
const iv2 = await db.interview.findUnique({ where: { id: rec.id } });
const deb = JSON.parse(iv2.debrief);
check(r.result?.ok && iv2.status === "passed" && deb.followUpEmail && deb.questions?.length >= 0, "J5.debrief", "debrief saved, status passed", { res: r.result, st: iv2.status, q: deb.questions, perf: deb.performance, err: r.error?.slice(0, 200) });
pg = await c.get(`/app/interviews/${rec.id}?tab=debrief`);
check(pg.status === 200 && pg.text.replace(/<!-- -->/g, "").includes("Создать раунд «нанимающий менеджер»"), "J5.debrief.render", "debrief tab offers the next round in Russian (round-6 ROUND_LABEL)", pg.status);
// next round
r = await c.action("interview.createNextRound", [form({ id: rec.id, scheduledAt: "2026-10-05T10:00" })], { page: `/app/interviews/${rec.id}` });
const hm = await db.interview.findFirst({ where: { opportunityId: apps[0].id, round: "hiring_manager" } });
check(hm && r.redirect?.includes(hm.id), "J5.nextround", "next round room created + redirect", r.redirect);
check((await db.opportunity.findUnique({ where: { id: apps[0].id } })).status === "hiring_manager", "J5.nextround.status", "opportunity advanced to hiring_manager");
r = await c.action("interview.createNextRound", [form({ id: rec.id, scheduledAt: "" })], { page: `/app/interviews/${rec.id}` });
check((await db.interview.count({ where: { opportunityId: apps[0].id, round: "hiring_manager" } })) === 1, "J5.nextround.idem", "second click doesn't duplicate the round");
r = await c.action("interview.createNextRound", [form({ id: rec.id, scheduledAt: "not-a-date" })], { page: `/app/interviews/${rec.id}` });
check(!r.error, "J5.nextround.baddate", "invalid scheduledAt handled", r.error?.slice(0, 200));
// failed debrief on HM -> opportunity rejected
r = await c.action("interview.saveDebrief", [undefined, form({ id: hm.id, transcript: "The hiring manager asked about stakeholder management and a conflict story. I struggled with the metrics question and they said they would let me know.", outcome: "failed" })], { page: `/app/interviews/${hm.id}` });
check((await db.opportunity.findUnique({ where: { id: apps[0].id } })).status === "rejected", "J5.debrief.failed", "failed debrief -> opportunity rejected");
// passed Final -> offer
const final = await db.interview.create({ data: { userId: c.user.id, opportunityId: apps[2].id, round: "final", pack: "{}" } });
r = await c.action("interview.saveDebrief", [undefined, form({ id: final.id, transcript: "Final round with the VP went great, we discussed my roadmap ideas and the team culture. They said an offer is coming this week.", outcome: "passed" })], { page: `/app/interviews/${final.id}` });
check((await db.opportunity.findUnique({ where: { id: apps[2].id } })).status === "offer", "J5.final.offer", "passed Final -> opportunity offer");
pg = await c.get(`/app/interviews/${final.id}`);
check(pg.status === 200, "J5.final.render", "room with empty pack renders", pg.status);

// Copilot
pg = await c.get(`/app/interviews/${hm.id}/copilot`);
check(pg.status === 200, "J5.copilot", "copilot page renders", pg.status);
r = await c.action("interview.setCopilotAllowed", [form({ id: hm.id, allowed: "false" })], { page: `/app/interviews/${hm.id}` });
check((await db.interview.findUnique({ where: { id: hm.id } })).copilotAllowed === false, "J5.copilot.off", "copilot disallowed persisted");
pg = await c.get(`/app/interviews/${hm.id}/copilot`);
check(pg.status === 200 && /запрещ|внешн|отключ/i.test(pg.text), "J5.copilot.blocked", "copilot page shows employer block", pg.status);
pg = await c.get(`/app/interviews/${asm.id}/copilot`);
check(pg.status === 200, "J5.copilot.assessment", "assessment copilot page renders (blocked)", pg.status);

// Assessment room: debrief + next round recruiter
r = await c.action("interview.saveDebrief", [undefined, form({ id: asm.id, transcript: "The assessment had three SQL tasks and one statistics question about confidence intervals. I finished all of them in time.", outcome: "passed" })], { page: `/app/interviews/${asm.id}` });
r = await c.action("interview.createNextRound", [form({ id: asm.id })], { page: `/app/interviews/${asm.id}` });
const rec2 = await db.interview.findFirst({ where: { opportunityId: apps[1].id, round: "recruiter" } });
check(!!rec2, "J5.assess.next", "assessment -> recruiter round created", r.redirect);
check((await db.opportunity.findUnique({ where: { id: apps[1].id } })).status === "recruiter", "J5.assess.status", "opportunity advanced to recruiter");
pg = await c.get("/app/interviews");
check(pg.status === 200, "J5.list.after", "interviews list renders after all changes", pg.status);
console.log(`\n${findings.length} failures`);
await db.$disconnect();
