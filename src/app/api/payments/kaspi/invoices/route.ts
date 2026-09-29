import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { InvoiceRefused, createInvoice, runningCampaign, view } from "@/lib/payments/kaspi";
import { rateLimitUser } from "@/lib/rate-limit";

/** POST { plan: "local" | "international" } → invoice. Partner attribution comes from the account (referredByCode) only. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  // Coarse request cap (the stricter cap below counts only invoices actually created).
  if (!(await rateLimitUser("kaspi-invoice-req", userId, 120, 60 * 60 * 1000)).ok) return Response.json({ error: "too many invoices" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { plan?: string };
  if (body.plan !== "local" && body.plan !== "international") return Response.json({ error: "plan must be local or international" }, { status: 400 });
  if (await runningCampaign(userId)) return Response.json({ error: "campaign already active" }, { status: 409 });
  const goal = await db.goal.findUnique({ where: { userId }, select: { primaryRole: true } });
  if (!goal?.primaryRole) return Response.json({ error: "set a career goal first" }, { status: 409 });
  // The rate limit counts invoices actually created: a burst of clicks that reuses the open invoice never trips it.
  const p = await createInvoice(userId, body.plan, { beforeCreate: async () => (await rateLimitUser("kaspi-invoice", userId, 20, 60 * 60 * 1000)).ok }).catch((e) => {
    if (e instanceof InvoiceRefused) return null;
    throw e;
  });
  if (!p) return Response.json({ error: "too many invoices" }, { status: 429 });
  return Response.json(view(p), { status: 201 });
}
