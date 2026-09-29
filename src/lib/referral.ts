import "server-only";
import { randomInt } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db, isPostgres, j } from "./db";
import { runningCampaignWhere } from "./ops-data";
import { logEvent, notify } from "./engine/agent";
import { settleGuarantees } from "./engine/guarantee";

/**
 * «Приведи друга». Terms (mirrored in the public offer):
 *  - the invited friend gets 10% off their FIRST campaign (rounded to the nearest 10 ₸: 29 990 → 26 990 ₸);
 *  - the referrer gets +15 days on the running campaign after the friend's first successful payment; with no running
 *    campaign the days are credited and applied when the referrer's next campaign starts;
 *  - one reward per invited user (Referral.referredUserId is unique); no self-referral.
 *
 * Lifecycle of a Referral row: signed_up (friend registered with the code) → paid (friend's first campaign started,
 * marked in the same transaction that creates it) → rewarded (days added to one of the referrer's campaigns).
 * Refunds: a refunded friend payment does NOT claw the days back — the reward stays (kept simple on purpose).
 *
 * Codes: «NAME-7K2Q» (Latin name prefix + 4 unambiguous characters). Partner codes (Partner.code, e.g. AMASKILLS) live in
 * the same «ref» namespace: a partner code always wins, a referral code is never issued if it equals a partner code, and
 * referral signups never touch User.referredByCode — that field stays partner-only, so revenue share is unaffected.
 */

export const REFERRAL_DISCOUNT_PCT = 10;
export const REFERRAL_REWARD_DAYS = 15;
export const REFERRAL_COOKIE = "simplify_ref";
export const REFERRAL_COOKIE_MAX_AGE = 30 * 86400;
const DAY = 86400000;

/** No 0/O, 1/I/L — codes are read aloud and typed from screenshots. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const REFERRAL_CODE_RE = /^[A-Z]{2,10}-[2-9A-HJKMNP-Z]{4}$/;

/** Upper-case, trimmed; anything that isn't a plausible code (partner or referral) is null. */
export function normalizeCode(raw: unknown): string | null {
  const code = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,32}$/.test(code) ? code : null;
}

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};

/** «Алан Баймухан» → ALAN, «Aruzhan Sadykova» → ARUZHAN; too short or not a name → FRIEND. */
export function codePrefix(name: string) {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const latin = [...first.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")].map((ch) => TRANSLIT[ch] ?? ch).join("").toUpperCase().replace(/[^A-Z]/g, "");
  return latin.length >= 2 ? latin.slice(0, 10) : "FRIEND";
}

export const randomSuffix = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * The user's invite code, created on first use. Uniqueness is enforced here (the column is indexed, not unique):
 * a candidate must not be taken by another user or by a partner; after writing, if a concurrent writer picked the same
 * code, the user with the smaller id keeps it and the other retries.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true, name: true } });
    if (u.referralCode) {
      const holders = await db.user.findMany({ where: { referralCode: u.referralCode }, select: { id: true }, orderBy: { id: "asc" }, take: 2 });
      if (holders.length < 2 || holders[0].id === userId) return u.referralCode;
      // Lost a race for this code: drop it (only if still ours) and pick another.
      await db.user.updateMany({ where: { id: userId, referralCode: u.referralCode }, data: { referralCode: null } });
      continue;
    }
    const candidate = `${codePrefix(u.name)}-${randomSuffix()}`;
    const [taken, partner] = await Promise.all([
      db.user.findFirst({ where: { referralCode: candidate }, select: { id: true } }),
      db.partner.findUnique({ where: { code: candidate }, select: { id: true } }),
    ]);
    if (taken || partner) continue;
    await db.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: candidate } });
  }
  throw new Error("could not allocate a referral code");
}

/** The referrer behind a code — null for unknown codes and for partner codes (a partner code is never a friend invite). */
export async function findReferrer(rawCode: unknown) {
  const code = normalizeCode(rawCode);
  if (!code || !REFERRAL_CODE_RE.test(code)) return null;
  if (await db.partner.findUnique({ where: { code }, select: { id: true } })) return null;
  const rows = await db.user.findMany({ where: { referralCode: code }, select: { id: true, name: true, email: true }, orderBy: { id: "asc" }, take: 1 });
  return rows[0] ?? null;
}

