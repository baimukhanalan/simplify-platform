"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentUserId } from "../auth";
import { rateLimit, rateLimitUser } from "../rate-limit";
import { LOCALES } from "../i18n/config";
import { applyLocale } from "../i18n/persist";

const Input = z.enum(LOCALES);

/**
 * The language switcher: remembers the choice in the `locale` cookie and, when signed in, in User.locale
 * (only the session's own row). Signed-out visitors (login, public pages) get the cookie only.
 */
export async function setLocale(raw: unknown): Promise<{ ok: boolean }> {
  const parsed = Input.safeParse(raw);
  if (!parsed.success) return { ok: false };
  const userId = await currentUserId();
  const rl = userId ? await rateLimitUser("locale", userId, 30, 60_000) : await rateLimit("locale", 30, 60_000);
  if (!rl.ok) return { ok: false };
  const res = await applyLocale(userId, parsed.data, await cookies());
  if (res.ok) revalidatePath("/", "layout");
  return { ok: res.ok };
}
