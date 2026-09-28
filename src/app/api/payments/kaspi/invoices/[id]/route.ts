import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { view } from "@/lib/payments/kaspi";

/** GET invoice status (owner only). Clients poll this after paying. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const p = await db.payment.findFirst({ where: { externalId: id, userId } });
  if (!p) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(view(p));
}
