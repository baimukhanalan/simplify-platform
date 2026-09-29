// needsList() (src/app/_components/global-needs.ts) in the interface language: the «Нужно от тебя» lines of
// Opportunities, Applications and Inbox — the same numbers (needsYou) and order, most urgent first.
import "server-only";
import type { NeedsYou } from "@/lib/ops-data";
import type { T } from "@/lib/i18n/translator";
import { ENABLE_AUTOSUBMIT, type GlobalNeedKind } from "../../../_components/global-needs";
import type { Need } from "../../../_components/agent-status";

export const questionsWaitingT = (t: T, n: number) => t("work.questionsWaiting", { n });
export const handoffsWaitingT = (t: T, n: number) => t("work.handoffsWaiting", { n });
export const decisionsWaitingT = (t: T, n: number) => t("work.decisionsWaiting", { n });

export function needsListT(t: T, n: NeedsYou, skip: GlobalNeedKind[] = []): Need[] {
  const out: (Need & { kind: GlobalNeedKind })[] = [];
  if (n.enableAutoSubmit) out.push({ kind: "autosubmit", text: t("work.needAutosubmit"), href: ENABLE_AUTOSUBMIT.href });
  if (n.offer) out.push({ kind: "offer", text: t("work.needOffer", { n: n.offer }), href: "/app/offers" });
  if (n.interviews48h) out.push({ kind: "interview", text: t("work.needInterview", { n: n.interviews48h }), href: "/app/interviews" });
  if (n.assessments) out.push({ kind: "assessments", text: t("work.needAssessments", { n: n.assessments }), href: "/app/interviews" });
  if (n.questions) out.push({ kind: "questions", text: questionsWaitingT(t, n.questions), href: "/app/approvals" });
  if (n.handoffs) out.push({ kind: "handoffs", text: handoffsWaitingT(t, n.handoffs), href: "/app/approvals#kind-handoff" });
  if (n.applyDecisions) out.push({ kind: "decisions", text: decisionsWaitingT(t, n.applyDecisions), href: "/app/opportunities" });
  return out.filter((x) => !skip.includes(x.kind)).map(({ text, href }) => ({ text, href }));
}
