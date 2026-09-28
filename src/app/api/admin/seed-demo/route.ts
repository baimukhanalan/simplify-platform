import { timingSafeEqual } from "node:crypto";
import { seedDemo } from "@/lib/demo-seed";

/** Constant-time bearer check on bytes (length compared in bytes, so non-ASCII input can't make timingSafeEqual throw). */
function bearerOk(header: string | null, secret: string) {
  const got = Buffer.from(header ?? "", "utf8");
  const want = Buffer.from(`Bearer ${secret}`, "utf8");
  return got.byteLength === want.byteLength && timingSafeEqual(got, want);
}

export const maxDuration = 300;

/** One-off production demo seeding. Disabled unless SEED_TOKEN (≥32 chars) is configured; never creates staff accounts. */
export async function POST(req: Request) {
  const token = process.env.SEED_TOKEN;
  if (!token || token.length < 32 || !bearerOk(req.headers.get("authorization"), token)) return new Response("not found", { status: 404 });
  const t0 = Date.now();
  await seedDemo({ staff: false });
  return Response.json({ ok: true, ms: Date.now() - t0 });
}
