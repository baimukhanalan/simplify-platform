import "server-only";
// Personal forwarding address → Inbox Intelligence. The user auto-forwards employer mail from Gmail / Outlook / Mail.ru /
// Yandex to <alias>@<INBOUND_EMAIL_DOMAIN>; the provider (Postmark Inbound or a Cloudflare Email Worker) posts each
// letter to /api/inbound/email and it goes through the engine's own ingestEmail — the same classification and pipeline
// moves as every other employer reply. Forwarding-verification letters and non-employer mail never touch the pipeline.
import { db, j, s } from "../db";
import { ingestEmail } from "../engine/agent";
import { classifyEmail, matchCompany } from "../engine/inbox";
import { APPLIED_OR_LATER } from "../engine/taxonomy";
import { isSimulation } from "../mode";
import { rateLimitUser } from "../rate-limit";
import { aliasAddress, aliasesOf, makeAlias } from "./alias";
import { isNonEmployer, senderNames } from "./filter";
import { BODY_MAX, type InboundLetter } from "./parse";
import { detectForwardingVerification, senderAddress, type ForwardingVerification } from "./verify";

export const SOURCE = "forward";
const PROVIDER = "inbound"; // Integration row holding the setup state (meta), one per user
const MAX_USERS_PER_LETTER = 5;
/** Letters accepted per alias: in-memory burst window + a durable daily cap (shared by all serverless instances). */
export const ALIAS_LIMIT = { perHour: 100, perDay: 400 } as const;

export const inboundSecret = () => process.env.INBOUND_EMAIL_SECRET?.trim() || "";

/**
 * Whether the «Пересылка писем» feature is on for users. Simulation: always (it must look connected). Live: only with a
 * provider configured (INBOUND_EMAIL_SECRET), otherwise the card is hidden and the webhook answers 503.
 */
export const forwardingState = (): "simulated" | "live" | "off" => (isSimulation() ? "simulated" : inboundSecret() ? "live" : "off");

type Meta = {
  /** When the current alias was issued: letters before it belong to the old address. */
  aliasSince?: string;
  verify?: ForwardingVerification & { at: string; alias: string };
  verifyDismissedAt?: string;
};

async function readMeta(userId: string): Promise<Meta> {
  const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } }, select: { meta: true } });
  return row ? j<Meta>(row.meta, {}) : {};
}

async function patchMeta(userId: string, patch: (m: Meta) => Meta) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } }, select: { id: true, meta: true } });
    const next = s(patch(row ? j<Meta>(row.meta, {}) : {}));
    try {
      if (row) await db.integration.update({ where: { id: row.id }, data: { meta: next } });
      else await db.integration.create({ data: { userId, provider: PROVIDER, meta: next } });
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // a concurrent first write created the row: retry as update
    }
  }
}

// ——— Alias lifecycle ———

/**
 * Give the user a fresh alias. `expected` is the value being replaced (null on first issue): the write only lands if the
 * row still holds it, so two tabs never end up with two different addresses. The alias column is indexed but not
 * unique, so a collision (another user drew the same alias at the same moment) is detected after the write and the
 * later user (by id) draws again.
 */
async function issueAlias(userId: string, name: string, expected: string | null): Promise<string> {
  let current = expected;
  for (let attempt = 0; attempt < 8; attempt++) {
    const alias = makeAlias(name);
    if (await db.user.findFirst({ where: { inboxAlias: alias }, select: { id: true } })) continue;
    const r = await db.user.updateMany({ where: { id: userId, inboxAlias: current }, data: { inboxAlias: alias } });
    if (!r.count) {
      const now = await db.user.findUnique({ where: { id: userId }, select: { inboxAlias: true } });
      if (!now) throw new Error("user not found");
      if (now.inboxAlias && now.inboxAlias !== current) return now.inboxAlias; // another tab issued one first
      current = now.inboxAlias;
      continue;
    }
    const holders = await db.user.findMany({ where: { inboxAlias: alias }, select: { id: true }, orderBy: { id: "asc" } });
    if (holders.length <= 1 || holders[0].id === userId) {
      await patchMeta(userId, (m) => ({ ...m, aliasSince: new Date().toISOString(), verify: undefined, verifyDismissedAt: undefined }));
      return alias;
    }
    current = alias; // lost the race for this alias: draw again, replacing exactly this value
  }
  throw new Error("could not issue a unique inbox alias");
}

