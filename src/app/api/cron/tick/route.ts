import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";

/** Scheduler entrypoint (Vercel Cron / external). Runs one agent cycle for every active campaign. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (!secret || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("unauthorized", { status: 401 });
  const campaigns = await db.campaign.findMany({ where: { status: "active" }, select: { id: true } });
  let failed = 0;
  for (const c of campaigns) {
    try { await runTick(c.id); } catch (e) { failed++; console.error("[cron] tick failed", c.id, e); }
  }
  return Response.json({ ran: campaigns.length, failed });
}
