"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "../auth";
import { db } from "../db";
import { runTick, logEvent } from "../engine/agent";
import { ingestLive, type IngestReport } from "../engine/ingest";

export async function adminRunTick(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("campaignId") ?? "");
  const c = await db.campaign.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!c) return;
  const r = await runTick(c.id);
  await logEvent(c.userId, "ops", `Operations: цикл агента запущен вручную (${admin.email})`, null, r);
  revalidatePath("/admin");
}

/** Manual ingest from /admin: fetch + write must finish before the page's maxDuration. */
const ADMIN_INGEST_BUDGET_MS = 150_000;

export type IngestState = { report?: IngestReport; at?: string; error?: string } | undefined;

export async function adminIngest(_: IngestState, form: FormData): Promise<IngestState> {
  await requireAdmin();
  const q = String(form.get("q") ?? "").trim().slice(0, 60);
  try {
    // Well inside the admin page's maxDuration (300 s), whatever SIMPLIFY_INGEST_BUDGET_MS says for the cron.
    const report = await ingestLive(q, { budgetMs: ADMIN_INGEST_BUDGET_MS });
    revalidatePath("/admin");
    return { report, at: new Date().toISOString() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ошибка загрузки" };
  }
}
