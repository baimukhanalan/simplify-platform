// Concurrent confirms of ONE Kaspi invoice (N at once) → exactly one campaign, one paid payment, no 5xx.
//   BASE=http://localhost:3500 N=10 node tests/e2e/stress-pay.mjs
import { Client, db, check, dbUser, pct, done } from "./lib-dev.mjs";
const N = Number(process.env.N ?? 10);
const u = await dbUser("stress-pay");
const c = await new Client("pay").asUser(u.id);
const inv = await c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" });
const id = inv.data.invoiceId;
const rs = await Promise.all(Array.from({ length: N }, () => c.json("POST", `/api/payments/kaspi/confirm/${id}`, { outcome: "success" })));
const ms = rs.map((r) => r.ms);
const st = Object.entries(rs.reduce((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {})).map(([k, v]) => `${k}×${v}`).join(" ");
const camps = await db.campaign.count({ where: { userId: u.id } });
const paid = await db.payment.count({ where: { userId: u.id, status: "paid" } });
check(camps === 1 && paid === 1, "SP.once", `${N} concurrent confirms: ${st} p50=${pct(ms, 50)} p95=${pct(ms, 95)} → campaigns=${camps} paid=${paid}`, rs.filter((r) => r.status >= 500).slice(0, 2));
if (camps === 0) {
  const retry = await c.json("POST", `/api/payments/kaspi/confirm/${id}`, { outcome: "success" });
  check(retry.status === 200 && retry.data.status === "paid", "SP.retry", "a later single confirm succeeds", retry);
}
await done();
