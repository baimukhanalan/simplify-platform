// Journey 25 (shared dev server): crawl every page reachable from the app navigation for a seeded active user
// (default aruzhan@simplify.kz, read-only GETs), with a desktop and a 375px phone user agent. Checks: status < 400, and the
// visible text has no undefined / NaN / [object Object] / Invalid Date, no leftover i18n keys, no words hinting at fake data.
//   BASE=http://localhost:3500 [CRAWL_EMAIL=…] [CRAWL_MAX=150] node tests/e2e/j25.mjs
import { Client, db, check, textProblems, done, sleep } from "./lib-dev.mjs";

const email = process.env.CRAWL_EMAIL ?? "aruzhan@simplify.kz";
const MAX = Number(process.env.CRAWL_MAX ?? 150);
const u = await db.user.findUnique({ where: { email } });
if (!u) { console.log(`SKIP no user ${email}`); process.exit(0); }
const camp = await db.campaign.findFirst({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
console.log(`  crawling as ${email} (campaign ${camp?.status ?? "none"})`);

const UA = {
  desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};
const SKIP = /^\/(api|_next|r\/|offline)|logout|\.(png|svg|ico|pdf|json|js|css|webmanifest)(\?|$)|\/copilot|download/;
const norm = (href) => { try { const x = new URL(href, "http://h"); return x.host === "h" ? x.pathname + x.search : null; } catch { return null; } };

const stats = { pages: 0, problems: 0, slow: [] };
for (const [kind, ua] of Object.entries(UA)) {
  const c = await new Client("crawl-" + kind).asUser(u.id);
  const seen = new Set(["/app"]);
  const queue = ["/app"];
  let n = 0;
  while (queue.length && n < MAX) {
    const p = queue.shift();
    let r;
    for (let i = 0; i < 4; i++) { r = await c.get(p, { headers: { "user-agent": ua } }); if (r.status < 500) break; await sleep(3000); }
    n++;
    if (r.status >= 300 && r.status < 400) { const loc = norm(r.location ?? ""); if (loc && !seen.has(loc) && !SKIP.test(loc)) { seen.add(loc); queue.push(loc); } continue; }
    check(r.status < 400, `J25.${kind}.status`, `${p} → ${r.status}`, r.status < 400 ? undefined : r.text.slice(0, 200));
    if (r.ms > 1500) stats.slow.push(`${p} ${r.ms}ms`);
    if (kind === "mobile" && p === "/app") check(/name="viewport"[^>]*width=device-width/.test(r.text), "J25.viewport", "viewport meta width=device-width");
    for (const prob of textProblems(r.text)) { stats.problems++; check(false, `J25.${kind}.text`, `${p}`, prob); }
    stats.pages++;
    const html = r.text.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const m of html.matchAll(/href="([^"#]+)"/g)) {
      const l = norm(m[1].replace(/&amp;/g, "&"));
      if (!l || seen.has(l) || SKIP.test(l)) continue;
      if (!/^\/(app|check|share|pay|offer|refund|privacy|terms|consent|partners|$)/.test(l)) continue;
      // one detail page per list is enough
      const shape = l.replace(/\/c[a-z0-9]{20,}/g, "/:id");
      if ([...seen].some((s) => s.replace(/\/c[a-z0-9]{20,}/g, "/:id") === shape && shape.includes(":id") && [...seen].filter((x) => x.replace(/\/c[a-z0-9]{20,}/g, "/:id") === shape).length >= 2)) continue;
      seen.add(l); queue.push(l);
    }
  }
  console.log(`  ${kind}: crawled ${n} pages, ${queue.length} left in queue`);
}
console.log(`  slow (>1.5 s): ${stats.slow.slice(0, 10).join(", ") || "none"}`);
await done();
