import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";
import { ingestLive } from "@/lib/engine/ingest";
import { hhEnabled } from "@/lib/hh/client";
import { isSimulation } from "@/lib/mode";
import { syncHhNegotiations } from "@/lib/hh/sync";
import { simulateAllEmployers } from "@/lib/engine/simulation";
import { captureError, flushMonitoring, maybePruneErrorLog } from "@/lib/monitoring";
import { deliverPending } from "@/lib/notify";

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
/** Within this much of TIME_BUDGET_MS a cycle's package preparation is capped (PREPARE_MS per package). */
const PREPARE_TAIL_MS = 90_000;
const PREPARE_MS = 15_000;
/** Catch-up sender (Telegram / Web Push notifications a request-time send didn't deliver): this slice, after the cycles. */
const NOTIFY_BUDGET_MS = 20_000;
/** Hard stop for anything that starts late in the run (maxDuration is 300 s; monitoring still flushes after it). */
const HARD_DEADLINE_MS = 285_000;

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
  try {
    return await tick(started);
  } finally {
    // Throttled occurrences of this run's errors are written before the function freezes — whatever happened above.
    await flushMonitoring(2000).catch(() => undefined);
  }
}

async function tick(started: number) {
  const now = new Date(started);
  // Fresh vacancies first, so this run's cycles already see them (src/lib/sources/**, rotated ATS boards).
  let ingest: Record<string, { added: number; errors: number }> | undefined;
  if (process.env.SIMPLIFY_LIVE_INGEST !== "0") {
    try {
      const rep = await ingestLive("", { budgetMs: INGEST_BUDGET_MS });
      ingest = Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, { added: v.added, errors: v.errors.length }]));
    } catch (e) { console.error("[cron] ingest failed", e); await captureError(e, { source: "cron", route: "/api/cron/tick", meta: { step: "ingest" } }); }
  }
  const campaigns = await db.campaign.findMany({
    where: { OR: [{ status: "active" }, { status: "paused", endsAt: { lte: now } }] },
    // NULLs sort differently on SQLite (first) and Postgres (last) unless asked explicitly.
    orderBy: [{ lastRunAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, userId: true, status: true },
  });
  let failed = 0, ran = 0, expired = 0, deferred = 0;
  for (const [i, c] of campaigns.entries()) {
    const left = TIME_BUDGET_MS - (Date.now() - started);
    if (left < 0) { deferred = campaigns.length - i; break; }
    try {
      // Near the end of the budget a cycle prepares only as many packages as fit (~15 s each with AI), so the whole run
      // stays inside maxDuration; the cron prepares the rest next time.
      const r = await runTick(c.id, left < PREPARE_TAIL_MS ? { maxPrepare: Math.max(1, Math.floor(left / PREPARE_MS)) } : {});
      if ("skipped" in r) { if (r.skipped === "expired") expired++; } else ran++;
    } catch (e) { failed++; console.error("[cron] tick failed", c.id, e); await captureError(e, { source: "cron", route: "/api/cron/tick", userId: c.userId, meta: { step: "tick", campaignId: c.id } }); }
  }
  // Notifications a request-time delivery missed (timeout, Bot API hiccup, frozen function): retried within a small slice
  // (after the cycles, so the notifications of this run's cycles that are still in flight are not raced twice).
  let notified: { telegram: number; push: number; left: number } | undefined;
  try {
    notified = await deliverPending({ deadline: Math.min(Date.now() + NOTIFY_BUDGET_MS, started + HARD_DEADLINE_MS) });
  } catch (e) { console.error("[cron] notification catch-up failed", e); await captureError(e, { source: "cron", route: "/api/cron/tick", meta: { step: "notify" } }); }
  // Simulation mode (src/lib/mode.ts): fictional employers answer applications that are due (no-op in live mode).
  let employers: { users: number; steps: number } | undefined;
  try {
    employers = await simulateAllEmployers(campaigns.filter((c) => c.status === "active").map((c) => c.userId), started + SIM_DEADLINE_MS);
  } catch (e) { console.error("[cron] employer simulation failed", e); await captureError(e, { source: "cron", route: "/api/cron/tick", meta: { step: "employers" } }); }
  // hh.kz: pull negotiation states for connected users (only when the integration is configured on the server).
  let hh: { synced: number; failed: number; deferred: number } | undefined;
  // Simulation mode: the fictional corpus only — no hh traffic from the cron.
  if (hhEnabled() && !isSimulation()) {
    const users = await db.integration.findMany({ where: { provider: "hh", accessToken: { not: "" } }, orderBy: { updatedAt: "asc" }, select: { userId: true } });
    hh = { synced: 0, failed: 0, deferred: 0 };
    for (const [i, u] of users.entries()) {
      if (Date.now() - started > HH_SYNC_DEADLINE_MS) { hh.deferred = users.length - i; break; }
      try { await syncHhNegotiations(u.userId, { deadline: started + HH_SYNC_DEADLINE_MS }); hh.synced++; } catch (e) { hh.failed++; console.error("[cron] hh sync failed", u.userId, e); await captureError(e, { source: "cron", route: "/api/cron/tick", userId: u.userId, meta: { step: "hh-sync" } }); }
    }
  }
  // ErrorLog retention (resolved > 30 days, client rows not seen for 30 days): at most once a day per instance.
  await maybePruneErrorLog();
  return Response.json({ ran, expired, failed, deferred, ...(employers?.steps ? { employers } : {}), ...(hh ? { hh } : {}), ...(ingest ? { ingest } : {}), ...(notified && (notified.telegram || notified.push || notified.left) ? { notified } : {}) });
}
