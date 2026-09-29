// Polite HTTP for public job feeds: one User-Agent, a per-request timeout, retries with backoff on 429 / 5xx / network
// errors (and, for feeds that need it, on a non-JSON body), a run-wide deadline, and a small concurrency pool.
import type { RawJob } from "../engine/ingest";

export const USER_AGENT = "Simplify/1.0";

/** Per-run context every reader receives. Readers never throw for one bad board / page — they note it in `errors`. */
export type SourceCtx = {
  /** Epoch ms: no new request starts after this. */
  deadline: number;
  /** Per-board / per-page failures; the source keeps going. */
  errors: string[];
  /** ATS readers: the boards to read this run (rotation is decided by the caller). */
  boards?: Board[];
  /** ATS readers fill this with boards read in full (not truncated), so the caller may retire what they stopped listing. */
  completeBoards?: string[];
  /** ATS readers: how many boards answered this run. */
  boardsRead?: number;
  /** ATS readers: at most this many postings per board (remote / KZ-reachable first). */
  maxPerBoard?: number;
  /** Parallel requests within one source. */
  concurrency?: number;
  /** Base backoff between retries (tests shrink it). */
  backoffMs?: number;
};
export type Board = { slug: string; company?: string };
export type SourceFn = (q: string, ctx: SourceCtx) => Promise<RawJob[]>;

export class DeadlineError extends Error {
  constructor() { super("time budget exhausted"); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Largest feed body read (~10 MB). A bigger (or endless) response is cut off instead of exhausting the function's memory. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Reads a response body as text, refusing more than `max` bytes (Content-Length up front, then while streaming). */
export async function readCapped(res: Response, max = MAX_BODY_BYTES, label = "response"): Promise<string> {
  const tooBig = () => Object.assign(new Error(`${label} → body over ${Math.round(max / 1048576)} MB`), { fatal: true });
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => undefined);
    throw tooBig();
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(buf);
}

type GetOpts = { deadline: number; timeoutMs?: number; retries?: number; backoffMs?: number; retryNonJson?: boolean; maxBytes?: number };

/** GET a JSON document. Retries 429 / 5xx / network errors (and a non-JSON body when asked); 4xx fails at once. */
export async function getJSON<T = unknown>(url: string, o: GetOpts): Promise<T> {
  const retries = o.retries ?? 2;
  const base = o.backoffMs ?? 800;
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const left = o.deadline - Date.now();
    if (left <= 0) throw new DeadlineError();
    let retryAfter = 0;
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(o.timeoutMs ?? 20_000, left))),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        retryAfter = Math.min(10_000, Number(res.headers.get("retry-after")) * 1000 || 0);
        last = new Error(`${host(url)} → ${res.status}`);
      } else if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw Object.assign(new Error(`${host(url)} → ${res.status}`), { fatal: true });
      } else {
        const body = await readCapped(res, o.maxBytes ?? MAX_BODY_BYTES, host(url));
        try {
          return JSON.parse(body) as T;
        } catch {
          last = Object.assign(new Error(`${host(url)} → non-JSON response`), { fatal: !o.retryNonJson });
          if (!o.retryNonJson) throw last;
        }
      }
    } catch (e) {
      if ((e as { fatal?: boolean }).fatal || e instanceof DeadlineError) throw e;
      last = e instanceof Error && e.name === "TimeoutError" ? new Error(`${host(url)} → timeout`) : e;
    }
    if (attempt < retries) {
      const wait = Math.max(retryAfter, base * 2 ** attempt + Math.random() * base * 0.25);
      if (Date.now() + wait >= o.deadline) break;
      await sleep(wait);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function host(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** Run `fn` over items, `limit` at a time; items not started before the deadline are skipped (reported via `skipped`). */
export async function mapLimit<T, R>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<R>): Promise<{ results: R[]; skipped: number }> {
  const results: R[] = [];
  let next = 0, skipped = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (Date.now() >= deadline) { skipped++; continue; }
      results.push(await fn(item));
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return { results, skipped };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** «salmon-group» → «Salmon Group» when the board carries no company name. */
export const companyFromSlug = (slug: string) => slug.replace(/[-_.]+/g, " ").replace(/\b\p{L}/gu, (c) => c.toUpperCase()).trim();

/** "$120,000 - $150,000" from numeric bounds, only for a yearly USD range (anything else is left to the text). */
export function usdRange(min: unknown, max: unknown, currency?: unknown, period?: unknown) {
  const lo = Number(min), hi = Number(max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0 || hi < lo) return undefined;
  if (currency && String(currency).toUpperCase() !== "USD") return undefined;
  if (period && !/year|annual/i.test(String(period))) return undefined;
  return `$${Math.round(lo).toLocaleString("en-US")} - $${Math.round(hi).toLocaleString("en-US")}`;
}
