#!/usr/bin/env node
// Functional end-to-end journeys for Simplify (server actions driven over HTTP like a browser).
//
//   E2E_APP_DIR=/abs/path/to/ISOLATED/copy BASE=http://localhost:3300 node tests/e2e/run.mjs [j1 j2 …]
//
// The copy must have its own .env (absolute DATABASE_URL to its own SQLite DB, SESSION_SECRET,
// KASPI_MODE="mock", APP_URL, KASPI_WEBHOOK_SECRET, KASPI_MOCK_SECRET), be seeded (`npm run seed`) and built
// (`next build`), and be served by `next start -p 3300` from that copy. The journeys read the copy's
// .next/server/server-reference-manifest.json to find action IDs and use its Prisma client for assertions,
// so they WRITE to that DB — never point E2E_APP_DIR at the real repo (guarded: refuses a dir with .git).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const ALL = ["j1", "j2", "j3", "j4", "j5", "j6", "j7", "j7b", "j8", "j9", "j10", "j11", "j12", "j13"]; // jlive: run explicitly against a server started without KASPI_MODE (see jlive.mjs)
const pick = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const fails = [];
for (const j of pick) {
  const r = spawnSync(process.execPath, [join(here, `${j}.mjs`)], { encoding: "utf8", env: process.env, timeout: 15 * 60 * 1000 });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const lines = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const crashed = r.status !== 0 && !lines.length && !/\n0 failures/.test(out);
  console.log(`${lines.length || crashed ? "✗" : "✓"} ${j}${crashed ? " (crashed)" : ""}`);
  for (const l of lines) console.log("   " + l.slice(0, 400));
  if (crashed) console.log("   " + out.trim().split("\n").slice(-6).join("\n   "));
  fails.push(...lines, ...(crashed ? [`${j} crashed`] : []));
}
console.log(`\n${fails.length} failing checks`);
process.exit(fails.length ? 1 : 0);
