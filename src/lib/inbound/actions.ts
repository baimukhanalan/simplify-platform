"use server";
// «Пересылка писем» card actions. Always the session user's own alias.
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { rateLimitUser, retryText } from "../rate-limit";
import { aliasAddress } from "./alias";
import { dismissVerification, forwardingState, regenerateAlias } from "./service";

export type RegenerateState = { address?: string; error?: string };

/** «Сменить адрес»: issue a new alias; the old address stops receiving immediately. */
export async function regenerateInboxAlias(): Promise<RegenerateState> {
  const user = await requireUser();
  if (forwardingState() === "off") return { error: "Сейчас недоступно." };
  const rl = await rateLimitUser("inbound-regenerate", user.id, 5, 3600000);
  if (!rl.ok) return { error: retryText(rl.retryAfter) };
  try {
    const alias = await regenerateAlias(user.id);
    revalidatePath("/app/inbox");
    return { address: aliasAddress(alias) };
  } catch (e) {
    console.error("[inbound] regenerate failed", e);
    return { error: "Не получилось сменить адрес. Попробуй ещё раз." };
  }
}

/** Hide a forwarding confirmation once the user has finished it. */
export async function dismissForwardingCode(): Promise<void> {
  const user = await requireUser();
  await dismissVerification(user.id);
  revalidatePath("/app/inbox");
}