/** The user's alias, created on first view. */
export async function ensureAlias(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { inboxAlias: true, name: true } });
  if (!u) throw new Error("user not found");
  return u.inboxAlias ?? issueAlias(userId, u.name, null);
}

/** «Сменить адрес»: a new alias; the old one stops receiving at once. */
export async function regenerateAlias(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { inboxAlias: true, name: true } });
  if (!u) throw new Error("user not found");
  return issueAlias(userId, u.name, u.inboxAlias);
}

export async function dismissVerification(userId: string) {
  await patchMeta(userId, (m) => ({ ...m, verifyDismissedAt: new Date().toISOString() }));
}

// ——— Status for the setup card ———

export type ForwardingStatus = {
  state: "simulated" | "live";
  address: string;
  /** When the latest letter arrived through this address (null = still waiting for the first one). */
  lastAt: Date | null;
  /** A forwarding confirmation the user still has to finish (code and/or link), or null. */
  verification: (ForwardingVerification & { at: Date }) | null;
};

export async function forwardingStatus(userId: string): Promise<ForwardingStatus | null> {
  const state = forwardingState();
  if (state === "off") return null;
  const alias = await ensureAlias(userId);
  const meta = await readMeta(userId);
  const since = meta.aliasSince ? new Date(meta.aliasSince) : new Date(0);
  const last = await db.inboxMessage.findFirst({
    where: state === "simulated" ? { userId, simulated: true } : { userId, source: SOURCE, receivedAt: { gte: since } },
    orderBy: { receivedAt: "desc" },
    select: { receivedAt: true },
  });
  const v = meta.verify;
  const vAt = v ? new Date(v.at) : null;
  // A confirmation stays up until it is dismissed, a real letter arrives after it (forwarding works), or a week passes.
  const verifyOpen =
    v && vAt && v.alias === alias &&
    (!meta.verifyDismissedAt || new Date(meta.verifyDismissedAt) < vAt) &&
    (!last || last.receivedAt < vAt) &&
    Date.now() - vAt.getTime() < 7 * 86400000;
  return {
    state,
    address: aliasAddress(alias),
    lastAt: last?.receivedAt ?? null,
    verification: verifyOpen && v && vAt ? { provider: v.provider, code: v.code, link: v.link, requester: v.requester, at: vAt } : null,
  };
}

// ——— Delivery ———

export type DeliveryOutcome = "delivered" | "info" | "verification" | "duplicate" | "rate_limited" | "unknown_recipient";

