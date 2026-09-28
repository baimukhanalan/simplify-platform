"use server";
// "Agent" screen: what Simplify may do on its own. Persisted to User.autonomy (see src/lib/engine/autonomy.ts).
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, s } from "../db";
import { AUTONOMY_DEFAULTS, AUTONOMY_LABELS, readAutonomy, type Autonomy } from "../engine/autonomy";
import { logEvent, SENSITIVE_DECLINE } from "../engine/agent";
import { answerMatchingApprovals } from "../engine/approvals";

export type AutonomyState = { ok?: boolean; error?: string; savedAt?: number };

export async function saveAutonomy(_prev: AutonomyState, form: FormData): Promise<AutonomyState> {
  const user = await requireUser();
  const next: Autonomy = { ...AUTONOMY_DEFAULTS };
  for (const { key } of AUTONOMY_LABELS) next[key] = form.get(key) === "on";

  const sensitive = String(form.get("sensitive") ?? "");
  if (sensitive !== "ask" && sensitive !== "decline") return { error: "Выбери, как агент отвечает на чувствительные вопросы." };
  next.sensitive = sensitive;

  // One control, two fields (the same ones the Opportunities switch writes): the switch is submitApplications,
  // the slider is the threshold. The threshold is always kept, so turning auto-apply back on restores it.
  next.submitApplications = form.get("submitApplications") === "on";
  const raw = String(form.get("autoApplyMinMatch") ?? "").trim();
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n < 50 || n > 100) return { error: "Порог Match должен быть от 50 до 100%." };
  next.autoApplyMinMatch = Math.round(n);

  const before = readAutonomy(user.autonomy);
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
