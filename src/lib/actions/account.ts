"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, destroySession } from "../auth";
import { db, j, s } from "../db";
import { logEvent } from "../engine/agent";
import { loadCareer } from "@/app/app/career/_components/data";
import type { FormState } from "./profile";

export type Consents = { terms?: boolean; autoSubmit?: boolean; emailScan?: boolean; copilot?: boolean; analytics?: boolean; at?: string };
const CONSENT_KEYS = ["autoSubmit", "emailScan", "copilot", "analytics"] as const;
const CONSENT_LABEL: Record<(typeof CONSENT_KEYS)[number], string> = { autoSubmit: "автоподача", emailScan: "сканирование почты", copilot: "Interview Copilot", analytics: "аналитика" };

export async function updateConsents(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const prev = j<Consents>(user.consents, {});
  const next: Consents = { ...prev, at: new Date().toISOString() };
  const changed: string[] = [];
  for (const k of CONSENT_KEYS) {
    const v = form.get(k) === "on";
    if (Boolean(prev[k]) !== v) changed.push(`${CONSENT_LABEL[k]}: ${v ? "вкл" : "выкл"}`);
    next[k] = v;
  }
  await db.user.update({ where: { id: user.id }, data: { consents: s(next) } });
  // Auto-submit consent is authoritative: revoking it switches the running campaign to manual approval.
  if (!next.autoSubmit) await db.campaign.updateMany({ where: { userId: user.id, status: { in: ["active", "paused"] } }, data: { autoSubmit: false } });
  if (changed.length) await logEvent(user.id, "consents_updated", `Согласия изменены — ${changed.join(", ")}`);
  revalidatePath("/app", "layout");
  return { ok: true, message: changed.length ? "Согласия обновлены" : "Без изменений", at: Date.now() };
}

export async function setCareerMode(form: FormData) {
  const user = await requireUser();
  const mode = form.get("mode") === "passive" ? "passive" : "active";
  if (mode === user.careerMode) return;
  await db.user.update({ where: { id: user.id }, data: { careerMode: mode } });
  await logEvent(user.id, "career_mode", mode === "passive" ? "Включён Passive Career Mode" : "Включён активный поиск");
  revalidatePath("/app", "layout");
}

export async function recordSnapshot() {
  const user = await requireUser();
  const c = await loadCareer(user.id);
  await db.careerSnapshot.create({ data: { userId: user.id, score: c.score, marketValue: c.marketValue, components: s(c.components) } });
  await logEvent(user.id, "career_snapshot", `Career Score зафиксирован: ${c.score}`);
  revalidatePath("/app/career");
}

export async function deleteAccount(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const typed = String(form.get("confirmEmail") ?? "").trim().toLowerCase();
  if (typed !== user.email.toLowerCase()) return { ok: false, error: "Email не совпадает — аккаунт не удалён.", at: Date.now() };
  // Every user-owned relation cascades (profile, facts, campaigns → opportunities, events, …).
  await db.user.delete({ where: { id: user.id } });
  await destroySession();
  redirect("/");
}
