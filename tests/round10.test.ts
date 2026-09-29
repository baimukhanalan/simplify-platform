// Round-10 fixes: business-hours round times (1), one «needs you» source (2), the agent's preparation bar and dream-company
// decisions (3), role labels with city/format (4), mock scoring (5), /check market and wording (7), cover-letter wording (8),
// one card per standing question (9), discovery sentence (11); plus regressions A (prepared roles re-checked before
// sending), B (salary fix keeps the goal currency), C (overridable blockers). DB tests use a throwaway SQLite database.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { businessSlot, endOfDayAlmaty, snapRoundTime } from "../src/lib/time";
import { scoreAnswer, structureScore, SHORT_ANSWER_CAP } from "../src/lib/engine/interview";
import { scoreJob, isOverridable, BELOW_GOAL, DREAM_DECISION, type CandidateCtx, type JobCtx } from "../src/lib/engine/matching";
import { usdToGoalAmount } from "../src/lib/engine/fx";
import { marketNote, assessReadiness } from "../src/lib/engine/readiness";
import { buildPackageHeuristic, overlapsEurope, type FactLite, type ProfileLite, type JobLite } from "../src/lib/engine/personalize";
import { roleLabelRu, plural } from "../src/lib/ru";
import { readAutonomy } from "../src/lib/engine/autonomy";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-r10-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
// These cases pin the plain engine (live mode): no corpus top-up in discovery, live application forms. Simulation mode has
// its own suite (tests/simulation.test.ts).
process.env.SIMPLIFY_MODE = "live";

/** Almaty wall-clock parts of an instant (UTC+5). */
const almaty = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Almaty", hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { wd: p.weekday, h: Number(p.hour), m: Number(p.minute) };
};
const inBusinessHours = (d: Date) => {
  const a = almaty(d);
  return !["Sat", "Sun"].includes(a.wd) && a.h * 60 + a.m >= 600 && a.h * 60 + a.m <= 17 * 60 + 30 && a.m % 30 === 0;
};

// ——— 1 · round times ———
describe("1 · interview / assessment times land on business hours in Almaty", () => {
  test("a 04:31 placeholder becomes 10:00 the same weekday; Friday evening → Monday 10:00; Saturday → Monday", () => {
    assert.equal(businessSlot(new Date("2026-09-29T23:31:00Z")).toISOString(), "2026-09-30T05:00:00.000Z"); // Wed 04:31 → Wed 10:00
    assert.equal(businessSlot(new Date("2026-10-02T13:10:00Z")).toISOString(), "2026-10-05T05:00:00.000Z"); // Fri 18:10 → Mon 10:00
    assert.equal(businessSlot(new Date("2026-10-03T05:00:00Z")).toISOString(), "2026-10-05T05:00:00.000Z"); // Sat → Mon
    assert.equal(businessSlot(new Date("2026-09-30T07:10:00Z")).toISOString(), "2026-09-30T07:30:00.000Z"); // 12:10 → 12:30 grid
  });
  test("assessment deadline = 23:59 Almaty of its day; a past time never jumps into the future", () => {
    const at = new Date("2026-10-02T13:10:00Z");
    assert.equal(snapRoundTime("assessment", at, new Date("2026-09-29T00:00:00Z")).toISOString(), endOfDayAlmaty(at).toISOString());
    assert.equal(endOfDayAlmaty(at).toISOString(), "2026-10-02T18:59:00.000Z");
    const now = new Date("2026-09-30T08:00:00Z");
    const past = snapRoundTime("recruiter", new Date("2026-09-29T23:31:00Z"), now);
    assert.ok(past <= now && inBusinessHours(past), past.toISOString());
  });
  test("many random times: always inside a weekday 10:00–17:30 slot, never earlier than asked", () => {
    for (let i = 0; i < 300; i++) {
      const at = new Date(Date.UTC(2026, 8, 1) + Math.floor(i * 7919 * 60000 * 1.37));
      const s = businessSlot(at);
      assert.ok(inBusinessHours(s) && s >= at && s.getTime() - at.getTime() < 4 * 86400000, `${at.toISOString()} → ${s.toISOString()}`);
    }
  });
});

