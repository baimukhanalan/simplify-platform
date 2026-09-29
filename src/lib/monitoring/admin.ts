import { db, insensitive } from "../db";

// Read side of ErrorLog for /admin/errors (callers authorize with requireAdmin).

export type ErrorTab = "open" | "resolved";
export type ErrorSort = "last" | "count";
export const PAGE_SIZE = 100;
const USERS_CAP = 200;

type StoredMeta = { type?: string; extra?: Record<string, unknown>; users?: string[]; hours?: Record<string, number>; reopenedAt?: string };
export function readMeta(raw: string): StoredMeta {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Occurrences per hour for the last 24 h (oldest first), from the hourly buckets captureError keeps in meta. */
export function hourlySeries(meta: StoredMeta, now = new Date()): number[] {
  const out: number[] = [];
  for (let i = 23; i >= 0; i--) out.push(meta.hours?.[new Date(now.getTime() - i * 3600_000).toISOString().slice(0, 13)] ?? 0);
  return out;
}

export function affectedUsers(meta: StoredMeta, userId: string | null) {
  const set = new Set(meta.users ?? []);
  if (userId) set.add(userId);
  return { n: set.size, capped: (meta.users?.length ?? 0) >= USERS_CAP };
}

export const parseTab = (v: unknown): ErrorTab => (v === "resolved" ? "resolved" : "open");
export const parseSort = (v: unknown): ErrorSort => (v === "count" ? "count" : "last");
export const parseQuery = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

export async function listErrors(opts: { tab: ErrorTab; sort: ErrorSort; q: string }, now = new Date()) {
  const search = opts.q
    ? { OR: [{ message: { contains: opts.q, ...insensitive } }, { route: { contains: opts.q, ...insensitive } }, { digest: opts.q }, { fingerprint: { startsWith: opts.q.toLowerCase() } }] }
    : {};
  const where = { ...(opts.tab === "open" ? { resolvedAt: null } : { resolvedAt: { not: null } }), ...search };
  const [rows, total, openCount, resolvedCount, last24] = await Promise.all([
    db.errorLog.findMany({
      where,
      orderBy: opts.sort === "count" ? [{ count: "desc" }, { lastSeenAt: "desc" }] : [{ lastSeenAt: "desc" }],
      take: PAGE_SIZE,
      select: { id: true, level: true, source: true, message: true, route: true, count: true, userId: true, meta: true, createdAt: true, lastSeenAt: true, resolvedAt: true },
    }),
    db.errorLog.count({ where }),
    db.errorLog.count({ where: { resolvedAt: null } }),
    db.errorLog.count({ where: { resolvedAt: { not: null } } }),
    db.errorLog.count({ where: { resolvedAt: null, lastSeenAt: { gte: new Date(now.getTime() - 24 * 3600_000) } } }),
  ]);
  return {
    total, openCount, resolvedCount, last24,
    rows: rows.map((r) => {
      const meta = readMeta(r.meta);
      return { ...r, meta: undefined, type: meta.type ?? "Error", users: affectedUsers(meta, r.userId), series: hourlySeries(meta, now), reopenedAt: meta.reopenedAt ? new Date(meta.reopenedAt) : null };
    }),
  };
}

export async function getError(id: string, now = new Date()) {
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const r = await db.errorLog.findUnique({ where: { id } });
  if (!r) return null;
  const meta = readMeta(r.meta);
  return { ...r, type: meta.type ?? "Error", extra: meta.extra ?? {}, users: affectedUsers(meta, r.userId), series: hourlySeries(meta, now), reopenedAt: meta.reopenedAt ? new Date(meta.reopenedAt) : null };
}

/** Mark resolved. Idempotent; a later occurrence re-opens it (captureError clears resolvedAt). */
export async function resolveErrorById(id: string, at = new Date()) {
  return (await db.errorLog.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: at } })).count;
}
