"use server";
// In-app push moments: dismiss or follow a notification. Always owner-scoped.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db } from "../db";
import { resolveNotification } from "../ops-data";

const idOf = (form: FormData) => String(form.get("id") ?? "").trim();

export async function dismissNotification(form: FormData) {
  const user = await requireUser();
  const id = idOf(form);
  if (!id) return;
  await db.notification.updateMany({ where: { id, userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/app", "layout");
}

/** Mark read and go where the moment points (the target is resolved server-side, never taken from the form). */
export async function openNotification(form: FormData) {
  const user = await requireUser();
  const n = await db.notification.findFirst({ where: { id: idOf(form), userId: user.id } });
  if (!n) redirect("/app");
  if (!n.readAt) await db.notification.update({ where: { id: n.id }, data: { readAt: new Date() } });
  const target = await resolveNotification(n);
  revalidatePath("/app", "layout");
  redirect(target.href);
}