// ——— 5 · mock scoring ———
describe("5 · mock scoring", () => {
  const ctx = { skills: ["SQL"], jdTerms: ["SQL"] };
  test("answers under 20 words are capped at ~30 overall", () => {
    const s = scoreAnswer("Why this role?", "I love SQL and data, first I analyze, then I report. So it fits well.", ctx);
    assert.ok(s.words < 20 && s.overall <= SHORT_ANSWER_CAP, JSON.stringify(s));
  });
  test("structure comes from real cues, not a free 60", () => {
    assert.equal(structureScore("SQL is great"), 20);
    const rich = "First I check the data source and the tracking. Then I compare segments, for example new versus returning users. So the drop came from one release.";
    assert.ok(structureScore(rich) >= 85, String(structureScore(rich)));
    assert.ok(scoreAnswer("How do you investigate a drop?", "I look at it", ctx).structure < 60);
  });
  test("«like» the verb is not a filler; «like,» and «I was like» are", () => {
    assert.equal(scoreAnswer("Q", "I like working with SQL and I would like to join a team that uses tools like dbt.", ctx).fillers, 0);
    assert.equal(scoreAnswer("Q", "It was, like, a big project and I was like wow.", ctx).fillers, 2);
    assert.equal(scoreAnswer("Q", "Um, basically I built it.", ctx).fillers, 2);
  });
});

// ——— 3 / C · scoring rules ———
const cand = (over: Partial<CandidateCtx> = {}, goal: Partial<CandidateCtx["goal"]> = {}): CandidateCtx => ({
  skills: ["SQL", "Python", "Tableau", "Excel"], yearsExperience: 3, englishLevel: "C1", languages: ["English", "Russian"], workAuth: ["KZ"],
  needsSponsorship: true, relocation: true, educationLevel: "bachelor", allocation: {}, ...over,
  goal: { primaryRole: "Data Analyst", extraRoles: [], seniority: "middle", minSalary: 0, countries: ["WORLD"], workModes: ["remote"], industries: [], dreamCompanies: ["Dreamco"], blockedCompanies: [], mode: "autonomous", ...goal },
});
const job = (over: Partial<JobCtx> = {}): JobCtx => ({
  title: "Data Analyst", company: "Acme", roleFamily: "data_analyst", seniority: "middle", countries: ["*"], remote: "remote",
  salaryMin: null, salaryMax: null, technologies: ["SQL", "Python"], requirements: [], minYears: 2, education: "", workAuth: [], sponsorship: "unknown",
  languages: ["English"], industry: "", massHiring: false, postedAt: new Date(Date.now() - 86400000), ...over,
});

describe("3 / C · dream-company level decisions and overridable blockers", () => {
  test("a dream company blocked only by level becomes the user's decision; elsewhere it stays blocked", () => {
    const senior = { title: "Senior Data Analyst", seniority: "senior", minYears: 6 };
    const other = scoreJob(cand(), job(senior));
    assert.equal(other.eligibility, "blocked");
    const dream = scoreJob(cand(), job({ ...senior, company: "Dreamco" }));
    assert.notEqual(dream.eligibility, "blocked");
    assert.equal(dream.userDecision, true);
    assert.equal(dream.softGaps[0], DREAM_DECISION);
    // A non-level blocker (onsite abroad, no sponsorship) keeps a dream role blocked.
    const visa = scoreJob(cand({}, { workModes: ["remote", "onsite"] }), job({ ...senior, company: "Dreamco", remote: "onsite", countries: ["DE"], sponsorship: "no" }));
    assert.equal(visa.eligibility, "blocked");
  });
  test("isOverridable: only «Уровень ниже цели», or level lines at a dream company", () => {
    assert.equal(isOverridable([BELOW_GOAL]), true);
    assert.equal(isOverridable(JSON.stringify([BELOW_GOAL])), true);
    assert.equal(isOverridable(["Нужно 6+ лет опыта, у тебя 3 года — роль на уровень выше"]), false);
    assert.equal(isOverridable(["Нужно 6+ лет опыта, у тебя 3 года — роль на уровень выше"], { dream: true }), true);
    assert.equal(isOverridable([BELOW_GOAL, "Страна вне цели: DE"]), false);
    assert.equal(isOverridable([]), false);
  });
});

// ——— B · salary fix currency ———
describe("B · a USD market median written into a ₸ goal is converted", () => {
  test("USD 46 000 → 23 000 000 ₸, USD stays USD", () => {
    assert.equal(usdToGoalAmount(46000, "KZT"), 23000000);
    assert.equal(usdToGoalAmount(46000, "USD"), 46000);
    assert.equal(usdToGoalAmount(0, "KZT"), 0);
  });
});

