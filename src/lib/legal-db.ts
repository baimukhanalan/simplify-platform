import "server-only";
import { db } from "./db";
import { mergeLegalConsents, needsLegalAcceptance } from "./legal";

/**
 * Records acceptance of the current terms / privacy / consent versions in User.consents.legal, keeping every other
 * consent key. Compare-and-swap on the previous JSON, so a concurrent settings save in another tab is never overwritten.
 * Idempotent: returns "already" when the current versions are accepted (double submit, two tabs).
 */
export async function recordLegalAcceptance(userId: string): Promise<"accepted" | "already" | "missing" | "busy"> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db.user.findUnique({ where: { id: userId }, select: { consents: true } });
    if (!row) return "missing";
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(row.consents);
    } catch {
      /* malformed → treated as not accepted */
    }
    if (!needsLegalAcceptance(parsed)) return "already";
    const { count } = await db.user.updateMany({ where: { id: userId, consents: row.consents }, data: { consents: mergeLegalConsents(row.consents) } });
    if (count === 1) {
      await db.event.create({ data: { userId, type: "legal_accepted", message: "Приняты пользовательское соглашение, политика конфиденциальности и согласие на обработку данных" } });
      return "accepted";
    }
  }
  return "busy";
}
