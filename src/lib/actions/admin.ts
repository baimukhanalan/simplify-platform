"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ADMIN_SEARCH_COOKIE } from "../admin/metrics";
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
  revalidatePath("/admin", "layout"); // every admin page (overview, stuck campaigns, ops) reads campaign state
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
    revalidatePath("/admin", "layout");
    return { report, at: new Date().toISOString() };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Ошибка загрузки" };
  }
}

/* ——— Admin panel: user search and e-mail reveal ——— */

const searchSchema = z.object({ q: z.string().max(5000).transform((v) => v.trim().slice(0, 100)) });

export async function adminUserSearch(form: FormData) {
  await requireAdmin();
  const parsed = searchSchema.safeParse({ q: String(form.get("q") ?? "") });
  const q = parsed.success ? parsed.data.q : "";
  const jar = await cookies();
  if (q) jar.set(ADMIN_SEARCH_COOKIE, q, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/admin", maxAge: 60 * 60 });
  else jar.delete({ name: ADMIN_SEARCH_COOKIE, path: "/admin" });
  redirect("/admin/users");
}

const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** The full address of one user, on an explicit «показать» click in the admin panel. */
export async function adminRevealEmail(userId: string): Promise<{ email?: string; error?: string }> {
  await requireAdmin();
  const id = idSchema.safeParse(userId);
  if (!id.success) return { error: "Неверный идентификатор" };
  const u = await db.user.findUnique({ where: { id: id.data }, select: { email: true } });
  return u ? { email: u.email } : { error: "Пользователь не найден" };
}
