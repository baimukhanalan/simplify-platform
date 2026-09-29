import { createHash } from "node:crypto";

/**
 * Message normalized for grouping: ids, numbers, hex, quoted literals and durations collapse, so
 * "Campaign ck9x… not found (took 312ms)" and "Campaign cl0a… not found (took 95ms)" are one error.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\bc[a-z0-9]{24,}\b/g, "<id>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<hex>")
    .replace(/(["'`])(?:(?!\1).){1,120}\1/g, "$1<s>$1")
    .replace(/\d+(?:[.,]\d+)?/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** First stack frame that belongs to the app (not node internals / node_modules / Next internals), without line/col. */
export function topAppFrame(stack: string | undefined | null): string {
  if (!stack) return "";
  for (const raw of stack.split("\n").slice(1, 40)) {
    const line = raw.trim();
    if (!line.startsWith("at ") && !line.includes("@")) continue;
    if (/node_modules|node:internal|\(node:|next\/dist|<anonymous>|webpack\/runtime|react-dom|react-server-dom/.test(line)) continue;
    const m = line.match(/^at\s+(?:async\s+)?(?:(.+?)\s+\()?(.+?)(?::\d+)?(?::\d+)?\)?$/) ?? line.match(/^(.*?)@(.+?)(?::\d+)?(?::\d+)?$/);
    if (!m) continue;
    const fn = (m[1] ?? "").replace(/^Object\./, "").trim();
    const file = cleanFile(m[2] ?? "");
    if (!file) continue;
    return `${fn || "<anon>"} ${file}`.slice(0, 200);
  }
  return "";
}

/** Stable file id across deploys: drop origin, build hashes and query strings; keep the path from src/ when present. */
export function cleanFile(file: string): string {
  let f = file.replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, "").replace(/^file:\/\//, "").replace(/^https?:\/\/[^/]+/, "");
  f = f.split("?")[0];
  const src = f.indexOf("/src/");
  if (src >= 0) f = f.slice(src + 1);
  else if (f.startsWith("./src/")) f = f.slice(2);
  else f = f.split("/").slice(-2).join("/");
  // Chunk / build hashes: page-3f2a9c1b.js, 1234-abcd1234ef.js, [turbopack]_…_hash._.js
  // Turbopack chunk ids ([root-of-the-server]__1kdip4d._.js, node_modules_next_dist_0irbl5s._.js) change every build.
  f = f.replace(/[-_]+([a-z0-9]{5,12})(?=\._\.js$|\.js$)/i, (m, id: string) => (/\d/.test(id) ? "" : m));
  return f.replace(/[-_.][0-9a-f]{6,}(?=[._-])/gi, "").replace(/\b\d{2,}(?=[-_.])/g, "<n>").slice(0, 160);
}

export function fingerprintOf(input: { message: string; stack?: string | null; route?: string | null; source?: string }): string {
  const key = [input.source ?? "", normalizeMessage(input.message), topAppFrame(input.stack), input.route ?? ""].join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}