// ——— 4 / 7 / 8 · wording ———
const P: ProfileLite = {
  name: "Test", email: "", phone: "", location: "Almaty, Kazakhstan", headline: "", summary: "", skills: ["SQL", "Python"], yearsExperience: 3, englishLevel: "C1",
  workAuth: ["KZ"], needsSponsorship: true, relocation: false, linkedin: "", github: "", portfolio: "", noticePeriod: "", salaryExpectation: 0, citizenship: "KZ",
};
const J: JobLite = { title: "BI Analyst", company: "Vantage Media", roleFamily: "data_analyst", description: "", technologies: ["SQL"], requirements: [], countries: ["*"], remote: "remote", sponsorship: "unknown", salaryMin: null, salaryMax: null, industry: "Media" };
const fact = (details: string, metrics = ""): FactLite => ({ id: "f", kind: "employment", title: "Аналитик", org: "Kaspi", startDate: "Jan 2023", endDate: "present", details, metrics, tech: [], verified: true });

describe("4 · 7 · 8 · wording", () => {
  test("role labels carry city and format", () => {
    assert.equal(roleLabelRu({ company: "Vantage Media", title: "BI Analyst", location: "Almaty, Kazakhstan", remote: "onsite" }), "Vantage Media · BI Analyst (Алматы · офис)");
    assert.equal(roleLabelRu({ company: "X", title: "Y", location: "Remote — Europe", remote: "remote" }), "X · Y (Удалённо — Европа)");
  });
  test("«Найдена 1 новая вакансия» / «Найдено 5 новых вакансий»", () => {
    assert.equal(plural(1, ["Найдена", "Найдено", "Найдено"]), "Найдена");
    assert.equal(plural(5, ["Найдена", "Найдено", "Найдено"]), "Найдено");
  });
  test("cover letter: remote overlap only for a remote job and a Europe-overlapping timezone; no «Media's work in Media»", () => {
    const kz = buildPackageHeuristic(P, [fact("Built SQL dashboards")], J).coverLetter;
    assert.match(kz, /European business hours/);
    assert.doesNotMatch(kz, /work in Media/);
    const us = buildPackageHeuristic({ ...P, location: "Seattle, USA", citizenship: "US" }, [fact("Built SQL dashboards")], J).coverLetter;
    assert.doesNotMatch(us, /European business hours/);
    const office = buildPackageHeuristic(P, [fact("Built SQL dashboards")], { ...J, remote: "onsite" }).coverLetter;
    assert.doesNotMatch(office, /European business hours/);
    assert.equal(overlapsEurope({ location: "", citizenship: "" }), false);
  });
  test("summary is one language: a Russian CV gets a Russian summary; English never splices a Russian bullet", () => {
    const ru = buildPackageHeuristic(P, [fact("- Построила дашборды для 40 команд\n- Сократила отчётность на 6 часов", "Сократила отчётность на 6 часов")], J).summary;
    assert.match(ru, /Ключевые инструменты/);
    assert.doesNotMatch(ru, /professional with/);
    const en = buildPackageHeuristic(P, [fact("- Built dashboards for 40 teams\n- Reduced reporting by 6 hours\n- Сократила отчёт", "Сократила отчёт")], J).summary;
    assert.doesNotMatch(en, /[А-Яа-яЁё]/);
  });
  test("/check market for a KZ candidate: ₸ per month with USD per year; no right-to-work claim without countries", () => {
    const line = marketNote({ low: 20000, high: 28000 }, ["KZ", "CIS"]);
    assert.match(line, /^Рынок Казахстана и СНГ ≈ .+₸ в месяц \(≈ \$.+ в год\)$/);
    assert.match(marketNote({ low: 50000, high: 70000 }, ["EU"]), /^Рынок ≈ \$.+ в год$/);
    const r = assessReadiness({
      profile: { yearsExperience: 3, skills: ["SQL"], englishLevel: "C1", cvText: "", summary: "", workAuth: ["KZ"], needsSponsorship: true, linkedin: "", github: "", portfolio: "" },
      facts: [], stories: 0,
      goal: { primaryRole: "Product Manager", seniority: "middle", minSalary: 0, countries: ["KZ", "CIS", "WORLD"], workModes: ["remote"], dreamCompanies: [], sponsorshipNeeded: true, countriesGiven: false, marketRegions: ["KZ", "CIS"] },
    });
    assert.equal(r.checks.find((c) => c.key === "geo")?.note, "Страны не указаны");
    assert.match(r.checks.find((c) => c.key === "salary")!.note, /₸ в месяц/);
  });
});

