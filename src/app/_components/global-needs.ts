// What needs the user anywhere in the app — so a screen with nothing of its own never claims "nothing needed".
import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { pendingApprovalsWhere, pendingHandoffsCount } from "@/lib/ops-data";
import { count, plural } from "./ru";

export type GlobalNeedKind = "offer" | "questions" | "handoffs" | "interview";
export type GlobalNeed = { kind: GlobalNeedKind; text: string; href: string };

const SOON_MS = 48 * 3600000;

/** Offers awaiting a decision, open questions, handoffs to send, interviews in the next 48 h. Cached per request. */
export const globalNeeds = cache(async (userId: string): Promise<GlobalNeed[]> => {
  const now = new Date();
  const [offers, questions, handoffs, interviews] = await Promise.all([
    db.offer.count({ where: { userId, status: { in: ["received", "negotiating"] } } }),
    db.approval.count({ where: pendingApprovalsWhere(userId, now) }),
    pendingHandoffsCount(userId),
    db.interview.findMany({
      where: { userId, status: "upcoming", round: { not: "assessment" }, scheduledAt: { gte: now, lte: new Date(now.getTime() + SOON_MS) } },
      select: { id: true },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);
  const out: GlobalNeed[] = [];
  if (offers) out.push({ kind: "offer", text: offers === 1 ? "оффер" : `${offers} ${plural(offers, ["оффер", "оффера", "офферов"])}`, href: "/app/offers" });
  if (interviews.length) {
    out.push({
      kind: "interview",
      text: interviews.length === 1 ? "интервью в ближайшие 48 ч" : `${interviews.length} интервью в ближайшие 48 ч`,
      href: interviews.length === 1 ? `/app/interviews/${interviews[0].id}` : "/app/interviews",
    });
  }
  if (questions) out.push({ kind: "questions", text: count(questions, ["вопрос", "вопроса", "вопросов"]), href: "/app/approvals" });
  if (handoffs) out.push({ kind: "handoffs", text: `${count(handoffs, ["заявка", "заявки", "заявок"])} к отправке`, href: "/app/approvals#kind-handoff" });
  return out;
});
