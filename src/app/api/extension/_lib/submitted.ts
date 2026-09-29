import "server-only";
import { db } from "@/lib/db";
import { logEvent, submit } from "@/lib/engine/agent";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";
import { roleLabelRu } from "@/lib/ru";

export type MarkResult = { ok: true; already?: boolean } | { ok: false; error: "not-found" | "no-package" | "rejected"; reason?: string };

/**
 * The user confirms in the extension that THEY clicked Submit on the employer's form. Recorded through the engine's own
 * submit(…, "user") (it re-validates status and package), then the pending handoff for this vacancy is closed.
 */
export async function markSubmittedByExtension(userId: string, opportunityId: string): Promise<MarkResult> {
  const opp = await db.opportunity.findFirst({ where: { id: opportunityId, campaign: { userId } }, include: { job: true, pkg: { select: { id: true } } } });
  if (!opp) return { ok: false, error: "not-found" };
  if (APPLIED_OR_LATER.includes(opp.status)) return { ok: true, already: true };
  if (!opp.pkg) return { ok: false, error: "no-package" };
  const r = await submit(opportunityId, "user");
  if (!r.ok) {
    if (r.reason === "already-submitted") return { ok: true, already: true };
    return { ok: false, error: "rejected", reason: r.reason };
  }
  await db.approval.updateMany({ where: { opportunityId, kind: "handoff", status: "pending" }, data: { status: "approved", answer: "submitted-by-user", resolvedAt: new Date() } });
  await logEvent(userId, "extension_submit", `Заявка отправлена через расширение: ${roleLabelRu(opp.job)}`, opportunityId, { via: "extension" });
  return { ok: true };
}