/** Same mailbox under a different spelling: case, «+tag», and dots in a Gmail local part. */
export function canonicalEmail(email: string) {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base = local.split("+")[0];
  const d = domain === "googlemail.com" ? "gmail.com" : domain;
  return `${d === "gmail.com" ? base.replace(/\./g, "") : base}@${d}`;
}

export const firstName = (name: string) => (name ?? "").trim().split(/\s+/)[0] || "Друг";

/**
 * Signup: records who invited the new user. Ignores unknown/partner codes and self-referral (same account or the same
 * mailbox). Idempotent — one Referral per invited user (unique index). Never throws: a referral problem must not fail
 * the signup.
 */
export async function attachReferral(newUserId: string, rawCode: unknown): Promise<"attached" | "ignored" | "self"> {
  try {
    const code = normalizeCode(rawCode);
    const referrer = await findReferrer(code);
    if (!code || !referrer) return "ignored";
    const me = await db.user.findUnique({ where: { id: newUserId }, select: { email: true } });
    if (!me) return "ignored";
    if (referrer.id === newUserId || canonicalEmail(referrer.email) === canonicalEmail(me.email)) return "self";
    await db.referral.create({ data: { referrerId: referrer.id, referredUserId: newUserId, code, status: "signed_up" } });
    await logEvent(newUserId, "referral_signup", `Регистрация по приглашению друга (${firstName(referrer.name)})`);
    return "attached";
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return "ignored"; // already attributed (double submit)
    console.error("[referral] attach failed", e);
    return "ignored";
  }
}

/** 10% off, rounded to the nearest 10 ₸ (29 990 → 26 990, 49 990 → 44 990). The one formula used everywhere. */
export function referralPrice(fullKzt: number) {
  const amount = Math.round((fullKzt * (100 - REFERRAL_DISCOUNT_PCT)) / 100 / 10) * 10;
  return { amount, discountKzt: fullKzt - amount };
}

export type ReferralOffer = { pct: number; referrerName: string };

/**
 * The friend's discount, if it still applies: invited, not yet paid, and no paid payment / started campaign before
 * (the discount is for the first campaign only).
 */
export async function referralOfferFor(userId: string): Promise<ReferralOffer | null> {
  const r = await db.referral.findUnique({ where: { referredUserId: userId }, select: { status: true, referrer: { select: { name: true } } } });
  if (!r || r.status !== "signed_up") return null;
  const [paid, campaigns] = await Promise.all([
    db.payment.count({ where: { userId, status: "paid" } }),
    db.campaign.count({ where: { userId, status: { not: "draft" } } }),
  ]);
  if (paid || campaigns) return null;
  return { pct: REFERRAL_DISCOUNT_PCT, referrerName: firstName(r.referrer.name) };
}

/** What Payment.meta.referral holds for a discounted invoice. */
export type ReferralMeta = { fullKzt: number; discountKzt: number; pct: number; from: string };

/** Discount details of an invoice for the checkout (struck-through price + «−10% по приглашению …»), or null. */
export function referralDiscountOf(metaJson: string): (ReferralMeta & { label: string }) | null {
  const m = j<{ referral?: Partial<ReferralMeta> }>(metaJson, {}).referral;
  if (!m || typeof m.fullKzt !== "number" || typeof m.discountKzt !== "number" || m.discountKzt <= 0) return null;
  const pct = typeof m.pct === "number" ? m.pct : REFERRAL_DISCOUNT_PCT;
  const from = typeof m.from === "string" && m.from ? m.from : "друга";
  return { fullKzt: m.fullKzt, discountKzt: m.discountKzt, pct, from, label: `−${pct}% по приглашению · ${from}` };
}

type Tx = Prisma.TransactionClient;

