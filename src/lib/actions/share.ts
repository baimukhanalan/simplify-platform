"use server";
import { randomBytes } from "node:crypto";
import { requireUser } from "../auth";
import { db } from "../db";
import { logEvent } from "../engine/agent";

export type ShareResult = { ok: true; path: string } | { ok: false; error: string };

/**
 * Creates (or reuses) the public share token for the user's latest HIRED campaign.
 * Returns a same-origin path; the client turns it into an absolute URL with its own origin.
 */
export async function createShareLink(): Promise<ShareResult> {
  const user = await requireUser();
  const campaign = await db.campaign.findFirst({ where: { userId: user.id, status: "hired" }, orderBy: { hiredAt: "desc" } });
  if (!campaign) return { ok: false, error: "Ссылка появится после статуса HIRED." };
  if (campaign.shareToken) return { ok: true, path: `/share/${campaign.shareToken}` };

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomBytes(18).toString("base64url"); // 24 url-safe chars, 144 bits
    try {
      // Only set it if nobody (e.g. a parallel click) already did.
      const res = await db.campaign.updateMany({ where: { id: campaign.id, userId: user.id, shareToken: null }, data: { shareToken: token } });
      if (res.count === 0) {
        const fresh = await db.campaign.findUnique({ where: { id: campaign.id }, select: { shareToken: true } });
        if (fresh?.shareToken) return { ok: true, path: `/share/${fresh.shareToken}` };
        continue;
      }
      await logEvent(user.id, "share_created", "Создана публичная ссылка на Simplify journey");
      return { ok: true, path: `/share/${token}` };
    } catch {
      // unique collision — astronomically unlikely, retry with a new token
    }
  }
  return { ok: false, error: "Не удалось создать ссылку. Попробуйте ещё раз." };
}
