// In-process engine driver for j20+ when the shared dev server has no CRON_SECRET / INBOUND_EMAIL_SECRET configured.
// Runs the same code the cron route / inbound webhook run, against the repo's dev DB.
//
//   npx tsx --conditions=react-server tests/e2e/engine-helper.ts tick <campaignId> [n]
//   npx tsx --conditions=react-server tests/e2e/engine-helper.ts cron            (all active campaigns + employers, like /api/cron/tick)
//   npx tsx --conditions=react-server tests/e2e/engine-helper.ts deliver <postmark.json>
// Prints one JSON line prefixed "RESULT ".
import path from "node:path";
import fs from "node:fs";

const APP = path.resolve(__dirname, "../..");
process.env.DATABASE_URL = `file:${APP}/prisma/dev.db`;
process.env.SIMPLIFY_MODE = process.env.SIMPLIFY_MODE ?? "simulation";
process.env.SIMPLIFY_LIVE_INGEST = "0";
delete process.env.ANTHROPIC_API_KEY;

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "tick") {
    const { runTick } = await import("../../src/lib/engine/agent");
    const { simulateAllEmployers } = await import("../../src/lib/engine/simulation");
    const { db } = await import("../../src/lib/db");
    const out = [];
    for (let i = 0; i < Number(b ?? 1); i++) {
      out.push(await runTick(a));
      const c = await db.campaign.findUniqueOrThrow({ where: { id: a } });
      out.push(await simulateAllEmployers([c.userId]));
    }
    return out;
  }
  if (cmd === "cron") {
    const { runTick } = await import("../../src/lib/engine/agent");
    const { simulateAllEmployers } = await import("../../src/lib/engine/simulation");
    const { db } = await import("../../src/lib/db");
    const cs = await db.campaign.findMany({ where: { status: "active", user: { email: { startsWith: "e2e-test-" } } }, select: { id: true, userId: true } });
    let ran = 0, failed = 0;
    for (const c of cs) { try { await runTick(c.id); ran++; } catch (e) { failed++; console.error(e); } }
    return { ran, failed, employers: await simulateAllEmployers(cs.map((c) => c.userId)) };
  }
  if (cmd === "deliver") {
    const { parseInbound } = await import("../../src/lib/inbound/parse");
    const { deliverLetter } = await import("../../src/lib/inbound/service");
    const letter = parseInbound(JSON.parse(fs.readFileSync(a, "utf8")));
    if (!letter) return { error: "unparsed" };
    return deliverLetter(letter);
  }
  throw new Error("unknown command " + cmd);
}

main().then((r) => { console.log("RESULT " + JSON.stringify(r)); process.exit(0); }, (e) => { console.error(e); console.log("RESULT " + JSON.stringify({ error: String(e?.stack ?? e).slice(0, 1500) })); process.exit(1); });
