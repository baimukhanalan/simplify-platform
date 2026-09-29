// The interview guarantee (public offer): «Если за время кампании не было ни одного приглашения на интервью, кампания
// продлевается на 30 дней бесплатно — один раз на кампанию.» Checked at the campaign's end (endsAt), which referral
// bonus days may have moved — hence «за время кампании», not a fixed number of days.
//
// Campaign length is derived from endsAt everywhere (app layout, Today's campaignDay, the campaign page clock), so the
// extension is endsAt += GUARANTEE_DAYS, bonusDays += GUARANTEE_DAYS, guaranteeStatus = "extended". It is applied the
// moment a campaign is decided to be over — by the agent cycle (runTick), by a Kaspi activation that finds an overdue
// campaign, and lazily whenever the user's app screens load (settleGuarantees) — always BEFORE the campaign is expired.
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { visibleOpportunities } from "../mode";
import { INERT_SOURCES } from "../inbound/filter";
import { INTERVIEW_STATUSES } from "./taxonomy";

export const GUARANTEE_DAYS = 30;
const DAY = 86400000;

/** Statuses that prove an interview invitation (the same set as reachedInterview in insights.ts): an interview round, offer, hired. */
export const INTERVIEW_REACHED_STATUSES = [...INTERVIEW_STATUSES, "offer", "hired"];

type Client = typeof db | Prisma.TransactionClient;
export type GuaranteeCampaign = { id: string; status: string; endsAt: Date | null; hiredAt?: Date | null; guaranteeStatus: string };

/**
 * The date-and-status half of eligibility (no DB): the campaign reached its end (endsAt ≤ now) while still active or
 * paused, nobody was hired, and the guarantee wasn't used yet. Draft / expired / hired campaigns never qualify.
 */
export const guaranteeDue = (c: GuaranteeCampaign, now = new Date()) =>
  (c.status === "active" || c.status === "paused") && c.endsAt != null && c.endsAt <= now && !c.hiredAt && c.guaranteeStatus === "";

/**
 * At least one interview invitation during the campaign. Every row below belongs to one of the campaign's opportunities,
 * so it happened during the campaign:
 *   · an opportunity at an interview stage or later (recruiter / hiring_manager / technical / final / offer / hired) —
 *     the reachedInterview rule of insights.ts;
 *   · an opportunity that EVER reached such a stage: a status_change (manual move) or inbox (employer mail) event with
 *     `to` in that set — moving a card back afterwards doesn't bring the guarantee back;
 *   · an Interview row of a real round (assessments never count) — kept even if the role was later rejected;
 *   · an Offer row linked to one of the campaign's roles;
 *   · an authoritative employer email classified "interview" linked to one of the campaign's roles (forwarded letters
 *     that were not verified — INERT_SOURCES — never count).
 * Simulation mode: the internal corpus only (visibleOpportunities) — the same roles the user sees.
 */
export async function hadInterview(campaignId: string, client: Client = db) {
  const opp = visibleOpportunities({ campaignId });
  const reached = INTERVIEW_REACHED_STATUSES.map((st) => ({ data: { contains: `"to":"${st}"` } }));
  const [byStatus, byEvent, byRow, byOffer, byMail] = await Promise.all([
    client.opportunity.count({ where: { ...opp, status: { in: INTERVIEW_REACHED_STATUSES } } }),
    client.event.count({ where: { type: { in: ["status_change", "inbox"] }, opportunity: opp, OR: reached } }),
    client.interview.count({ where: { round: { not: "assessment" }, opportunity: opp } }),
    client.offer.count({ where: { opportunity: opp } }),
    client.inboxMessage.count({ where: { classification: "interview", source: { notIn: INERT_SOURCES }, opportunity: opp } }),
  ]);
  return byStatus + byEvent + byRow + byOffer + byMail > 0;
}

/** Full eligibility: guaranteeDue and not a single interview invitation during the campaign. */
export async function guaranteeEligible(c: GuaranteeCampaign, now = new Date(), client: Client = db) {
  return guaranteeDue(c, now) && !(await hadInterview(c.id, client));
}

export type GuaranteeResult = { applied: false } | { applied: true; userId: string; endsAt: Date };

/**
 * The extension itself, on any client (a transaction too). Atomic and idempotent: one conditional updateMany on
 * guaranteeStatus "" (and the endsAt that was read) — concurrent callers (two cron ticks, a tick and a page load) extend
 * exactly once; the losers get { applied: false }. Does not announce: callers run announceGuarantee after commit.
 */
