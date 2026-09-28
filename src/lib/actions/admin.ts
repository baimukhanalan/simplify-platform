"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { runTick, logEvent } from "../engine/agent";
import { ingestLive } from "../engine/ingest";

export async function adminRunTick(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("campaignId") ?? "");
  const c = await db.campaign.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!c) return;
  const r = await runTick(c.id);
  await logEvent(c.userId, "ops", `Operations: цикл агента запущен вручную (${admin.email})`, null, r);
  revalidatePath("/admin");
}

export type IngestState = { report?: Record<string, number | string>; at?: string; error?: string } | undefined;

export async function adminIngest(_: IngestState, form: FormData): Promise<IngestState> {
  await requireAdmin();
  const q = String(form.get("q") ?? "").trim().slice(0, 60);
  try {
    const report = await ingestLive(q);
    revalidatePath("/admin");
    return { report, at: new Date().toISOString() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ошибка загрузки" };
  }
}
