import { db } from "@/lib/db";
import { runTick } from "@/lib/engine/agent";

/** Scheduler entrypoint (Vercel Cron / external). Runs one agent cycle for every active campaign. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const campaigns = await db.campaign.findMany({ where: { status: "active" }, select: { id: true } });
  const results: Record<string, unknown> = {};
  for (const c of campaigns) {
    try { results[c.id] = await runTick(c.id); } catch (e) { results[c.id] = { error: e instanceof Error ? e.message : String(e) }; }
  }
  return Response.json({ ran: campaigns.length, results });
}
