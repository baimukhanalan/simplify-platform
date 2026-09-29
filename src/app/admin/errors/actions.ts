"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { resolveErrorById } from "@/lib/monitoring/admin";

const Id = z.string().trim().min(1).max(64).regex(/^[\w-]+$/);

/** «Решено»: closes the error group. It re-opens by itself if the error happens again. */
export async function resolveError(form: FormData) {
  await requireAdmin();
  const id = Id.safeParse(form.get("id"));
  if (!id.success) return;
  await resolveErrorById(id.data);
  revalidatePath("/admin/errors");
  revalidatePath(`/admin/errors/${id.data}`);
}
