"use server";
// "Agent" screen: what Simplify may do on its own. Persisted to User.autonomy (see src/lib/engine/autonomy.ts).
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, s } from "../db";
import { AUTONOMY_LABELS, mergeAutonomyForm, readStoredAutonomy } from "../engine/autonomy";
import { isSimulation } from "../mode";
import { logEvent, SENSITIVE_DECLINE } from "../engine/agent";
import { answerMatchingApprovals } from "../engine/approvals";
import { actionT } from "../i18n/action";

export type AutonomyState = { ok?: boolean; error?: string; savedAt?: number };

export async function saveAutonomy(_prev: AutonomyState, form: FormData): Promise<AutonomyState> {
  const user = await requireUser();
  const fresh = await db.user.findUnique({ where: { id: user.id }, select: { autonomy: true } });
  // The user's own stored values — never the simulation's standing overlay (readAutonomy), which must not be persisted.
  const before = readStoredAutonomy(fresh?.autonomy ?? user.autonomy);
  const next = mergeAutonomyForm(before, form, isSimulation());
  if ("error" in next) {
    // The engine validates in Russian; the user sees the same message in their language.
    const t = await actionT();
    const sensitive = String(form.get("sensitive") ?? "");
    return { error: sensitive !== "ask" && sensitive !== "decline" ? t("agentPage.err.sensitive") : t("agentPage.err.threshold") };
  }

  await db.user.update({ where: { id: user.id }, data: { autonomy: s(next) } });
  // Campaign.autoSubmit is not touched here: it mirrors only the auto-submit consent (Settings → Privacy).

  const changed = AUTONOMY_LABELS.filter(({ key }) => before[key] !== next[key]).map(({ key, label }) => `${label}: ${next[key] ? "вкл" : "выкл"}`);
  if (before.submitApplications !== next.submitApplications || before.autoApplyMinMatch !== next.autoApplyMinMatch) {
    changed.push(next.submitApplications ? `Автоподача: вкл, Match от ${next.autoApplyMinMatch}%` : "Автоподача: выкл (только Apply / Auto)");
  }
  if (before.sensitive !== next.sensitive) changed.push(`Чувствительные вопросы: ${next.sensitive === "ask" ? "спрашивать меня" : "отвечать «Предпочитаю не указывать»"}`);
  if (changed.length) await logEvent(user.id, "autonomy", `Настройки агента: ${changed.join(", ")}`);
  // Switching Sensitive to «Предпочитаю не указывать» applies to questions already waiting too, not only to new packages:
  // each pending sensitive approval is answered the same way prepare() would answer it, and ready roles continue.
  if (before.sensitive !== "decline" && next.sensitive === "decline") {
    await answerMatchingApprovals(user.id, { kind: "sensitive", answer: SENSITIVE_DECLINE, status: "approved" });
  }

  revalidatePath("/app", "layout");
  return { ok: true, savedAt: Date.now() };
}

