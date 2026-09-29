// Concurrent invoice creation + confirms from one user: one pending invoice per plan, identical confirm results, no duplicate charges.
//   BASE=http://localhost:3500 N=50 node tests/e2e/stress-invoice.mjs
import { Client, db, check, dbUser, done } from "./lib-dev.mjs";
const N = Number(process.env.N ?? 50);
const u = await dbUser("stress-inv");
const c = await new Client("inv").asUser(u.id);
const rs = await Promise.all(Array.from({ length: N }, () => c.json("POST", "/api/payments/kaspi/invoices", { plan: "local" })));
const ids = new Set(rs.map((r) => r.data?.invoiceId));
const pending = await db.payment.count({ where: { userId: u.id, status: "pending", plan: "local" } });
check(pending === 1 && ids.size === 1 && rs.every((r) => r.status === 201), "SI.one", `${N} concurrent invoices → pending=${pending} distinct=${ids.size} statuses=${[...new Set(rs.map((r) => r.status))]}`);
const id = [...ids][0];
const cs = await Promise.all(Array.from({ length: N }, () => c.json("POST", `/api/payments/kaspi/confirm/${id}`, { outcome: "success" })));
const bodies = new Set(cs.map((r) => JSON.stringify(r.data)));
const p = await db.payment.findFirst({ where: { externalId: id } });
const meta = JSON.parse(p.meta);
check(cs.every((r) => r.status === 200) && bodies.size === 1 && p.status === "paid" && !meta.refunds?.length && !meta.confirmLease, "SI.confirm", `${N} confirms: same body=${bodies.size === 1} status=${p.status} refunds=${meta.refunds?.length ?? 0} lease=${!!meta.confirmLease}`);
const again = await c.json("POST", `/api/payments/kaspi/confirm/${id}`, { outcome: "success" });
check(again.status === 200 && JSON.stringify(again.data) === [...bodies][0], "SI.again", "a later confirm returns the same result");
await done();
