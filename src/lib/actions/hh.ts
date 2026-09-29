"use server";
// hh.kz integration actions (Agent screen): choose the resume the agent applies with, or disconnect.
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db } from "../db";
import { logEvent } from "../engine/agent";
import { hhAccessToken, hhIntegration, myResumes, patchHhMeta, revokeToken } from "../hh/client";

export type HhActionState = { ok?: boolean; error?: string; savedAt?: number } | undefined;

export async function selectHhResume(_prev: HhActionState, form: FormData): Promise<HhActionState> {
  const user = await requireUser();
  const id = String(form.get("resumeId") ?? "").trim();
  if (!id) return { error: "Выбери резюме." };
  const row = await hhIntegration(user.id);
  if (!row?.accessToken) return { error: "hh.kz не подключён." };
  let resumes;
  try {
    resumes = await myResumes(user.id);
  } catch {
    return { error: "Не удалось получить резюме с hh.kz. Попробуй ещё раз или переподключи аккаунт." };
  }
  const pick = resumes.find((r) => r.id === id);
  if (!pick) return { error: "Это резюме не найдено в твоём аккаунте hh.kz." };
  await db.integration.update({ where: { id: row.id }, data: { resumeId: pick.id } });
  await patchHhMeta(user.id, { resumeTitle: pick.title });
  if (row.resumeId !== pick.id) await logEvent(user.id, "integration", `hh.kz: для откликов выбрано резюме «${pick.title}»`);
  revalidatePath("/app", "layout");
  return { ok: true, savedAt: Date.now() };
}

export async function disconnectHh() {
  const user = await requireUser();
  const row = await hhIntegration(user.id);
  if (!row) return;
  const token = hhAccessToken(row);
  if (token) await revokeToken(token); // best effort at hh; our copy is deleted regardless
  await db.integration.delete({ where: { id: row.id } });
  await logEvent(user.id, "integration", "hh.kz отключён: токены доступа удалены");
  revalidatePath("/app", "layout");
}
