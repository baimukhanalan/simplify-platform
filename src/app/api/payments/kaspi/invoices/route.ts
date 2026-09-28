import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { createInvoice, view } from "@/lib/payments/kaspi";
import { rateLimit } from "@/lib/rate-limit";

/** POST { plan: "local" | "international", partner?: string } → invoice (Kaspi Pay mock). */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await rateLimit(`kaspi-invoice:${userId}`, 20, 60 * 60 * 1000)).ok) return Response.json({ error: "too many invoices" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { plan?: string; partner?: string };
  if (body.plan !== "local" && body.plan !== "international") return Response.json({ error: "plan must be local or international" }, { status: 400 });
  if (await db.campaign.findFirst({ where: { userId, status: { in: ["active", "paused"] } }, select: { id: true } })) return Response.json({ error: "campaign already active" }, { status: 409 });
  const goal = await db.goal.findUnique({ where: { userId }, select: { primaryRole: true } });
  if (!goal?.primaryRole) return Response.json({ error: "set a career goal first" }, { status: 409 });
  const p = await createInvoice(userId, body.plan, body.partner);
  return Response.json(view(p), { status: 201 });
}
