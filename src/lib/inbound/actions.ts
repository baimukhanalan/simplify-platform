"use server";
// «Пересылка писем» card actions. Always the session user's own alias.
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { rateLimitUser, retryMinutes } from "../rate-limit";
import { actionT } from "../i18n/action";
import { aliasAddress } from "./alias";
import { dismissVerification, forwardingState, regenerateAlias } from "./service";

export type RegenerateState = { address?: string; error?: string };

/** «Сменить адрес»: issue a new alias; the old address stops receiving immediately. */
export async function regenerateInboxAlias(): Promise<RegenerateState> {
  const user = await requireUser();
  const t = await actionT();
  if (forwardingState() === "off") return { error: t("actionMsg.unavailable") };
  const rl = await rateLimitUser("inbound-regenerate", user.id, 5, 3600000);
  if (!rl.ok) return { error: t("actionMsg.tooOften", { n: retryMinutes(rl.retryAfter) }) };
  try {
    const alias = await regenerateAlias(user.id);
    revalidatePath("/app/inbox");
    return { address: aliasAddress(alias) };
  } catch (e) {
    console.error("[inbound] regenerate failed", e);
    return { error: t("actionMsg.aliasFailed") };
  }
}

/** Hide a forwarding confirmation once the user has finished it. */
export async function dismissForwardingCode(): Promise<void> {
  const user = await requireUser();
  await dismissVerification(user.id);
  revalidatePath("/app/inbox");
}
