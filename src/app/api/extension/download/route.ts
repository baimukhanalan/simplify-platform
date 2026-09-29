import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { currentUserId } from "@/lib/auth";
import { rateLimitUser } from "@/lib/rate-limit";
import { zip } from "../_lib/zip";

const MAX_FILES = 200;
const MAX_BYTES = 5 * 1024 * 1024;

async function collect(root: string, dir = "", out: { name: string; data: Uint8Array }[] = [], budget = { bytes: 0 }) {
  for (const ent of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
    const rel = dir ? `${dir}/${ent.name}` : ent.name;
    if (ent.isDirectory()) await collect(root, rel, out, budget);
    else if (ent.isFile()) {
      if (out.length >= MAX_FILES) throw new Error("too many files");
      const data = await readFile(path.join(root, rel));
      budget.bytes += data.length;
      if (budget.bytes > MAX_BYTES) throw new Error("too large");
      out.push({ name: `simplify-apply-assist/${rel}`, data });
    }
  }
  return out;
}

/** The unpacked extension (the repo's extension/ folder) as a zip, built on the fly. Signed-in users only. */
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const rl = await rateLimitUser("ext-download", userId, 20, 10 * 60 * 1000);
  if (!rl.ok) return Response.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });
  const root = path.join(process.cwd(), "extension");
  try {
    if (!(await stat(root)).isDirectory()) throw new Error("missing");
    const files = await collect(root);
    files.sort((a, b) => a.name.localeCompare(b.name));
    const body = zip(files);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="simplify-apply-assist.zip"',
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "extension bundle unavailable" }, { status: 404 });
  }
}