// In-process lock per (user, Message-ID): a provider retry racing the original must not create two rows.
const inflight = new Map<string, Promise<unknown>>();
async function once<T>(key: string, fn: () => Promise<T>): Promise<T | "duplicate"> {
  const prev = inflight.get(key);
  if (prev) {
    await prev.catch(() => undefined);
    return "duplicate";
  }
  const p = fn();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

/** A letter forwarded by hand ("Fwd: …") carries the employer in its body: use the original sender and subject. */
export function unwrapManualForward(l: Pick<InboundLetter, "from" | "subject" | "text">) {
  if (!/^\s*(?:fwd?|пересл(?:ано)?|переслать)\s*:/i.test(l.subject)) return l;
  const block = l.text.match(/(?:-{2,}\s*(?:forwarded message|original message|пересылаемое сообщение|исходное сообщение)\s*-{2,}|начало переадресованного сообщения:|begin forwarded message:)([\s\S]{0,3000})/i);
  if (!block) return l;
  const from = block[1].match(/^\s*(?:from|от(?: кого)?)\s*:\s*(.+)$/im)?.[1]?.trim();
  const subject = block[1].match(/^\s*(?:subject|тема)\s*:\s*(.+)$/im)?.[1]?.trim();
  if (!from || !senderAddress(from)) return l;
  return { ...l, from: from.slice(0, 320), subject: (subject || l.subject.replace(/^\s*(?:fwd?|пересл(?:ано)?|переслать)\s*:\s*/i, "")).slice(0, 300) };
}

async function deliverTo(userId: string, letter: InboundLetter, alias: string): Promise<DeliveryOutcome> {
  const { from, subject } = unwrapManualForward(letter);
  const body = letter.text.slice(0, BODY_MAX) || "(пустое письмо)";

  // Forwarding set-up letters: a code/link for the setup card, never an inbox message.
  const verification = detectForwardingVerification(letter.from, letter.subject, letter.text);
  if (verification) {
    await patchMeta(userId, (m) => ({ ...m, verify: { ...verification, at: new Date().toISOString(), alias } }));
    return "verification";
  }

  if (letter.messageId && (await db.inboxMessage.findFirst({ where: { userId, externalId: letter.messageId }, select: { id: true } }))) return "duplicate";

  const burst = await rateLimitUser("inbound-alias", userId, ALIAS_LIMIT.perHour, 3600000);
  if (!burst.ok) return "rate_limited";
  const today = await db.inboxMessage.count({ where: { userId, source: SOURCE, receivedAt: { gte: new Date(Date.now() - 86400000) } } });
  if (today >= ALIAS_LIMIT.perDay) return "rate_limited";

  const opps = await db.opportunity.findMany({ where: { campaign: { userId }, status: { in: APPLIED_OR_LATER } }, include: { job: { select: { company: true, title: true } } } });
  const matchesSender = opps.some((o) => senderNames(from, o.job.company));
  if (isNonEmployer({ from, subject, headers: letter.headers }, matchesSender)) {
    // Shown in the inbox, linked to an application when it names one — but it never moves the pipeline.
    const c = classifyEmail(subject, body);
    const opportunityId = matchCompany(from, subject, body, opps.map((o) => ({ id: o.id, company: o.job.company, title: o.job.title, status: o.status, updatedAt: o.updatedAt })));
    await db.inboxMessage.create({
      data: { userId, opportunityId, fromAddr: from, subject: subject || "(без темы)", body, classification: c.cls === "unknown" ? "unknown" : "info", confidence: Math.min(c.confidence, 0.5), source: SOURCE, externalId: letter.messageId },
    });
    return "info";
  }
  await ingestEmail(userId, { from: from || "unknown@sender", subject: subject || "(без темы)", body, source: SOURCE, ...(letter.messageId ? { externalId: letter.messageId } : {}) });
  return "delivered";
}

/**
 * Deliver one parsed letter to every user whose alias it was addressed to (envelope recipient, To/Cc/Bcc,
 * Delivered-To / X-Original-To; "+tag" and case ignored). An alias that no user holds — or that two users hold, which
 * the issue path prevents — is ignored without saying which.
 */
export async function deliverLetter(letter: InboundLetter): Promise<{ outcomes: DeliveryOutcome[] }> {
  const aliases = aliasesOf(letter.recipients).slice(0, MAX_USERS_PER_LETTER);
  const outcomes: DeliveryOutcome[] = [];
  const done = new Set<string>();
  for (const alias of aliases) {
    const holders = await db.user.findMany({ where: { inboxAlias: alias }, select: { id: true }, take: 2 });
    if (holders.length !== 1 || done.has(holders[0].id)) continue;
    const userId = holders[0].id;
    done.add(userId);
    const key = `${userId}:${letter.messageId ?? `${Date.now()}:${Math.random()}`}`;
    const r = await once(key, () => deliverTo(userId, letter, alias));
    outcomes.push(r);
  }
  if (!outcomes.length) outcomes.push("unknown_recipient");
  return { outcomes };
}
