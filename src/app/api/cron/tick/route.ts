import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";
import { ingestLive } from "@/lib/engine/ingest";
import { hhEnabled } from "@/lib/hh/client";
import { syncHhNegotiations } from "@/lib/hh/sync";
import { simulateAllEmployers } from "@/lib/engine/simulation";

/** Constant-time bearer check on bytes (length compared in bytes, so non-ASCII input can't make timingSafeEqual throw). */
function bearerOk(header: string | null, secret: string) {
  const got = Buffer.from(header ?? "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.byteLength === want.byteLength && timingSafeEqual(got, want);
}

export const maxDuration = 300;

/** Stop starting new cycles after this long; the rest (the least recently run go first) get the next invocation. */
const TIME_BUDGET_MS = 240_000;
/** Live vacancy ingest runs first, within this slice of the budget (SIMPLIFY_LIVE_INGEST=0 turns it off). */
const INGEST_BUDGET_MS = Number(process.env.SIMPLIFY_INGEST_BUDGET_MS) || 90_000;
/** Employer replies of the internal corpus (simulation mode) are played after the cycles, until this point. */
const SIM_DEADLINE_MS = 265_000;
/** hh.kz status sync runs after the cycles, until this point (maxDuration is 300 s). */
const HH_SYNC_DEADLINE_MS = 280_000;

/**
 * Scheduler entrypoint (Vercel Cron / external). Runs one agent cycle per active campaign, least recently run first
 * (never-run campaigns first of all), until the time budget is spent — so a growing number of campaigns rotates through
 * successive invocations instead of the tail never running. Paused campaigns are visited too, but only so a campaign
 * paused past its endsAt expires (and closes its questions): runTick does nothing else for a paused campaign.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerOk(req.headers.get("authorization"), secret)) return new Response("unauthorized", { status: 401 });
  const started = Date.now();
  const now = new Date(started);
  // Fresh vacancies first, so this run's cycles already see them (src/lib/sources/**, rotated ATS boards).
  let ingest: Record<string, { added: number; errors: number }> | undefined;
  if (process.env.SIMPLIFY_LIVE_INGEST !== "0") {
    try {
      const rep = await ingestLive("", { budgetMs: INGEST_BUDGET_MS });
      ingest = Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, { added: v.added, errors: v.errors.length }]));
    } catch (e) { console.error("[cron] ingest failed", e); }
  }
  const campaigns = await db.campaign.findMany({
    where: { OR: [{ status: "active" }, { status: "paused", endsAt: { lte: now } }] },
    // NULLs sort differently on SQLite (first) and Postgres (last) unless asked explicitly.
    orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, userId: true, status: true },
  });
  let failed = 0, ran = 0, expired = 0, deferred = 0;
  for (const [i, c] of campaigns.entries()) {
    if (Date.now() - started > TIME_BUDGET_MS) { deferred = campaigns.length - i; break; }
    try {
      const r = await runTick(c.id);
      if ("skipped" in r) { if (r.skipped === "expired") expired++; } else ran++;
    } catch (e) { failed++; console.error("[cron] tick failed", c.id, e); }
  }
  // Simulation mode (src/lib/mode.ts): fictional employers answer applications that are due (no-op in live mode).
  let employers: { users: number; steps: number } | undefined;
  try {
    employers = await simulateAllEmployers(campaigns.filter((c) => c.status === "active").map((c) => c.userId), started + SIM_DEADLINE_MS);
  } catch (e) { console.error("[cron] employer simulation failed", e); }
  // hh.kz: pull negotiation states for connected users (only when the integration is configured on the server).
  let hh: { synced: number; failed: number; deferred: number } | undefined;
  if (hhEnabled()) {
    const users = await db.integration.findMany({ where: { provider: "hh", accessToken: { not: "" } }, orderBy: { updatedAt: "asc" }, select: { userId: true } });
    hh = { synced: 0, failed: 0, deferred: 0 };
    for (const [i, u] of users.entries()) {
      if (Date.now() - started > HH_SYNC_DEADLINE_MS) { hh.deferred = users.length - i; break; }
      try { await syncHhNegotiations(u.userId); hh.synced++; } catch (e) { hh.failed++; console.error("[cron] hh sync failed", u.userId, e); }
    }
  }
  return Response.json({ ran, expired, failed, deferred, ...(employers?.steps ? { employers } : {}), ...(hh ? { hh } : {}), ...(ingest ? { ingest } : {}) });
}