/** Same per-user serialization as the payment code (Postgres row lock; SQLite: take the write lock first). */
async function lockUser(tx: Tx, userId: string) {
  if (isPostgres) await tx.$queryRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  else await tx.$executeRaw`UPDATE "User" SET "careerMode" = "careerMode" WHERE "id" = ${userId}`;
}

/**
 * Inside the transaction that starts the invited user's campaign (caller holds that user's lock): signed_up → paid,
 * once. Returns the referral id when THIS call made the transition (the caller then rewards the referrer), else null.
 */
export async function markReferralPaid(tx: Tx, referredUserId: string, paymentMetaJson: string): Promise<string | null> {
  const discountKzt = referralDiscountOf(paymentMetaJson)?.discountKzt ?? 0;
  const r = await tx.referral.updateMany({ where: { referredUserId, status: "signed_up" }, data: { status: "paid", discountKzt } });
  if (!r.count) return null;
  const row = await tx.referral.findUnique({ where: { referredUserId }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Moves a campaign's end by `days` and books them as bonus days (campaign length is always derived from endsAt).
 * Compare-and-swap on the endsAt that was read: a concurrent writer (the interview guarantee, which doesn't take the
 * user lock) is never overwritten — on a conflict re-read and add the days on top of its value.
 */
export async function extendCampaign(tx: Tx | typeof db, campaignId: string, days: number) {
  for (let attempt = 0; attempt < 25; attempt++) {
    const c = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { endsAt: true } });
    const moved = await tx.campaign.updateMany({
      where: { id: campaignId, endsAt: c.endsAt },
      data: { bonusDays: { increment: days }, ...(c.endsAt ? { endsAt: new Date(c.endsAt.getTime() + days * DAY) } : {}) },
    });
    if (moved.count) return;
    await new Promise((r) => setTimeout(r, Math.min(50, 2 * attempt) + Math.random() * 5)); // short jittered backoff
  }
  throw new Error(`could not extend campaign ${campaignId}: endsAt keeps changing`);
}

/**
 * Inside the transaction that creates a campaign for `userId` (caller holds the user's lock): every credited reward
 * (status paid — the friend paid while this user had no running campaign) is applied to the new campaign.
 * Returns the number of days added.
 */
export async function applyDeferredReferralCredit(tx: Tx, userId: string, campaignId: string, now = new Date()): Promise<number> {
  const pending = await tx.referral.findMany({ where: { referrerId: userId, status: "paid" }, select: { id: true } });
  let n = 0;
  for (const p of pending) {
    n += (await tx.referral.updateMany({ where: { id: p.id, status: "paid" }, data: { status: "rewarded", rewardDays: REFERRAL_REWARD_DAYS, rewardedAt: now } })).count;
  }
  if (n) await extendCampaign(tx, campaignId, n * REFERRAL_REWARD_DAYS);
  return n * REFERRAL_REWARD_DAYS;
}

/**
 * After the friend's payment committed: rewards the referrer under the referrer's lock. Running campaign → +15 days now
 * (status rewarded); none → stays «paid», applied by applyDeferredReferralCredit when the next campaign starts.
 * Idempotent: only a paid → rewarded transition extends a campaign.
 */
export async function rewardReferrer(referralId: string): Promise<"rewarded" | "deferred" | "noop"> {
  const found = await db.referral.findUnique({ where: { id: referralId }, select: { referrerId: true } });
  if (!found) return "noop";
  const referrerId = found.referrerId;
  // An overdue campaign the interview guarantee is due to extend counts as running (as everywhere else): settle it first,
  // outside the transaction (settleGuarantees writes through the shared client).
  await settleGuarantees(referrerId).catch((e) => console.error("[referral] guarantee settle failed", e));
  const r = await db.$transaction(async (tx) => {
    await lockUser(tx, referrerId);
    const ref = await tx.referral.findUnique({ where: { id: referralId }, select: { status: true } });
    if (ref?.status !== "paid") return "noop" as const;
    const now = new Date();
    const running = await tx.campaign.findFirst({ where: { userId: referrerId, ...runningCampaignWhere(now) }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!running) return "deferred" as const;
    const upd = await tx.referral.updateMany({ where: { id: referralId, status: "paid" }, data: { status: "rewarded", rewardDays: REFERRAL_REWARD_DAYS, rewardedAt: now } });
    if (!upd.count) return "noop" as const;
    await extendCampaign(tx, running.id, REFERRAL_REWARD_DAYS);
    return "rewarded" as const;
  });
  if (r === "rewarded") {
    await logEvent(referrerId, "referral_reward", `Друг оплатил кампанию — к твоей добавлено ${REFERRAL_REWARD_DAYS} дней`);
    await notify(referrerId, "info", `Друг оплатил кампанию — +${REFERRAL_REWARD_DAYS} дней к твоей`, "Спасибо за приглашение. Дата окончания кампании уже сдвинута.", "/app/referral");
  } else if (r === "deferred") {
    await logEvent(referrerId, "referral_credit", `Друг оплатил кампанию — ${REFERRAL_REWARD_DAYS} дней добавятся к следующей кампании`);
    await notify(referrerId, "info", `Друг оплатил кампанию — +${REFERRAL_REWARD_DAYS} дней для тебя`, "Дни зачислены и добавятся, когда начнётся твоя следующая кампания.", "/app/referral");
  }
  return r;
}

/** Called after a new campaign committed with credited days (for the activity log and a notification). */
export async function announceDeferredCredit(userId: string, days: number) {
  if (days <= 0) return;
  await logEvent(userId, "referral_reward", `К кампании добавлено ${days} дней за приглашённых друзей`);
  await notify(userId, "info", `+${days} дней к кампании`, "Бонус за приглашённых друзей применён к новой кампании.", "/app/referral");
}

/** «d•••a@gmail.com» — enough for the referrer to recognise a friend, not enough to harvest an address. */
export function maskEmail(email: string) {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : "";
  return `${head}•••${tail}@${domain}`;
}

/** «Dana E.» from a stored full name. */
export function shortName(name: string) {
  const [first = "", second = ""] = (name ?? "").trim().split(/\s+/);
  return second ? `${first} ${second[0].toUpperCase()}.` : first || "Друг";
}

export type ReferralOverview = {
  code: string;
  stats: { invited: number; paid: number; daysEarned: number; daysPending: number };
  friends: { id: string; name: string; email: string; status: "signed_up" | "paid" | "rewarded"; createdAt: Date; rewardedAt: Date | null }[];
};

/** Everything the «Пригласи друга» page shows — only this user's own referrals, friends' data masked. */
export async function referralOverview(userId: string): Promise<ReferralOverview> {
  const code = await ensureReferralCode(userId);
  const rows = await db.referral.findMany({
    where: { referrerId: userId }, orderBy: { createdAt: "desc" }, take: 200,
    select: { id: true, status: true, rewardDays: true, createdAt: true, rewardedAt: true, referred: { select: { name: true, email: true } } },
  });
  const friends = rows.map((r) => ({
    id: r.id, name: shortName(r.referred.name), email: maskEmail(r.referred.email),
    status: (r.status === "rewarded" || r.status === "paid" ? r.status : "signed_up") as ReferralOverview["friends"][number]["status"],
    createdAt: r.createdAt, rewardedAt: r.rewardedAt,
  }));
  const [invited, paid, earned, pending] = await Promise.all([
    db.referral.count({ where: { referrerId: userId } }),
    db.referral.count({ where: { referrerId: userId, status: { in: ["paid", "rewarded"] } } }),
    db.referral.aggregate({ where: { referrerId: userId, status: "rewarded" }, _sum: { rewardDays: true } }),
    db.referral.count({ where: { referrerId: userId, status: "paid" } }),
  ]);
  return { code, stats: { invited, paid, daysEarned: earned._sum.rewardDays ?? 0, daysPending: pending * REFERRAL_REWARD_DAYS }, friends };
}

/** Public base URL for invite links (same rule as the payment webhook base; dev falls back to the request host). */
export function appOrigin(fallbackHost?: string | null) {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return fallbackHost ? `${/^(localhost|127\.)/.test(fallbackHost) ? "http" : "https"}://${fallbackHost}` : "https://app.wesimplify.works";
}
