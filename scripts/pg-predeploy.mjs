// Runs before `prisma db push` on Postgres (vercel-build). Makes the data fit the schema's unique constraints so the push
// never fails and never needs --accept-data-loss (the unique indexes are created here, under Prisma's names, so the push
// finds them in place). Idempotent; every step is skipped when its table does not exist yet.
//
//   Interview @@unique([opportunityId, round]) — duplicate rounds (from concurrent employer replies) are merged into the
//     oldest row: their mock sessions move to it, the extra rows are removed.
//   Integration @@unique([provider, externalUserId]) — externalUserId becomes nullable; "" (no account) → NULL so
//     extension rows don't collide; an hh account linked to two users keeps only the most recently updated link (the
//     older row loses its externalUserId; its user reconnects).
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.log("pg-predeploy: not a Postgres DATABASE_URL — skipped");
  process.exit(0);
}

const db = new PrismaClient();

async function step(name, sqls) {
  try {
    await db.$transaction(sqls.map((q) => db.$executeRawUnsafe(q)));
    console.log(`pg-predeploy: ${name} — ok`);
  } catch (e) {
    // 42P01 undefined_table / 42703 undefined_column: a fresh database, nothing to fix.
    if (e?.meta?.code === "42P01" || e?.meta?.code === "42703" || /does not exist/.test(String(e?.message))) {
      console.log(`pg-predeploy: ${name} — skipped (${String(e?.meta?.message ?? e?.message).split("\n")[0]})`);
      return;
    }
    throw e;
  }
}

const RANKED_INTERVIEWS = `SELECT id, first_value(id) OVER (PARTITION BY "opportunityId", round ORDER BY "createdAt", id) AS keep FROM "Interview"`;

try {
  await step("Interview: merge duplicate rounds", [
    `UPDATE "MockSession" m SET "interviewId" = k.keep FROM (${RANKED_INTERVIEWS}) k WHERE m."interviewId" = k.id AND k.id <> k.keep`,
    `DELETE FROM "Interview" i USING (${RANKED_INTERVIEWS}) k WHERE i.id = k.id AND k.id <> k.keep`,
    // Created here (with Prisma's own name) so `prisma db push` finds it in place and has no data-loss warning to stop on.
    `CREATE UNIQUE INDEX IF NOT EXISTS "Interview_opportunityId_round_key" ON "Interview"("opportunityId", "round")`,
  ]);
  await step("Integration: externalUserId nullable, empty → NULL, one user per hh account", [
    `ALTER TABLE "Integration" ALTER COLUMN "externalUserId" DROP NOT NULL`,
    `ALTER TABLE "Integration" ALTER COLUMN "externalUserId" DROP DEFAULT`,
    `UPDATE "Integration" SET "externalUserId" = NULL WHERE "externalUserId" = ''`,
    `UPDATE "Integration" i SET "externalUserId" = NULL FROM (SELECT id, first_value(id) OVER (PARTITION BY provider, "externalUserId" ORDER BY "updatedAt" DESC, id) AS keep FROM "Integration" WHERE "externalUserId" IS NOT NULL) k WHERE i.id = k.id AND k.id <> k.keep`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "Integration_provider_externalUserId_key" ON "Integration"("provider", "externalUserId")`,
  ]);
} finally {
  await db.$disconnect();
}
