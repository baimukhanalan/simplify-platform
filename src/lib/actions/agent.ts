"use server";
// "Agent" screen: what Simplify may do on its own. Persisted to User.autonomy (see src/lib/engine/autonomy.ts).
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, j, s } from "../db";
import { AUTONOMY_DEFAULTS, AUTONOMY_LABELS, readAutonomy, type Autonomy } from "../engine/autonomy";
import { logEvent } from "../engine/agent";

export type AutonomyState = { ok?: boolean; error?: string; savedAt?: number };

export async function saveAutonomy(_prev: AutonomyState, form: FormData): Promise<AutonomyState> {
  const user = await requireUser();
  const next: Autonomy = { ...AUTONOMY_DEFAULTS };
  for (const { key } of AUTONOMY_LABELS) next[key] = form.get(key) === "on";

  const sensitive = String(form.get("sensitive") ?? "");
  if (sensitive !== "ask" && sensitive !== "decline") return { error: "Выберите, как агент отвечает на чувствительные вопросы." };
  next.sensitive = sensitive;

  if (form.get("autoApplyOn") === "on") {
    const raw = String(form.get("autoApplyMinMatch") ?? "").trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 50 || n > 100) return { error: "Порог Match должен быть от 50 до 100%." };
    next.autoApplyMinMatch = Math.round(n);
  } else {
    next.autoApplyMinMatch = null;
  }

  const before = readAutonomy(user.autonomy);
  await db.user.update({ where: { id: user.id }, data: { autonomy: s(next) } });

  // One switch for submission: the running campaign follows "Submit applications" (unless auto-submit consent was revoked in Privacy).
  const consent = j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false;
  const c = await db.campaign.findFirst({ where: { userId: user.id, status: { in: ["active", "paused"] } }, orderBy: { createdAt: "desc" } });
  if (c) await db.campaign.update({ where: { id: c.id }, data: { autoSubmit: next.submitApplications && consent } });

  const changed = AUTONOMY_LABELS.filter(({ key }) => before[key] !== next[key]).map(({ key, label }) => `${label}: ${next[key] ? "ON" : "OFF"}`);
  if (before.sensitive !== next.sensitive) changed.push(`Sensitive: ${next.sensitive === "ask" ? "ask me" : "prefer not to say"}`);
  if (before.autoApplyMinMatch !== next.autoApplyMinMatch) changed.push(`Auto-apply: ${next.autoApplyMinMatch == null ? "без порога" : `≥ ${next.autoApplyMinMatch}%`}`);
  if (changed.length) await logEvent(user.id, "autonomy", `Настройки агента: ${changed.join(", ")}`);

  revalidatePath("/app", "layout");
  return { ok: true, savedAt: Date.now() };
}
