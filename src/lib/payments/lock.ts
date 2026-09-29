import "server-only";

/**
 * In-process keyed mutex: calls with the same key run one after another (FIFO), different keys run in parallel.
 * It keeps concurrent requests of one user from piling up competing DB transactions (SQLite has a single writer and
 * times out under a burst); cross-instance correctness still comes from the DB locks inside those transactions.
 * The map lives on globalThis so every route bundle (and dev HMR copy) shares it.
 */
const g = globalThis as unknown as { __sfyKeyLocks?: Map<string, Promise<void>> };
const tails = (g.__sfyKeyLocks ??= new Map<string, Promise<void>>());

export async function withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}
