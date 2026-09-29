// Cron time budget (src/app/api/cron/tick/route.ts): past the budget the route stops starting new cycles, reports the
// rest as `deferred`, and the next invocation starts with the campaigns that were deferred (least recently run first).
// The budget is a constant (not env-configurable), so the clock is simulated by stubbing Date.now inside the route.
// DB tests run against a throwaway SQLite database (never the dev DB).
import { test, describe, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "simplify-cron-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.CRON_SECRET = "cron-test-secret";
process.env.SIMPLIFY_LIVE_INGEST = "0"; // no network in tests: the live ingest step is covered by tests/sources.test.ts
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

type Db = typeof import("../src/lib/db").db;
let db: Db;
let GET: (req: Request) => Promise<Response>;

const realNow = Date.now;
afterEach(() => { Date.now = realNow; });

before(async () => {
  execSync("npx prisma db push --skip-generate --schema prisma/schema.prisma", { cwd: process.cwd(), env: process.env, stdio: "pipe" });
  ({ db } = await import("../src/lib/db"));
  ({ GET } = await import("../src/app/api/cron/tick/route"));
  // No vacancies: each cycle is cheap and only stamps lastRunAt.
  await (await import("../src/lib/engine/ingest")).ensureSeedJobs();
  await db.job.updateMany({ data: { active: false } });
});

after(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
async function campaign(lastRunAt: Date | null) {
  seq++;
  const user = await db.user.create({
    data: {
      email: `cron-${seq}-${realNow()}@test.local`, passwordHash: "x", name: "Cron User", autonomy: JSON.stringify({ findJobs: false }),
      profile: { create: { skills: "[]", workAuth: JSON.stringify(["KZ"]), yearsExperience: 2 } },
      goal: { create: { primaryRole: "Data Analyst", countries: JSON.stringify(["WORLD"]) } },
    },
  });
  return db.campaign.create({ data: { userId: user.id, plan: "local", priceKzt: 1, status: "active", autoSubmit: true, dailyLimit: 6, startedAt: new Date(), endsAt: new Date(realNow() + 30 * 86400000), lastRunAt } });
}
const call = (auth = "Bearer cron-test-secret") => GET(new Request("http://localhost/api/cron/tick", { headers: { authorization: auth } }));

/** Date.now as the route sees it: the real clock for the first `freeCalls` reads, then `jumpMs` later. */
function clockJumpsAfter(freeCalls: number, jumpMs: number) {
  let n = 0;
  const t0 = realNow();
  Date.now = () => (++n <= freeCalls ? t0 : t0 + jumpMs);
}

describe("cron time budget", () => {
  test("rejects a wrong secret", async () => {
    assert.equal((await call("Bearer nope")).status, 401);
    assert.equal((await call("")).status, 401);
  });

  test("past the budget, the remaining campaigns are deferred — never run — and reported", async () => {
    await db.campaign.updateMany({ data: { status: "expired" } });
    const old = new Date(realNow() - 3 * 3600000);
    const a = await campaign(null); // never run: first
    const b = await campaign(new Date(old.getTime() - 60000)); // oldest run: second
    const c = await campaign(old);

    // started + the check before the 1st campaign read the real clock; the check before the 2nd is 241 s later.
    clockJumpsAfter(2, 241_000);
    const body = await (await call()).json();
    Date.now = realNow;
    assert.deepEqual(body, { ran: 1, expired: 0, failed: 0, deferred: 2 });
    const [ra, rb, rc] = await Promise.all([a, b, c].map((x) => db.campaign.findUniqueOrThrow({ where: { id: x.id } })));
    assert.ok(ra.lastRunAt, "the never-run campaign goes first");
    assert.equal(rb.lastRunAt?.getTime(), b.lastRunAt?.getTime(), "deferred campaign was not touched");
    assert.equal(rc.lastRunAt?.getTime(), c.lastRunAt?.getTime(), "deferred campaign was not touched");

    // Next invocation, again over budget after one cycle: the deferred, least recently run campaign goes next (rotation).
    clockJumpsAfter(2, 241_000);
    const body2 = await (await call()).json();
    Date.now = realNow;
    assert.deepEqual(body2, { ran: 1, expired: 0, failed: 0, deferred: 2 });
    const rb2 = await db.campaign.findUniqueOrThrow({ where: { id: b.id } });
    const rc2 = await db.campaign.findUniqueOrThrow({ where: { id: c.id } });
    assert.ok(rb2.lastRunAt! > b.lastRunAt!, "the oldest deferred campaign ran in the next invocation");
    assert.equal(rc2.lastRunAt?.getTime(), c.lastRunAt?.getTime());

    // Within budget: everything runs.
    const body3 = await (await call()).json();
    assert.deepEqual(body3, { ran: 3, expired: 0, failed: 0, deferred: 0 });
  });

  test("already over budget before the first campaign: nothing runs, all deferred", async () => {
    await db.campaign.updateMany({ data: { status: "expired" } });
    await campaign(null);
    await campaign(null);
    clockJumpsAfter(1, 241_000);
    const body = await (await call()).json();
    Date.now = realNow;
    assert.deepEqual(body, { ran: 0, expired: 0, failed: 0, deferred: 2 });
  });

  test("exactly at the budget still starts the next cycle (the budget is exceeded only past 240 s)", async () => {
    await db.campaign.updateMany({ data: { status: "expired" } });
    await campaign(null);
    await campaign(null);
    clockJumpsAfter(2, 240_000);
    const body = await (await call()).json();
    Date.now = realNow;
    assert.deepEqual(body, { ran: 2, expired: 0, failed: 0, deferred: 0 });
  });

  test("a paused campaign past its end date is expired by cron (visited, not counted as ran)", async () => {
    await db.campaign.updateMany({ data: { status: "expired" } });
    const p = await campaign(null);
    await db.campaign.update({ where: { id: p.id }, data: { status: "paused", endsAt: new Date(realNow() - 1000) } });
    const body = await (await call()).json();
    assert.deepEqual(body, { ran: 0, expired: 1, failed: 0, deferred: 0 });
    assert.equal((await db.campaign.findUniqueOrThrow({ where: { id: p.id } })).status, "expired");
  });
});