// ——— DB: 1, 2, 3, 9, 11, A ———
type Db = typeof import("../src/lib/db").db;
let db: Db;
let agent: typeof import("../src/lib/engine/agent");
let approvals: typeof import("../src/lib/engine/approvals");
let ops: typeof import("../src/lib/ops-data");
let today: typeof import("../src/app/app/_components/today-data");

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  agent = await import("../src/lib/engine/agent");
  approvals = await import("../src/lib/engine/approvals");
  ops = await import("../src/lib/ops-data");
  today = await import("../src/app/app/_components/today-data");
});
after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function makeUser(opts: { countries?: string[]; autonomy?: object; dream?: string[] } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `r10-${seq}-${Date.now()}@test.local`, passwordHash: "x", name: "Test User", autonomy: JSON.stringify({ findJobs: false, ...opts.autonomy }),
      profile: { create: { skills: JSON.stringify(["SQL", "Python", "Tableau", "Excel"]), workAuth: JSON.stringify(["KZ"]), citizenship: "KZ", location: "Almaty, Kazakhstan", englishLevel: "C1", yearsExperience: 3, relocation: true, needsSponsorship: true } },
      goal: { create: { primaryRole: "Data Analyst", seniority: "middle", minSalary: 0, currency: "USD", countries: JSON.stringify(opts.countries ?? ["KZ", "CIS", "WORLD", "EU"]), workModes: JSON.stringify(["remote", "hybrid", "onsite"]), dreamCompanies: JSON.stringify(opts.dream ?? []) } },
    },
  });
  const campaign = await db.campaign.create({ data: { userId: user.id, plan: "international", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 10, startedAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  return { user, campaign };
}
async function makeJob(over: { company?: string; title?: string; countries?: string[]; technologies?: string[]; seniority?: string; minYears?: number; location?: string; active?: boolean } = {}) {
  seq++;
  return db.job.create({
    data: {
      source: "demo", externalId: `r10-${seq}`, dedupeKey: `r10-${seq}-${Date.now()}`, company: over.company ?? `Co${seq}`, title: over.title ?? "Data Analyst",
      location: over.location ?? "Remote — Worldwide", roleFamily: "data_analyst", seniority: over.seniority ?? "junior", minYears: over.minYears ?? 1,
      countries: JSON.stringify(over.countries ?? ["*"]), remote: "remote", technologies: JSON.stringify(over.technologies ?? ["SQL", "Python"]), languages: JSON.stringify(["English"]),
      sponsorship: "unknown", postedAt: new Date(), active: over.active ?? false,
    },
  });
}
const opp = (campaignId: string, jobId: string, over: { status?: string; match?: number; decision?: string } = {}) =>
  db.opportunity.create({ data: { campaignId, jobId, match: over.match ?? 95, status: over.status ?? "qualified", eligibility: "eligible", decision: over.decision ?? "", priority: 0.2, pInterview: 0.2 } });

describe("1 (DB) · createInterview", () => {
  test("the placeholder «in 3 days» is a business-hours slot; an assessment is due 23:59", async () => {
    const { user, campaign } = await makeUser();
    const o = await opp(campaign.id, (await makeJob()).id, { status: "submitted" });
    const iv = await agent.createInterview(user.id, o.id, "recruiter");
    assert.ok(iv.scheduledAt && inBusinessHours(iv.scheduledAt), iv.scheduledAt?.toISOString());
    const as = await agent.createInterview(user.id, o.id, "assessment");
    assert.deepEqual([almaty(as.scheduledAt!).h, almaty(as.scheduledAt!).m], [23, 59]);
    const exact = new Date(Date.now() + 86400000 + 17 * 60000);
    const ex = await agent.createInterview(user.id, o.id, "technical", exact, { exact: true });
    assert.equal(ex.scheduledAt?.getTime(), exact.getTime(), "a time the user picked is kept as is");
  });
});

describe("3 (DB) · the agent prepares only Match ≥ 70 unless the user picked the role", () => {
  test("a qualified role scoring below 70 leaves the queue; with Apply it is prepared", async () => {
    await db.job.updateMany({ data: { active: false } });
    const weak = ["Scala", "Spark", "Kafka", "Airflow"];
    const { campaign } = await makeUser();
    const a = await opp(campaign.id, (await makeJob({ technologies: weak })).id, { match: 60 });
    const b = await opp(campaign.id, (await makeJob({ technologies: weak })).id, { match: 60, decision: "apply" });
    assert.equal(agent.QUEUE_MATCH, 70);
    await agent.runTick(campaign.id);
    const [ra, rb] = await Promise.all([db.opportunity.findUniqueOrThrow({ where: { id: a.id } }), db.opportunity.findUniqueOrThrow({ where: { id: b.id } })]);
    assert.ok(ra.match < 70, String(ra.match));
    assert.equal(ra.status, "found");
    assert.equal(await db.applicationPackage.count({ where: { opportunityId: a.id } }), 0);
    assert.ok(["prepared", "submitted"].includes(rb.status), rb.status);
  });
  test("a dream-company role blocked only by level waits for the user (not prepared, counted in needsYou)", async () => {
    // The internal corpus is created up front (discovery would add it) and switched off with everything else.
    await (await import("../src/lib/engine/ingest")).ensureSeedJobs();
    await db.job.updateMany({ data: { active: false } });
    const { user, campaign } = await makeUser({ dream: ["Dreamco"], autonomy: { findJobs: true } });
    await makeJob({ company: "Dreamco", title: "Senior Data Analyst", seniority: "senior", minYears: 6, active: true });
    await agent.discover(campaign.id);
    const o = await db.opportunity.findFirstOrThrow({ where: { campaignId: campaign.id, job: { company: "Dreamco" } } });
    assert.equal(o.status, "qualified");
    assert.ok(JSON.parse(o.softGaps).includes(DREAM_DECISION));
    await db.user.update({ where: { id: user.id }, data: { autonomy: JSON.stringify({ findJobs: false }) } });
    await agent.runTick(campaign.id);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: o.id } })).status, "qualified");
    assert.equal(await db.applicationPackage.count({ where: { opportunityId: o.id } }), 0);
    const n = await ops.needsYou(user.id);
    // The dream-company role waits for the user; so do strong stale (> 30 days) roles the agent takes only after Apply
    // (round 12: the count and the «Ждут решения» tab are one definition — awaitingDecisionWhere).
    const queue = await ops.nextCycleQueue(campaign, readAutonomy(JSON.stringify({ findJobs: false })));
    assert.equal(queue.notQueued[o.id], "dream-decision");
    assert.equal(n.applyDecisions, await db.opportunity.count({ where: ops.awaitingDecisionWhere(campaign.id, queue) }));
    const stale = Object.values(queue.notQueued).filter((r) => r === "stale").length;
    assert.equal(n.applyDecisions, 1 + stale);
    const tick = await db.event.findFirstOrThrow({ where: { userId: user.id, type: "tick" }, orderBy: { createdAt: "desc" } });
    assert.match(tick.message, new RegExp(`${n.applyDecisions} ваканси\\S+ жд\\S+ твоего решения в Opportunities`));
    assert.doesNotMatch(tick.message, /часть заявок/);
  });
});

