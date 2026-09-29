// What needs the user anywhere in the app — so a screen with nothing of its own never claims "nothing needed".
// One source for every screen: needsYou (src/lib/ops-data.ts). Today «Следующий шаг», the Opportunities header,
// the Applications / Inbox «Нужно от тебя» blocks and the status line's «ждут тебя: …» all read the same numbers.
import "server-only";
import { cache } from "react";
import { needsYou, type NeedsYou } from "@/lib/ops-data";
import { count, handoffsWaiting, plural, questionsWaiting } from "./ru";
import type { Need } from "./agent-status";

export type GlobalNeedKind = "offer" | "questions" | "handoffs" | "interview" | "assessments" | "decisions" | "autosubmit";

/** The consent only the user can give (needsYou.enableAutoSubmit). */
export const ENABLE_AUTOSUBMIT = { text: "Включи автоподачу в настройках", href: "/app/settings#autosubmit" } as const;
/** `n`: how many (1 for the autosubmit consent) — the status line words it in the interface language (statusLine.el.*). */
export type GlobalNeed = { kind: GlobalNeedKind; n: number; text: string; href: string };

/** needsYou, cached per request (several components on one screen ask for it). */
export const needsYouCached = cache((userId: string) => needsYou(userId));

/** Short forms for the status line: «ждут тебя: оффер, 2 вопроса.» */
export const globalNeeds = cache(async (userId: string): Promise<GlobalNeed[]> => globalNeedsOf(await needsYouCached(userId)));

/** globalNeeds for already loaded numbers (pure). */
export function globalNeedsOf(n: NeedsYou): GlobalNeed[] {
  const out: GlobalNeed[] = [];
  if (n.enableAutoSubmit) out.push({ kind: "autosubmit", n: 1, text: "включить автоподачу", href: ENABLE_AUTOSUBMIT.href });
  if (n.offer) out.push({ kind: "offer", n: n.offer, text: n.offer === 1 ? "оффер" : count(n.offer, ["оффер", "оффера", "офферов"]), href: "/app/offers" });
  if (n.interviews48h) out.push({ kind: "interview", n: n.interviews48h, text: n.interviews48h === 1 ? "интервью в ближайшие 48 ч" : `${n.interviews48h} интервью в ближайшие 48 ч`, href: "/app/interviews" });
  if (n.assessments) out.push({ kind: "assessments", n: n.assessments, text: count(n.assessments, ["тестовое задание", "тестовых задания", "тестовых заданий"]), href: "/app/interviews" });
  if (n.questions) out.push({ kind: "questions", n: n.questions, text: count(n.questions, ["вопрос", "вопроса", "вопросов"]), href: "/app/approvals" });
  if (n.handoffs) out.push({ kind: "handoffs", n: n.handoffs, text: `${count(n.handoffs, ["заявка", "заявки", "заявок"])} к отправке`, href: "/app/approvals#kind-handoff" });
  if (n.applyDecisions) out.push({ kind: "decisions", n: n.applyDecisions, text: `${count(n.applyDecisions, ["вакансия", "вакансии", "вакансий"])} на решение`, href: "/app/opportunities" });
  return out;
}

/** «15 вакансий ждут твоего решения» — the Apply decisions, one wording on Today, Opportunities and Applications. */
export const decisionsWaiting = (n: number) => `${count(n, ["вакансия ждёт", "вакансии ждут", "вакансий ждут"])} твоего решения`;

/** Full sentences for a «Нужно от тебя» block, most urgent first. `skip` drops what the screen itself shows. */
export function needsList(n: NeedsYou, skip: GlobalNeedKind[] = []): Need[] {
  const out: (Need & { kind: GlobalNeedKind })[] = [];
  if (n.enableAutoSubmit) out.push({ kind: "autosubmit", ...ENABLE_AUTOSUBMIT });
  if (n.offer) out.push({ kind: "offer", text: `${n.offer} ${plural(n.offer, ["оффер ждёт", "оффера ждут", "офферов ждут"])} твоего решения`, href: "/app/offers" });
  if (n.interviews48h) out.push({ kind: "interview", text: `Подготовься: ${n.interviews48h} интервью в ближайшие 48 ч`, href: "/app/interviews" });
  if (n.assessments) out.push({ kind: "assessments", text: `${n.assessments} ${plural(n.assessments, ["тестовое задание ждёт", "тестовых задания ждут", "тестовых заданий ждут"])} выполнения`, href: "/app/interviews" });
  if (n.questions) out.push({ kind: "questions", text: questionsWaiting(n.questions), href: "/app/approvals" });
  if (n.handoffs) out.push({ kind: "handoffs", text: handoffsWaiting(n.handoffs), href: "/app/approvals#kind-handoff" });
  if (n.applyDecisions) out.push({ kind: "decisions", text: decisionsWaiting(n.applyDecisions), href: "/app/opportunities" });
  return out.filter((x) => !skip.includes(x.kind)).map(({ text, href }) => ({ text, href }));
}
