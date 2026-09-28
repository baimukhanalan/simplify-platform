import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";

/** Unread push moments for the signed-in user (polled by the in-app notifier to fire system notifications). */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const items = await db.notification.findMany({
    where: { userId, readAt: null },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, type: true, title: true, body: true, createdAt: true },
  });
  return Response.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
