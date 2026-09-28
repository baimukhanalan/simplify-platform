import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";

/** Constant-time bearer check on bytes (length compared in bytes, so non-ASCII input can't make timingSafeEqual throw). */
function bearerOk(header: string | null, secret: string) {
  const got = Buffer.from(header ?? "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.byteLength === want.byteLength && timingSafeEqual(got, want);
}

/**
 * Scheduler entrypoint (Vercel Cron / external). Runs one agent cycle for every active campaign. Paused campaigns are
 * visited too, but only so a campaign paused past its endsAt expires (and closes its questions): runTick does nothing
 * else for a paused campaign.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerOk(req.headers.get("authorization"), secret)) return new Response("unauthorized", { status: 401 });
  const now = new Date();
  const campaigns = await db.campaign.findMany({
    where: { OR: [{ status: "active" }, { status: "paused", endsAt: { lte: now } }] },
    select: { id: true },
  });
  let failed = 0, ran = 0, expired = 0;
  for (const c of campaigns) {
    try {
      const r = await runTick(c.id);
      if ("skipped" in r) { if (r.skipped === "expired") expired++; } else ran++;
    } catch (e) { failed++; console.error("[cron] tick failed", c.id, e); }
  }
  return Response.json({ ran, expired, failed });
}
