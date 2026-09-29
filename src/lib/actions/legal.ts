"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { recordLegalAcceptance } from "../legal-db";

/** The in-app acceptance banner (accounts created before the current terms / privacy / consent versions). */
export async function acceptLegal(): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const r = await recordLegalAcceptance(user.id);
  if (r === "accepted") revalidatePath("/app", "layout");
  return { ok: r === "accepted" || r === "already" };
}
