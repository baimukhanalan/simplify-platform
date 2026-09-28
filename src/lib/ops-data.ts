// Agent C — shared read-side queries for the campaign operating screens.
import "server-only";
import { db } from "./db";

/** The campaign the operating screens show: the latest non-draft one (active, paused, hired or expired). */
export function currentCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: { not: "draft" } }, orderBy: { createdAt: "desc" } });
}
