import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { createInvoice, runningCampaign, view } from "@/lib/payments/kaspi";
import { rateLimitUser } from "@/lib/rate-limit";

/** POST { plan: "local" | "international" } → invoice. Partner attribution comes from the account (referredByCode) only. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimitUser("kaspi-invoice", userId, 20, 60 * 60 * 1000)).ok) return Response.json({ error: "too many invoices" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { plan?: string };
  if (body.plan !== "local" && body.plan !== "international") return Response.json({ error: "plan must be local or international" }, { status: 400 });
  if (await runningCampaign(userId)) return Response.json({ error: "campaign already active" }, { status: 409 });
  const goal = await db.goal.findUnique({ where: { userId }, select: { primaryRole: true } });
  if (!goal?.primaryRole) return Response.json({ error: "set a career goal first" }, { status: 409 });
  const p = await createInvoice(userId, body.plan);
  return Response.json(view(p), { status: 201 });
}
