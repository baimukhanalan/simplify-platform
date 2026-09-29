// Removes everything the dev-server journeys created: e2e-test-*@example.com users (j20+, stress-dev), users the old
// journeys signed up through lib.mjs (e2e-*@test.local) when run against the dev DB, tests/stress.mjs users
// (stress+*@example.com) and fixture jobs (dedupeKey e2e-test-*).
//   node tests/e2e/cleanup-dev.mjs
import { db, cleanup } from "./lib-dev.mjs";

const n = await cleanup();
const extra = await db.user.findMany({ where: { OR: [{ AND: [{ email: { startsWith: "e2e-" } }, { email: { endsWith: "@test.local" } }] }, { AND: [{ email: { startsWith: "stress+" } }, { email: { endsWith: "@example.com" } }] }, { AND: [{ email: { startsWith: "plan-" } }, { email: { endsWith: "@test.local" } }] }] }, select: { id: true } });
const ids = extra.map((u) => u.id);
await db.payment.deleteMany({ where: { userId: { in: ids } } });
await db.errorLog.deleteMany({ where: { userId: { in: ids } } });
await db.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredUserId: { in: ids } }] } });
let m = 0;
for (const id of ids) { try { await db.user.delete({ where: { id } }); m++; } catch (e) { console.log("failed", id, e.message.slice(0, 160)); } }
const jobs = await db.job.findMany({ where: { dedupeKey: { startsWith: "e2e-test-" } }, select: { id: true } });
await db.opportunity.deleteMany({ where: { jobId: { in: jobs.map((j) => j.id) } } });
const j = await db.job.deleteMany({ where: { id: { in: jobs.map((x) => x.id) } } });
const orphanPays = await db.payment.deleteMany({ where: { userId: null, externalId: { startsWith: "KSP-E2E" } } });
console.log(`removed ${n} e2e-test users, ${m} old-journey/stress users, ${j.count} jobs, ${orphanPays.count} orphan fixture payments`);
await db.$disconnect();
