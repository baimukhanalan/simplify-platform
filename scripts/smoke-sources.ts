// One live smoke run of the public job sources, printing counts only.
// Run against a SCRATCH copy of the database — never the real prisma/dev.db:
//   cp prisma/dev.db /tmp/smoke.db && DATABASE_URL=file:/tmp/smoke.db npx tsx --conditions=react-server scripts/smoke-sources.ts
import path from "node:path";

const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:") || path.resolve(url.slice(5)) === path.resolve("prisma/dev.db")) {
  console.error("Refusing to run: point DATABASE_URL at a scratch copy (file:/tmp/…), not prisma/dev.db.");
  process.exit(1);
}
// 1–2 boards per ATS; the env overrides bypass the rotation.
process.env.SIMPLIFY_ASHBY_BOARDS ??= "salmon-group";
process.env.SIMPLIFY_GREENHOUSE_BOARDS ??= "gitlab";
process.env.SIMPLIFY_LEVER_COMPANIES ??= "palantir";
process.env.SIMPLIFY_WORKABLE_ACCOUNTS ??= "zyte";
process.env.SIMPLIFY_HIMALAYAS_PAGES ??= "3";

async function main() {
  const { ingestLive } = await import("../src/lib/engine/ingest");
  const { db } = await import("../src/lib/db");
  const only = (process.argv[2] ?? "ashby,greenhouse,lever,workable,jobicy,himalayas,remotive,arbeitnow").split(",");
  const t0 = Date.now();
  const report = await ingestLive("", { only, budgetMs: 120_000 });
  console.log(`source       fetched  kzOpen  added  retired  boards  errors   (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const [name, r] of Object.entries(report)) {
    console.log(`${name.padEnd(12)} ${String(r.fetched).padStart(7)} ${String(r.kzOpen).padStart(7)} ${String(r.added).padStart(6)} ${String(r.retired).padStart(8)}  ${(r.boards ?? "-").padStart(6)}  ${r.errors.length}${r.errors.length ? ` (${r.errors[0].slice(0, 80)})` : ""}`);
  }
  const kzRows = await db.job.count({ where: { source: { in: only }, active: true, countries: { contains: "\"KZ\"" } } });
  console.log(`active rows with KZ in countries (these sources): ${kzRows}`);
  await db.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
