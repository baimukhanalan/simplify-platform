// Production error monitoring: captureError() normalizes, scrubs, fingerprints and stores errors in ErrorLog (grouped by
// fingerprint: count++ / lastSeenAt, a resolved error that recurs re-opens), optionally forwarding to Sentry (SENTRY_DSN).
//
// Guarantees: never throws; awaits at most `timeoutMs` (the write continues in the background), so it is safe inside
// catch blocks, route handlers and serverless functions. Error storms are throttled per fingerprint: at most one DB write
// per `throttleMs` — occurrences in between are counted in memory and added by the next write (flushMonitoring() forces it).
import { db as prisma } from "../db";
import { fingerprintOf } from "./fingerprint";
import { normalizeRoute, scrub, scrubValue } from "./scrub";
import { sendToSentry } from "./sentry";

export type ErrorSource = "server" | "client" | "cron" | "action";
export type CaptureContext = {
  source?: ErrorSource;
  level?: "error" | "warning";
  route?: string | null;
  digest?: string | null;
  userId?: string | null;
  meta?: Record<string, unknown>;
  /** Max time the caller waits (default 1500 ms). */
  timeoutMs?: number;
};

type Record_ = {
  fingerprint: string; type: string; message: string; stack: string; route: string; digest: string;
  level: "error" | "warning"; source: ErrorSource; userId: string | null; meta: Record<string, unknown>;
};
type Slot = { lastWrite: number; lastSentry: number; pending: number; users: Set<string>; latest: Record_; flushing: Promise<void> | null; timer: ReturnType<typeof setTimeout> | null };

/** The subset of the Prisma client monitoring uses (swappable in tests). */
type Store = { errorLog: Pick<typeof prisma.errorLog, "findUnique" | "create" | "update"> };

const cfg = {
  throttleMs: Number(process.env.MONITORING_THROTTLE_MS) || 5000,
  timeoutMs: 1500,
  sentryEveryMs: 60_000,
  /** Global cap on DB writes per instance per minute (many distinct errors at once). */
  writesPerMinute: 120,
  store: null as Store | null,
};
export function configureMonitoring(p: Partial<typeof cfg>) {
  Object.assign(cfg, p);
}
const store = (): Store => cfg.store ?? prisma;

const slots = new Map<string, Slot>();
let windowStart = 0, windowWrites = 0;

const MAX_MESSAGE = 1000, MAX_STACK = 8000;

/** Next.js control flow (redirect(), notFound(), dynamic bailouts) — not errors. */
function isControlFlow(err: unknown): boolean {
  const d = typeof err === "object" && err && "digest" in err ? String((err as { digest: unknown }).digest) : "";
  const m = err instanceof Error ? err.message : "";
  return /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(d) || m === "NEXT_REDIRECT" || m === "NEXT_NOT_FOUND";
}

export function normalizeError(err: unknown): { type: string; message: string; stack: string; cause?: string } {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? `${err.cause.name}: ${err.cause.message}` : err.cause != null ? String(err.cause) : undefined;
    return { type: err.name || "Error", message: err.message || err.name || "Error", stack: err.stack ?? "", cause };
  }
  if (typeof err === "string") return { type: "Error", message: err, stack: "" };
  if (err && typeof err === "object") {
    const o = err as { name?: unknown; message?: unknown; stack?: unknown };
    let message = typeof o.message === "string" ? o.message : "";
    if (!message) try { message = JSON.stringify(err).slice(0, MAX_MESSAGE); } catch { message = Object.prototype.toString.call(err); }
    return { type: typeof o.name === "string" ? o.name : "Error", message, stack: typeof o.stack === "string" ? o.stack : "" };
  }
  return { type: "Error", message: String(err), stack: "" };
}

function withTimeout(p: Promise<unknown>, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<void>((r) => { t = setTimeout(r, ms); })]).finally(() => clearTimeout(t));
}

