// «День X из Y» of a campaign — one formula for the app (layout, Today, campaign page, Telegram /status) and /admin.
// Pure module: safe anywhere.

const DAY = 86400000;

/**
 * Day 1 is the start day (floor + 1); Y comes from the dates (plan days + bonus days are already in endsAt), X is
 * clamped into 1..Y. Without endsAt the total is planDays + bonusDays. The start is startedAt, else createdAt.
 */
export function campaignDay(c: { startedAt: Date | null; createdAt?: Date | null; endsAt: Date | null; bonusDays?: number }, now = Date.now(), planDays = 60) {
  const startAt = c.startedAt ?? c.createdAt ?? null;
  const start = startAt ? startAt.getTime() : now;
  const total = c.endsAt ? Math.max(1, Math.round((c.endsAt.getTime() - start) / DAY)) : planDays + (c.bonusDays ?? 0);
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / DAY) + 1));
  return { day, total };
}
