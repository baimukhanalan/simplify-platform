import { PrismaClient } from "@prisma/client";

// One client per server instance, in production too: every bundle that imports this module (pages, route handlers,
// server actions) and every hot reload in dev reuses the same connection pool instead of opening another.
const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient(sqliteSingleConnection(process.env.DATABASE_URL));
g.prisma = db;

/**
 * SQLite (dev/tests only) gets exactly one pooled connection. Prisma's engine runs SQLite calls on its tokio worker
 * threads (one per CPU) and SQLite's busy handler sleeps *synchronously* while it waits for the single write lock.
 * With the default pool (CPUs × 2 + 1) there can be more connections waiting for that lock than there are worker
 * threads: every worker is then asleep inside a waiter, the transaction that holds the lock never gets a thread to run
 * its next statement / COMMIT, and all of them fail after busy_timeout with «Socket timeout» (2-CPU CI runners: pool 5,
 * 2 workers). One connection makes in-process work queue on the pool (async) instead of busy-waiting on threads; SQLite
 * has one writer anyway. Postgres (production) is untouched — its lock waits don't hold a thread.
 */
function sqliteSingleConnection(url: string | undefined): ConstructorParameters<typeof PrismaClient>[0] {
  if (!url?.startsWith("file:")) return undefined;
  const q = url.indexOf("?");
  const [base, query] = q < 0 ? [url, ""] : [url.slice(0, q), url.slice(q + 1)];
  const params = new URLSearchParams(query);
  params.set("connection_limit", "1");
  return { datasourceUrl: `${base}?${params.toString()}` };
}

/** Parse a JSON string column, falling back when empty or malformed. */
export function j<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const s = (value: unknown) => JSON.stringify(value);

/** Strip NUL bytes (pasted PDFs, external feeds): Postgres text columns reject \u0000. */
export const noNul = (text: string) => text.replace(/\u0000/g, "");

/** SQLite (dev) vs Postgres (prod) — some filters (e.g. `mode: "insensitive"`) exist only on Postgres. */
export const isPostgres = /^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? "");

/** Spread into a Prisma string filter for case-insensitive `contains` on Postgres (SQLite LIKE is already case-insensitive for ASCII). */
export const insensitive: Record<never, never> = isPostgres ? { mode: "insensitive" } : {};
