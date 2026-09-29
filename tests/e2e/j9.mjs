import { Client, db, check, findings, signupNew } from "./lib.mjs";
import { crawl } from "./crawl.mjs";
import { newPaidUser } from "./j1.mjs";
const extra = ["/check/nonexistent", "/share/xxxxxxxxxxxxxxxxxxxx", "/pay/kaspi/KSP-NOPE", "/app/opportunities/nope", "/app/applications/nope", "/app/interviews/nope", "/app/interviews/nope/copilot", "/api/applications/nope/cv", "/api/payments/kaspi/invoices/nope", "/nonexistent-page"];
const EXPECT404 = new Set(extra.filter((p) => !p.startsWith("/api/applications") && !p.startsWith("/api/payments")));
function report(label, res, expected404 = EXPECT404) {
  const bad = res.problems.filter((p) => !(p.kind === "404" && (expected404.has(p.path) || p.path.includes("/nope"))) && !["401", "429"].includes(p.kind));
  check(!bad.length, `J9.${label}`, `${label}: ${res.seen.size} urls crawled, no 5xx / unexpected 404`, bad.map((p) => `${p.kind} ${p.path} <- ${p.from}`));
}
const anon = new Client("anon");
report("anon", await crawl(anon, "anonymous", { extraSeeds: extra }));
const { c: nu } = await signupNew("j9new");
report("brand-new", await crawl(nu, "brand-new user (no CV, no goal)", { extraSeeds: extra }));
const { c: pre } = await newPaidUser("j9pre", { quiet: true });
report("pre-payment", await crawl(pre, "onboarded user with pending invoice, no campaign", { extraSeeds: extra }));
for (const email of ["admin@simplify.kz", "partner@amaskills.kz"]) {
  const u = await db.user.findUnique({ where: { email } });
  if (!u) continue;
  const c = await new Client(email).asUser(u.id);
  report(email.split("@")[0], await crawl(c, email, { extraSeeds: ["/admin", "/partners"] }));
}
const demo = await db.user.findUnique({ where: { email: "aruzhan@simplify.kz" } });
report("demo", await crawl(await new Client("demo").asUser(demo.id), "demo", { extraSeeds: extra, max: 600 }));
console.log(`\n${findings.length} failures`);
await db.$disconnect();
