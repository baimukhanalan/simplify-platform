import { currentUserId } from "@/lib/auth";
import { rateLimitUser } from "@/lib/rate-limit";
import { sameOrigin, subscribe, unsubscribe } from "../_handlers";

const noStore = { "Cache-Control": "no-store" };

async function body(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Register this browser for Web Push (upsert by endpoint). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  const userId = await currentUserId();
  if (userId && !(await rateLimitUser("push-sub", userId, 30, 60_000)).ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  const r = await subscribe(userId, await body(req), req.headers.get("user-agent") ?? "");
  return Response.json(r.body, { status: r.status, headers: noStore });
}

/** Forget this browser's subscription (only the caller's own). */
export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  const userId = await currentUserId();
  if (userId && !(await rateLimitUser("push-sub", userId, 30, 60_000)).ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  const r = await unsubscribe(userId, await body(req));
  return Response.json(r.body, { status: r.status, headers: noStore });
}