/** Record an error. Never throws; resolves within ctx.timeoutMs (default 1.5 s). */
export async function captureError(err: unknown, ctx: CaptureContext = {}): Promise<void> {
  try {
    if (isControlFlow(err)) return;
    const n = normalizeError(err);
    const source: ErrorSource = ctx.source ?? "server";
    const route = normalizeRoute(ctx.route);
    const message = scrub(n.message.slice(0, MAX_MESSAGE * 2)).slice(0, MAX_MESSAGE) || "Error";
    const stack = scrub(n.stack.slice(0, MAX_STACK * 2)).slice(0, MAX_STACK);
    const fingerprint = fingerprintOf({ message, stack, route, source });
    const meta = scrubValue({ ...(ctx.meta ?? {}), ...(n.cause ? { cause: n.cause } : {}) }) as Record<string, unknown>;
    const rec: Record_ = {
      fingerprint, type: scrub(n.type).slice(0, 80), message, stack, route, digest: scrub(String(ctx.digest ?? "")).slice(0, 100),
      level: ctx.level ?? "error", source, userId: ctx.userId ?? null, meta,
    };
    let slot = slots.get(fingerprint);
    if (!slot) {
      if (slots.size > 500) prune();
      slot = { lastWrite: 0, lastSentry: 0, pending: 0, users: new Set(), latest: rec, flushing: null, timer: null };
      slots.set(fingerprint, slot);
    }
    slot.pending++;
    slot.latest = rec;
    if (rec.userId && slot.users.size < 100) slot.users.add(rec.userId);
    const now = Date.now();
    if (slot.flushing || now - slot.lastWrite < cfg.throttleMs || !takeWriteBudget(now)) {
      schedule(fingerprint, slot);
      return;
    }
    await withTimeout(flush(fingerprint, slot), ctx.timeoutMs ?? cfg.timeoutMs);
  } catch {
    /* monitoring must never break the caller */
  }
}

function takeWriteBudget(now: number) {
  if (now - windowStart > 60_000) { windowStart = now; windowWrites = 0; }
  if (windowWrites >= cfg.writesPerMinute) return false;
  windowWrites++;
  return true;
}

function schedule(fp: string, slot: Slot) {
  if (slot.timer) return;
  const delay = Math.max(50, slot.lastWrite + cfg.throttleMs - Date.now());
  slot.timer = setTimeout(() => {
    slot.timer = null;
    if (slot.pending === 0) return;
    if (slot.flushing) return schedule(fp, slot);
    if (!takeWriteBudget(Date.now())) return schedule(fp, slot);
    void flush(fp, slot);
  }, delay);
  (slot.timer as { unref?: () => void }).unref?.();
}

function flush(fp: string, slot: Slot): Promise<void> {
  const inc = slot.pending;
  const users = [...slot.users];
  const rec = slot.latest;
  slot.pending = 0;
  slot.users.clear();
  slot.lastWrite = Date.now();
  const sentry = process.env.SENTRY_DSN && Date.now() - slot.lastSentry >= cfg.sentryEveryMs;
  if (sentry) slot.lastSentry = Date.now();
  const run = (async () => {
    const [dbRes] = await Promise.allSettled([
      write(rec, inc, users),
      sentry ? sendToSentry({ ...rec, extra: { ...rec.meta, occurrences: inc } }) : Promise.resolve(false),
    ]);
    if (dbRes.status === "rejected") {
      // DB unavailable: keep the occurrences for the next attempt (bounded), don't retry in a tight loop.
      slot.pending = Math.min(slot.pending + inc, 1_000_000);
      for (const u of users) if (slot.users.size < 100) slot.users.add(u);
    }
  })().finally(() => {
    slot.flushing = null;
    if (slot.pending > 0) schedule(fp, slot);
  });
  slot.flushing = run;
  return run;
}

function prune() {
  const now = Date.now();
  for (const [k, s] of slots) if (!s.pending && !s.flushing && !s.timer && now - s.lastWrite > cfg.throttleMs) slots.delete(k);
}

const hourKey = (d: Date) => d.toISOString().slice(0, 13);

type StoredMeta = { extra?: Record<string, unknown>; users?: string[]; hours?: Record<string, number>; reopenedAt?: string; type?: string };