describe("9 (DB) · one card per standing question", () => {
  test("the same sponsorship question on two roles is one approval; the answer reaches both; nothing is sent before", async () => {
    await db.job.updateMany({ data: { active: false } });
    const { user, campaign } = await makeUser();
    const a = await opp(campaign.id, (await makeJob({ company: "Silkroad Markets", title: "BI Analyst", countries: ["DE"] })).id, { decision: "apply" });
    const b = await opp(campaign.id, (await makeJob({ company: "Silkroad Markets", title: "Product Analyst", countries: ["DE"] })).id, { decision: "apply" });
    await agent.prepare(a.id);
    await agent.prepare(b.id);
    const cards = await db.approval.findMany({ where: { userId: user.id, status: "pending", kind: "sponsorship" } });
    assert.equal(cards.length, 1);
    assert.equal(await db.approval.count({ where: { userId: user.id, status: "pending", kind: "sensitive" } }), 1);
    assert.equal((await agent.submit(b.id)).reason, "approvals", "b waits for the shared answer");
    // The user answers both cards (what resolveApproval does).
    for (const card of await db.approval.findMany({ where: { userId: user.id, status: "pending" } })) {
      const answer = card.kind === "sponsorship" ? "Yes" : agent.SENSITIVE_DECLINE;
      await db.approval.update({ where: { id: card.id }, data: { status: "approved", answer, resolvedAt: new Date() } });
      await approvals.patchPackageAnswer(card.opportunityId!, card.question, answer, "approved");
      await approvals.answerMatchingApprovals(user.id, { kind: card.kind, question: card.question, answer, excludeId: card.id });
    }
    const pkgB = JSON.parse((await db.applicationPackage.findUniqueOrThrow({ where: { opportunityId: b.id } })).answers) as { kind?: string; a: string; status: string }[];
    assert.equal(pkgB.find((x) => x.kind === "sponsorship")?.a, "Yes");
    assert.ok(pkgB.every((x) => x.status !== "pending"));
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: b.id } })).status, "submitted");
  });
});

