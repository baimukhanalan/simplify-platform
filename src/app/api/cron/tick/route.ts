import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";

/** Constant-time bearer check on bytes (length compared in bytes, so non-ASCII input can't make timingSafeEqual throw). */
function bearerOk(header: string | null, secret: string) {
  const got = Buffer.from(header ?? "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.byteLength === want.byteLength && timingSafeEqual(got, want);
}

/** Scheduler entrypoint (Vercel Cron / external). Runs one agent cycle for every active campaign. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerOk(req.headers.get("authorization"), secret)) return new Response("unauthorized", { status: 401 });
  const campaigns = await db.campaign.findMany({ where: { status: "active" }, select: { id: true } });
  let failed = 0;
  for (const c of campaigns) {
    try { await runTick(c.id); } catch (e) { failed++; console.error("[cron] tick failed", c.id, e); }
  }
  return Response.json({ ran: campaigns.length, failed });
}
