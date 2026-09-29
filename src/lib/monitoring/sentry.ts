import { randomBytes } from "node:crypto";

// Minimal Sentry forwarder over the HTTP envelope API — no SDK. Active only when SENTRY_DSN is set.
// https://develop.sentry.dev/sdk/data-model/envelopes/

export type SentryDsn = { publicKey: string; host: string; protocol: string; pathPrefix: string; projectId: string; raw: string };

/** `https://<key>@<host>[/<path>]/<projectId>` → parts; null when malformed. */
export function parseDsn(dsn: string | undefined | null): SentryDsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    if (!/^https?:$/.test(u.protocol) || !u.username) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const projectId = parts.pop();
    if (!projectId || !/^\d+$/.test(projectId)) return null;
    return { publicKey: decodeURIComponent(u.username), host: u.host, protocol: u.protocol.replace(":", ""), pathPrefix: parts.length ? `/${parts.join("/")}` : "", projectId, raw: dsn.trim() };
  } catch {
    return null;
  }
}

export const envelopeUrl = (d: SentryDsn) => `${d.protocol}://${d.host}${d.pathPrefix}/api/${d.projectId}/envelope/?sentry_key=${encodeURIComponent(d.publicKey)}&sentry_version=7`;

export type SentryInput = {
  message: string;
  type: string;
  stack: string;
  level: "error" | "warning";
  source: string;
  route: string;
  digest: string;
  userId: string | null;
  fingerprint: string;
  extra: Record<string, unknown>;
};

/** Stack text → Sentry frames (oldest first, as Sentry expects). */
export function framesOf(stack: string) {
  const frames: { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean }[] = [];
  for (const raw of stack.split("\n").slice(1, 50)) {
    const line = raw.trim();
    const m = line.match(/^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?)(?::(\d+))?(?::(\d+))?\)?$/);
    if (!m) continue;
    frames.push({ function: m[1] || undefined, filename: m[2], lineno: m[3] ? Number(m[3]) : undefined, colno: m[4] ? Number(m[4]) : undefined, in_app: !/node_modules|node:|next\/dist/.test(m[2]) });
  }
  return frames.reverse();
}

export function buildEnvelope(dsn: SentryDsn, e: SentryInput, now = new Date()) {
  const eventId = randomBytes(16).toString("hex");
  const frames = framesOf(e.stack);
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: e.level,
    logger: `simplify.${e.source}`,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.VERCEL_ENV || process.env.NODE_ENV || "production",
    ...(process.env.VERCEL_GIT_COMMIT_SHA ? { release: process.env.VERCEL_GIT_COMMIT_SHA } : {}),
    transaction: e.route || undefined,
    fingerprint: [e.fingerprint],
    tags: { source: e.source, ...(e.route ? { route: e.route } : {}), ...(e.digest ? { digest: e.digest } : {}) },
    ...(e.userId ? { user: { id: e.userId } } : {}),
    exception: { values: [{ type: e.type || "Error", value: e.message, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    extra: e.extra,
  };
  const header = { event_id: eventId, sent_at: now.toISOString(), dsn: dsn.raw };
  const payload = JSON.stringify(event);
  const body = `${JSON.stringify(header)}\n${JSON.stringify({ type: "event", content_type: "application/json", length: Buffer.byteLength(payload) })}\n${payload}\n`;
  return { eventId, body, url: envelopeUrl(dsn) };
}

/** POST one event; 2 s timeout; never throws. Returns whether Sentry accepted it. */
export async function sendToSentry(e: SentryInput, dsnString = process.env.SENTRY_DSN): Promise<boolean> {
  const dsn = parseDsn(dsnString);
  if (!dsn) return false;
  try {
    const { body, url } = buildEnvelope(dsn, e);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=simplify-monitor/1.0` },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    await res.body?.cancel().catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}
