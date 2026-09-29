"use server";
// Simplify Apply Assist (browser extension) pairing: one key per user. The raw key is shown once; only its sha256 is
// stored (Integration.tokenHash, provider "extension"). Creating a new key replaces the old one; revoking deletes it.
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, s } from "../db";
import { randomToken, sha256 } from "../crypto";
import { rateLimitUser, retryText } from "../rate-limit";
import { logEvent } from "../engine/agent";

export type ExtensionTokenState = { token?: string; error?: string };

export async function createExtensionToken(): Promise<ExtensionTokenState> {
  const user = await requireUser();
  const rl = await rateLimitUser("ext-token", user.id, 10, 60 * 60 * 1000);
  if (!rl.ok) return { error: retryText(rl.retryAfter) };
  const token = randomToken(32);
  const tokenHash = sha256(token);
  const meta = s({ createdAt: new Date().toISOString() });
  await db.integration.upsert({
    where: { userId_provider: { userId: user.id, provider: "extension" } },
    create: { userId: user.id, provider: "extension", tokenHash, meta },
    update: { tokenHash, meta, accessToken: "", refreshToken: "" },
  });
  await logEvent(user.id, "extension", "Создан ключ для расширения Apply Assist");
  revalidatePath("/app/extension");
  return { token };
}

export async function revokeExtensionToken() {
  const user = await requireUser();
  const { count } = await db.integration.deleteMany({ where: { userId: user.id, provider: "extension" } });
  if (count) await logEvent(user.id, "extension", "Ключ расширения Apply Assist отозван");
  revalidatePath("/app/extension");
}
