#!/usr/bin/env node
// Functional end-to-end journeys for Simplify (server actions driven over HTTP like a browser).
//
//   E2E_APP_DIR=/abs/path/to/ISOLATED/copy BASE=http://localhost:3300 node tests/e2e/run.mjs [j1 j2 …]
//
// The copy must have its own .env (absolute DATABASE_URL to its own SQLite DB, SESSION_SECRET,
// KASPI_MODE="mock", APP_URL, KASPI_WEBHOOK_SECRET, KASPI_MOCK_SECRET), be seeded (`npm run seed`) and built
// (`next build`), and be served by `TRUST_PROXY=1 next start -p 3300` from that copy. TRUST_PROXY=1 is required since round 8:
// the per-IP limiters (signup, login, CV parse) ignore X-Forwarded-For otherwise, and every journey's signup would share one
// "local" bucket (→ «Слишком много регистраций»). Run tests/stress.mjs against a server WITHOUT it (it checks XFF can't bypass). The journeys read the copy's
// .next/server/server-reference-manifest.json to find action IDs and use its Prisma client for assertions,
// so they WRITE to that DB — never point E2E_APP_DIR at the real repo (guarded: refuses a dir with .git).
//
// Modes (src/lib/mode.ts): run the suite twice — once against a server started with SIMPLIFY_MODE=simulation (seed that
// copy with SIMPLIFY_MODE=simulation too) and once against one started without it (live, the default). The mode is
// probed once here (lib.mjs → MODE) and passed to every journey as E2E_MODE. A journey that needs one mode calls
// needsMode(…) and is reported as skipped under the other; the rest run in both and assert the mode's own behaviour.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
// jlive: run explicitly against a server started without KASPI_MODE (see jlive.mjs)
const ALL = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j7b", "j8", "j9", "j10", "j11", "j12", "j13", "j14", "j15", "j16", "j17", "j18", "j19"];
const pick = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const { MODE, db } = await import("./lib.mjs");
await db.$disconnect();
console.log(`server mode: ${MODE}\n`);
const fails = [];
const skipped = [];
for (const j of pick) {
  const r = spawnSync(process.execPath, [join(here, `${j}.mjs`)], { encoding: "utf8", env: { ...process.env, E2E_MODE: MODE }, timeout: 15 * 60 * 1000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const skip = out.split("\n").find((l) => l.startsWith("SKIP "));
  if (skip && r.status === 0) { console.log(`– ${j} (skipped: ${skip.slice(5)})`); skipped.push(j); continue; }
  const lines = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const crashed = r.status !== 0 && !lines.length && !/\n0 failures/.test(out);
  console.log(`${lines.length || crashed ? "✗" : "✓"} ${j}${crashed ? " (crashed)" : ""}`);
  for (const l of lines) console.log("   " + l.slice(0, 400));
  if (crashed) console.log("   " + out.trim().split("\n").slice(-6).join("\n   "));
  fails.push(...lines, ...(crashed ? [`${j} crashed`] : []));
}
console.log(`\n${fails.length} failing checks${skipped.length ? ` · skipped in ${MODE} mode: ${skipped.join(" ")}` : ""}`);
process.exit(fails.length ? 1 : 0);
