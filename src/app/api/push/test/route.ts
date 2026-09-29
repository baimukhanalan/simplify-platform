import { currentUserId } from "@/lib/auth";
import { rateLimitUser } from "@/lib/rate-limit";
import { sameOrigin, testPush } from "../_handlers";

const noStore = { "Cache-Control": "no-store" };

/** «Проверить связь»: sends one push to the calling device. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return Response.json({ error: "forbidden" }, { status: 403, headers: noStore });
  const userId = await currentUserId();
  if (userId && !(await rateLimitUser("push-test", userId, 5, 60_000)).ok) return Response.json({ error: "rate_limited" }, { status: 429, headers: noStore });
  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {}
  const r = await testPush(userId, raw);
  return Response.json(r.body, { status: r.status, headers: noStore });
}
