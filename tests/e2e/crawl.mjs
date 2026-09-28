// Crawl every internal href reachable from the seed pages as a given client. Reports non-2xx/3xx and error pages.
import { Client, BASE } from "./lib.mjs";

const SEEDS = ["/", "/app", "/app/agent", "/app/applications", "/app/approvals", "/app/campaign", "/app/career", "/app/goal", "/app/hired", "/app/inbox", "/app/insights", "/app/interviews", "/app/offers", "/app/opportunities", "/app/pipeline", "/app/profile", "/app/readiness", "/app/settings", "/onboarding", "/onboarding?step=1", "/onboarding?step=2", "/onboarding?step=3", "/onboarding?step=4", "/onboarding?step=5", "/check", "/login", "/signup", "/privacy", "/terms", "/partners", "/admin"];

const decode = (h) => h.replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

export async function crawl(c, label, { max = 400, extraSeeds = [] } = {}) {
  const seen = new Map(); // path -> {status, final, from}
  const queue = [...SEEDS, ...extraSeeds].map((p) => ({ p, from: "(seed)" }));
  const problems = [];
  while (queue.length && seen.size < max) {
    const { p, from } = queue.shift();
    const key = p.split("#")[0];
    if (!key || seen.has(key)) continue;
    let r, hops = 0, cur = key, chain = [];
    while (true) {
      r = await c.get(cur);
      chain.push(`${r.status} ${cur}`);
      if (r.status >= 300 && r.status < 400 && r.location && hops++ < 6) {
        const loc = new URL(r.location, BASE);
        if (loc.origin !== new URL(BASE).origin) break;
        cur = loc.pathname + loc.search;
        continue;
      }
      break;
    }
    seen.set(key, { status: r.status, final: cur, from });
    const text = r.text;
    const appErr = /Application error|server-side exception|Internal Server Error/.test(text) || /E\{\\?"digest\\?":\\?"(?!NEXT_REDIRECT|NEXT_HTTP_ERROR)/.test(text) || /Что-то пошло не так/.test(text);
    const nf = r.status === 404 || /This page could not be found|NEXT_HTTP_ERROR_FALLBACK;404/.test(text) && r.status !== 200;
    if (r.status >= 500 || appErr) problems.push({ kind: "5xx", path: key, from, chain: chain.join(" -> "), snippet: (text.match(/digest[^,}]*/) ?? [""])[0] });
    else if (r.status === 404 || /NEXT_HTTP_ERROR_FALLBACK;404/.test(text)) problems.push({ kind: "404", path: key, from, chain: chain.join(" -> ") });
    else if (r.status >= 400) problems.push({ kind: String(r.status), path: key, from, chain: chain.join(" -> ") });
    if (!/text\/html/.test(r.res.headers.get("content-type") ?? "")) continue;
    for (const m of text.matchAll(/href="([^"]+)"/g)) {
      const h = decode(m[1]);
      if (!h.startsWith("/") || h.startsWith("//") || h.startsWith("/_next") || /\.(css|js|png|svg|ico|woff2?)(\?|$)/.test(h)) continue;
      if (h.startsWith("/api/")) { if (!seen.has(h)) queue.push({ p: h, from: cur }); continue; }
      if (!seen.has(h.split("#")[0])) queue.push({ p: h, from: cur });
    }
  }
  console.log(`\n=== crawl ${label}: ${seen.size} urls, ${problems.length} problems`);
  for (const pr of problems) console.log(`  ${pr.kind} ${pr.path}  (linked from ${pr.from})  chain: ${pr.chain} ${pr.snippet ?? ""}`);
  return { seen, problems };
}

if (process.argv[1].endsWith("crawl.mjs")) {
  const { db } = await import("./lib.mjs");
  const email = process.argv[2] ?? "demo@simplify.kz";
  const u = await db.user.findUnique({ where: { email } });
  const c = await new Client("crawl").asUser(u.id);
  const { seen } = await crawl(c, email);
  if (process.argv[3] === "-v") for (const [k, v] of seen) console.log(v.status, k, v.final !== k ? "=> " + v.final : "");
  await db.$disconnect();
}
