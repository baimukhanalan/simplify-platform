// The full address of one user for an admin (the «показать» click in /admin/users), audited. Not a server action: the
// caller (actions/admin.ts adminRevealEmail) has already checked requireAdmin and passes the admin's id.
import "server-only";
import { z } from "zod";
import { db } from "../db";
import { logEvent } from "../engine/agent";

export const REVEAL_EVENT = "admin_reveal_email";
const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);

/** Every reveal is recorded in the admin's own event log: who looked at whose address (ids only, never the address). */
export async function revealEmailFor(adminId: string, userId: string): Promise<{ email?: string; error?: string }> {
  const id = idSchema.safeParse(userId);
  if (!id.success) return { error: "Неверный идентификатор" };
  const u = await db.user.findUnique({ where: { id: id.data }, select: { id: true, email: true } });
  if (!u) return { error: "Пользователь не найден" };
  await logEvent(adminId, REVEAL_EVENT, "Админ открыл e-mail пользователя", null, { adminId, targetId: u.id });
  return { email: u.email };
}