export async function applyGuaranteeWith(client: Client, campaignId: string, now = new Date()): Promise<GuaranteeResult> {
  const c = await client.campaign.findUnique({ where: { id: campaignId }, select: { id: true, userId: true, status: true, endsAt: true, hiredAt: true, guaranteeStatus: true } });
  if (!c || !c.endsAt || !(await guaranteeEligible(c, now, client))) return { applied: false };
  // From max(endsAt, now): a campaign noticed late (no tick for days) still gets 30 real days, never an end in the past.
  const endsAt = new Date(Math.max(c.endsAt.getTime(), now.getTime()) + GUARANTEE_DAYS * DAY);
  const moved = await client.campaign.updateMany({
    where: { id: c.id, guaranteeStatus: "", status: { in: ["active", "paused"] }, hiredAt: null, endsAt: c.endsAt },
    data: { endsAt, bonusDays: { increment: GUARANTEE_DAYS }, guaranteeStatus: "extended", guaranteeExtendedAt: now },
  });
  return moved.count ? { applied: true, userId: c.userId, endsAt } : { applied: false };
}

/** The notification title (also how Today tells the moment layer is already showing this news). */
export const GUARANTEE_TITLE = "Интервью пока не было — продлили кампанию на 30 дней бесплатно";

const dateRu = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "Asia/Almaty", day: "numeric", month: "long" });

/** The journal line and the notification of an applied extension (once — only the caller that won applyGuaranteeWith). */
export async function announceGuarantee(r: GuaranteeResult, campaignId: string) {
  if (!r.applied) return;
  const { logEvent, notify } = await import("./agent");
  await logEvent(r.userId, "campaign_guarantee", `Гарантия интервью: за время кампании приглашений на интервью не было — кампания продлена на ${GUARANTEE_DAYS} дней бесплатно, до ${dateRu(r.endsAt)}`, null, { campaignId, days: GUARANTEE_DAYS, endsAt: r.endsAt.toISOString() });
  await notify(r.userId, "info", GUARANTEE_TITLE, `Агент продолжает поиск до ${dateRu(r.endsAt)}. Это гарантия интервью — она действует один раз на кампанию.`, "/app/campaign");
}

/** Apply the guarantee to one campaign if it is eligible; announces it. Safe to call any number of times, concurrently. */
export async function applyGuarantee(campaignId: string, now = new Date()) {
  const r = await applyGuaranteeWith(db, campaignId, now);
  await announceGuarantee(r, campaignId);
  return r;
}

/**
 * Lazy settle for the user's screens: every campaign of the user that reached its end without the guarantee applied
 * gets it now if eligible, so an overdue-but-eligible campaign never looks "expired" between its end time and the next
 * agent cycle. One indexed query when there is nothing to do (the common case).
 */
export async function settleGuarantees(userId: string, now = new Date()) {
  const due = await db.campaign.findMany({
    where: { userId, status: { in: ["active", "paused"] }, endsAt: { lte: now }, hiredAt: null, guaranteeStatus: "" },
    select: { id: true },
  });
  let applied = 0;
  for (const c of due) if ((await applyGuarantee(c.id, now)).applied) applied++;
  return applied;
}

/**
 * What the campaign page shows in «Гарантия интервью»:
 *   extended  — the campaign was extended (chip «Кампания продлена по гарантии до <дата>»)
 *   not-needed — an interview invitation already happened
 *   promise   — no interview yet: «Если интервью не будет до <дата>, продлим на 30 дней»
 */
export type GuaranteeView = { state: "extended" | "not-needed" | "promise"; until: Date | null; extendedAt: Date | null };

export async function guaranteeView(c: { id: string; endsAt: Date | null; guaranteeStatus: string; guaranteeExtendedAt: Date | null }): Promise<GuaranteeView> {
  if (c.guaranteeStatus === "extended") return { state: "extended", until: c.endsAt, extendedAt: c.guaranteeExtendedAt };
  return { state: (await hadInterview(c.id)) ? "not-needed" : "promise", until: c.endsAt, extendedAt: null };
}

/** Today's calm banner: shown only in the first days after an extension. */
export const GUARANTEE_BANNER_DAYS = 3;
export const showGuaranteeBanner = (c: { guaranteeStatus: string; guaranteeExtendedAt: Date | null; status: string }, now = Date.now()) =>
  c.guaranteeStatus === "extended" && c.guaranteeExtendedAt != null && (c.status === "active" || c.status === "paused") &&
  now - c.guaranteeExtendedAt.getTime() < GUARANTEE_BANNER_DAYS * DAY;