describe("A (DB) · prepared packages are re-checked before sending", () => {
  test("outside-countries turned off: rerank sets the prepared role aside; submit refuses a blocked one", async () => {
    await db.job.updateMany({ data: { active: false } });
    const { user, campaign } = await makeUser({ countries: ["KZ"], autonomy: { outsideCountries: true } });
    const a = await opp(campaign.id, (await makeJob({ countries: ["DE"], location: "Remote — Europe" })).id);
    const b = await opp(campaign.id, (await makeJob({ countries: ["DE"], location: "Remote — Europe" })).id);
    await agent.prepare(a.id);
    await agent.prepare(b.id);
    await db.user.update({ where: { id: user.id }, data: { autonomy: JSON.stringify({ findJobs: false, outsideCountries: false }) } });
    // b: submit straight away (e.g. the last question answered) → refused and set aside.
    await db.approval.updateMany({ where: { opportunityId: b.id }, data: { status: "approved", answer: "x", resolvedAt: new Date() } });
    const r = await agent.submit(b.id);
    assert.equal(r.ok, false);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: b.id } })).status, "skipped");
    // a: the next cycle's rerank sets it aside with its blocker, keeps the package, closes its questions.
    await agent.rerank(campaign.id);
    const ra = await db.opportunity.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(ra.status, "skipped");
    assert.ok(JSON.parse(ra.blockers).some((x: string) => x.startsWith("Страна вне цели")), ra.blockers);
    assert.ok(await db.applicationPackage.findUnique({ where: { opportunityId: a.id } }));
    assert.equal(await db.approval.count({ where: { opportunityId: a.id, status: "pending" } }), 0);
    // Turned back on: it returns to the queue.
    await db.user.update({ where: { id: user.id }, data: { autonomy: JSON.stringify({ findJobs: false, outsideCountries: true }) } });
    await agent.rerank(campaign.id);
    assert.equal((await db.opportunity.findUniqueOrThrow({ where: { id: a.id } })).status, "qualified");
  });
});

describe("11 · discovery sentence", () => {
  test("zero parts hidden; a single role is described as itself", () => {
    const b = (x: Partial<{ found: number; qualified: number; weaker: number; blocked: number; setAside: number }>) => ({ found: 0, qualified: 0, weaker: 0, blocked: 0, setAside: 0, ...x });
    assert.equal(today.discoverySentence(b({ found: 1, blocked: 1 })), "Сегодня агент нашёл 1 вакансию — она не проходит по требованиям.");
    assert.equal(today.discoverySentence(b({})), "Сегодня агент пока не нашёл новых вакансий.");
    assert.equal(today.discoverySentence(b({ found: 4, blocked: 4 })), "Сегодня агент нашёл 4 вакансии — все не проходят по требованиям.");
    assert.equal(today.discoverySentence(b({ found: 12, qualified: 5, weaker: 3, blocked: 4 })), "Сегодня агент нашёл 12 вакансий: 5 подходят (Match 70+), 3 — со слабым совпадением, 4 не проходят по требованиям.");
    assert.equal(today.discoverySentence(b({ found: 2, qualified: 1, blocked: 1 })), "Сегодня агент нашёл 2 вакансии: 1 подходит (Match 70+), 1 не проходит по требованиям.");
  });
});
