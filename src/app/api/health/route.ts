import { db } from "@/lib/db";

// Uptime check: DB ping (bounded) + deployed commit. No secrets, no mode, no user data.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 2500;

async function pingDb(): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      db.$queryRaw`SELECT 1`.then(() => true),
      new Promise<boolean>((r) => { t = setTimeout(() => r(false), DB_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const started = Date.now();
  const ok = await pingDb();
  const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 40) || "dev";
  return Response.json(
    { ok, db: ok ? "ok" : "down", version, latencyMs: Date.now() - started, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

export async function HEAD() {
  const ok = await pingDb();
  return new Response(null, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
