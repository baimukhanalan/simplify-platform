import { currentUserId } from "@/lib/auth";
import { unreadPushes } from "@/lib/ops-data";

/** Unread push moments for the signed-in user (polled by the in-app notifier to fire system notifications). */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const path = new URL(req.url).searchParams.get("path");
  const { items, hidden } = await unreadPushes(userId, { currentPath: path });
  return Response.json({ items, hidden }, { headers: { "Cache-Control": "no-store" } });
}