function mergeMeta(prev: StoredMeta, rec: Record_, inc: number, users: string[], now: Date, reopened: boolean): string {
  const hours: Record<string, number> = {};
  const cutoff = hourKey(new Date(now.getTime() - 24 * 3600_000));
  for (const [k, v] of Object.entries(prev.hours ?? {})) if (k > cutoff && typeof v === "number") hours[k] = v;
  const hk = hourKey(now);
  hours[hk] = (hours[hk] ?? 0) + inc;
  const allUsers = [...new Set([...(prev.users ?? []), ...users])].slice(0, 200);
  const out: StoredMeta = { type: rec.type, extra: rec.meta, users: allUsers, hours, ...(reopened ? { reopenedAt: now.toISOString() } : prev.reopenedAt ? { reopenedAt: prev.reopenedAt } : {}) };
  return JSON.stringify(out);
}

const parseMeta = (s: string | null | undefined): StoredMeta => {
  try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};

async function write(rec: Record_, inc: number, users: string[]) {
  const s = store();
  const now = new Date();
  const update = async () => {
    const prev = await s.errorLog.findUnique({ where: { fingerprint: rec.fingerprint }, select: { meta: true, resolvedAt: true } });
    await s.errorLog.update({
      where: { fingerprint: rec.fingerprint },
      data: {
        count: { increment: inc }, lastSeenAt: now, resolvedAt: null, level: rec.level, message: rec.message, stack: rec.stack, route: rec.route,
        ...(rec.digest ? { digest: rec.digest } : {}), ...(rec.userId ? { userId: rec.userId } : {}),
        meta: mergeMeta(parseMeta(prev?.meta), rec, inc, users, now, Boolean(prev?.resolvedAt)),
      },
    });
  };
  const exists = await s.errorLog.findUnique({ where: { fingerprint: rec.fingerprint }, select: { id: true } });
  if (exists) return update();
  try {
    await s.errorLog.create({
      data: {
        fingerprint: rec.fingerprint, level: rec.level, source: rec.source, message: rec.message, stack: rec.stack, route: rec.route, digest: rec.digest,
        userId: rec.userId, count: inc, meta: mergeMeta({}, rec, inc, users, now, false), createdAt: now, lastSeenAt: now,
      },
    });
  } catch (e) {
    // Another instance created it first (unique fingerprint) — count onto that row.
    if ((e as { code?: string }).code === "P2002") return update();
    throw e;
  }
}

/** Write every throttled occurrence now (tests, end of a cron run). Never throws; bounded by `timeoutMs`. */
export async function flushMonitoring(timeoutMs = 5000): Promise<void> {
  try {
    const work: Promise<unknown>[] = [];
    for (const [fp, slot] of slots) {
      if (slot.timer) { clearTimeout(slot.timer); slot.timer = null; }
      if (slot.flushing) work.push(slot.flushing.then(() => (slot.pending ? flush(fp, slot) : undefined)));
      else if (slot.pending) work.push(flush(fp, slot));
    }
    await withTimeout(Promise.allSettled(work), timeoutMs);
  } catch { /* never throws */ }
}

/** Test helper: forget in-memory throttle state. */
export function resetMonitoringState() {
  for (const s of slots.values()) if (s.timer) clearTimeout(s.timer);
  slots.clear();
  windowStart = 0;
  windowWrites = 0;
}

/** onRequestError context → source. */
export const sourceOfRouteType = (t: string | undefined): ErrorSource => (t === "action" ? "action" : "server");

// ——— Retention ———

/** Resolved errors and client-sourced rows not seen for this long are deleted. */
export const RETENTION_DAYS = 30;
let lastPrune = 0;

/**
 * Delete resolved rows resolved > RETENTION_DAYS ago and client rows last seen > RETENTION_DAYS ago. Idempotent (several
 * instances may run it); never throws. Returns the number of rows deleted.
 */
export async function pruneErrorLog(now = new Date()): Promise<number> {
  try {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400_000);
    const r = await prisma.errorLog.deleteMany({ where: { OR: [{ resolvedAt: { lt: cutoff } }, { source: "client", lastSeenAt: { lt: cutoff } }] } });
    return r.count;
  } catch {
    return 0;
  }
}

/** pruneErrorLog at most once a day per instance (the cron tick and, rarely, client captures call it). */
export async function maybePruneErrorLog(now = Date.now()): Promise<number> {
  if (now - lastPrune < 86400_000) return 0;
  lastPrune = now;
  return pruneErrorLog(new Date(now));
}
export const resetPruneClock = () => { lastPrune = 0; };
