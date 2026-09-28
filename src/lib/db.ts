import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { prisma?: PrismaClient };
export const db = g.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") g.prisma = db;

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
