import { timingSafeEqual } from "node:crypto";
import { seedDemo } from "@/lib/demo-seed";

export const maxDuration = 300;

/** One-off production demo seeding. Disabled unless SEED_TOKEN (≥32 chars) is configured; never creates staff accounts. */
export async function POST(req: Request) {
  const token = process.env.SEED_TOKEN;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${token}`;
  if (!token || token.length < 32 || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return new Response("not found", { status: 404 });
  const t0 = Date.now();
  await seedDemo({ staff: false });
  return Response.json({ ok: true, ms: Date.now() - t0 });
}
