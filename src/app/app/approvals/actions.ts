"use server";
// Resolve one exception-queue item and report what it changed: questions closed (a standing answer closes every
// identical copy) and applications that went out as a result. Wraps `resolveApproval` from lib; when that action
// starts returning its own `{ resolved, sent }`, those numbers win over the before/after counts below.
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveApproval } from "@/lib/actions/ops";
import { pendingApprovalsWhere, pendingHandoffsWhere } from "@/lib/ops-data";
import { APPLIED_OR_LATER } from "@/lib/engine/taxonomy";

export type ResolveResult = { ok: boolean; decision: string; resolved: number; sent: number; handoffs: number };

async function snapshot(userId: string) {
  const [questions, sent, handoffs] = await Promise.all([
    db.approval.count({ where: pendingApprovalsWhere(userId) }),
    db.opportunity.count({ where: { campaign: { userId }, status: { in: APPLIED_OR_LATER } } }),
    db.approval.count({ where: pendingHandoffsWhere(userId) }),
  ]);
  return { questions, sent, handoffs };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export async function resolveWithSummary(form: FormData): Promise<ResolveResult> {
  const user = await requireUser();
  const decision = String(form.get("decision") ?? "");
  const before = await snapshot(user.id);
  const r: unknown = await resolveApproval(form);
  const after = await snapshot(user.id);
  const lib = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
  const resolved = num(lib.resolved) ?? Math.max(0, before.questions - after.questions);
  const sent = num(lib.sent) ?? Math.max(0, after.sent - before.sent);
  return { ok: resolved > 0, decision, resolved, sent, handoffs: Math.max(0, after.handoffs - before.handoffs) };
}
