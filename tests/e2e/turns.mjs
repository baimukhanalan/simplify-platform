import { db } from "./lib.mjs";
// Mirrors buildChatTurns ids (src/lib/onboarding.ts) with sensible answers.
export async function buildTurns(userId, answers = {}) {
  const facts = await db.fact.findMany({ where: { userId, kind: { in: ["employment", "project"] } }, orderBy: { createdAt: "asc" } });
  const work = facts.sort((a, b) => Number(a.kind === "project") - Number(b.kind === "project") || a.createdAt - b.createdAt).slice(0, 2);
  const goal = await db.goal.findUnique({ where: { userId } });
  const t = [];
  for (const f of work) {
    if (!f.metrics) t.push({ id: `metric:${f.id}`, kind: "text" });
    if (!f.ownership) t.push({ id: `own:${f.id}`, kind: "choice", options: [{ value: "led" }], suggested: "led" });
  }
  t.push({ id: "citizenship", kind: "choice", options: [{ value: "KZ" }], suggested: answers.citizenship ?? "KZ" });
  for (const r of JSON.parse(goal?.countries ?? "[]").filter((c) => ["US", "EU", "UK", "CA", "MENA"].includes(c))) t.push({ id: `auth:${r}`, kind: "choice", options: [{ value: "no" }], suggested: answers.auth ?? "no" });
  t.push({ id: "relocation", kind: "choice", options: [{ value: "yes" }], suggested: answers.relocation ?? "yes" });
  t.push({ id: "english", kind: "choice", options: [{ value: "C1" }], suggested: "C1" });
  t.push({ id: "notice", kind: "choice", options: [{ value: "1 month" }], suggested: "1 month" });
  return t;
}
