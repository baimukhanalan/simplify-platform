import "server-only";
import { db, j } from "@/lib/db";
import { readAutonomy } from "@/lib/engine/autonomy";
import { regionsFor } from "@/lib/regions";
import { currentCampaign, interviewCounts, isQualified, nextCycleQueue, pendingApprovalsCount, pendingHandoffsCount, reachedAssessment, reachedInterviewRound, runningCampaign, visibleInterviewScope, visibleLinkedScope, visibleScope, windowNumbers } from "@/lib/ops-data";
import { APPLIED_OR_LATER, fmtMoney } from "@/lib/engine/taxonomy";
import { blockerKind, blockerRu } from "@/lib/engine/matching";
import { APP_TZ as TZ, startOfToday } from "@/lib/time";
import { regionsRu } from "@/app/_components/ru";
import { count, fmtNum, roleLabelRu, type Forms } from "@/lib/ru";
import { STRONG_MATCH } from "@/lib/engine/matching";
import type { NsKey, T } from "@/lib/i18n/translator";
import { regionNames } from "@/lib/i18n/labels";

const DAY = 86400000;

// ——— Clock & greeting (Asia/Almaty) ———

export function almatyHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(now));
}

export function greeting(now = new Date()) {
  const h = almatyHour(now);
  return h >= 5 && h < 12 ? "Good morning" : h >= 12 && h < 18 ? "Good afternoon" : "Good evening";
}

export const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
export const hhmm = (d: Date) => d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ });

export function dayLabel(key: string, now = new Date()) {
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - DAY));
  if (key === today) return "Сегодня";
  if (key === yesterday) return "Вчера";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function campaignDay(c: { startedAt: Date | null; createdAt: Date; endsAt: Date | null }, now = Date.now()) {
  const start = (c.startedAt ?? c.createdAt).getTime();
  const total = c.endsAt ? Math.max(1, Math.round((c.endsAt.getTime() - start) / DAY)) : 60;
  const day = Math.min(total, Math.max(1, Math.floor((now - start) / DAY) + 1));
  return { day, total };
}

// ——— Goal line & "what the agent is doing" ———

const REGION_IN: Record<string, string> = { KZ: "Казахстане", CIS: "СНГ", EU: "Европе", UK: "Великобритании", US: "США", CA: "Канаде", MENA: "ОАЭ" };

const joinRu = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} и ${xs[xs.length - 1]}`);

/** The one money style (src/lib/engine/taxonomy.ts): «$60 000», «450 000 ₸». */
const money = (n: number, cur: string) => fmtMoney(n, cur);

export function goalLine(goal: { primaryRole: string; countries: string; minSalary: number; currency: string } | null) {
  if (!goal?.primaryRole) return { line: null as string | null, regions: [] as string[] };
  const regions = regionsFor(j<string[]>(goal.countries, []));
  // Region names in Russian, one naming everywhere (src/app/_components/ru.ts): Европа, США, Казахстан, Удалённо…
  const parts = [goal.primaryRole, regionsRu(regions), goal.minSalary ? `${money(goal.minSalary, goal.currency)}+` : ""].filter(Boolean);
  return { line: parts.join(" · "), regions };
}

export function doingNow(status: string, regions: string[], findJobs: boolean, personalize: boolean) {
  if (status === "paused") return "Кампания на паузе — агент не ищет и не отправляет новые заявки.";
  if (status === "hired") return "Кампания завершена оффером. Агент продолжает следить за рынком в фоне — это видно в Career.";
  if (status === "expired") return "Срок кампании закончился. Вся история сохранена ниже.";
  if (!findJobs) return personalize ? "Поиск новых вакансий выключен — агент готовит заявки из уже найденных." : "Поиск и персонализация выключены в настройках агента.";
  const inList = regions.filter((r) => r !== "WORLD").map((r) => REGION_IN[r] ?? r);
  const world = regions.includes("WORLD");
  const where = inList.length ? `в ${joinRu(inList)}${world ? ", а также удалённо по всему миру" : ""}` : world ? "удалённо по всему миру" : "по твоей цели";
  return `Агент сейчас ищет новые вакансии ${where}${personalize ? " и адаптирует CV под самые сильные из них" : ""}.`;
}

// ——— Campaign numbers & stage ———

export const STAGES = [
  { key: "goal", label: "Цель" },
  { key: "search", label: "Поиск" },
  { key: "applications", label: "Заявки" },
  { key: "assessments", label: "Тесты" },
  { key: "interviews", label: "Интервью" },
  { key: "offers", label: "Офферы" },
  { key: "hired", label: "Работа" },
] as const;

type OppRow = { status: string; match: number; eligibility: string; createdAt: Date; submittedAt: Date | null; interviews: { round: string }[]; _count: { offers: number } };

/** Sent: has a submittedAt or is at "submitted" or any later pipeline status. The one definition for "Подано" and the Applications stage. */
export const isSubmitted = (o: { status: string; submittedAt: Date | null }) => o.submittedAt != null || APPLIED_OR_LATER.includes(o.status);

/**
 * Whole-campaign numbers. qualified = isQualified from src/lib/ops-data.ts (the same definition as the "Сегодня" strip
 * and the Opportunities tab, which counts with qualifiedWhere; the tab is now «Ждут решения»). interviews = roles that reached a real interview round (assessments excluded);
 * assessments = roles that received an assessment — counted separately, a role can be in both.
 */
export function totals(opps: OppRow[]) {
  const submitted = opps.filter(isSubmitted);
  return {
    found: opps.length,
    qualified: opps.filter(isQualified).length,
    submitted: submitted.length,
    responses: submitted.filter((o) => !["submitted", "pending"].includes(o.status)).length,
    assessments: opps.filter(reachedAssessment).length,
    interviews: opps.filter(reachedInterviewRound).length,
    offers: opps.filter((o) => ["offer", "hired"].includes(o.status) || o._count.offers > 0).length,
    hired: opps.some((o) => o.status === "hired"),
  };
}
export type Totals = ReturnType<typeof totals>;

/**
 * Exact split of found roles, labels that add up (Today's «подошли» and the feed's discovery line use the same rule):
 *   found     = qualified + weaker + blocked + setAside
 *   qualified = queued + prepared + applied + waiting
 * qualified = isQualified (Match ≥ STRONG_MATCH, not blocked, not skipped). queued = the agent will prepare it (status
 * "qualified"); prepared = package built, not sent yet (a question or the daily limit may hold it); applied = sent or
 * later; waiting = the agent won't take it on its own (off-goal or stale) — it needs the user's Apply.
 * weaker = eligible but Match below STRONG_MATCH; blocked = fails a hard requirement; setAside = skipped by the user or as
 * a duplicate of the same role elsewhere.
 */
export function breakdown(opps: (Pick<OppRow, "status" | "match" | "eligibility" | "submittedAt"> & { blockers?: string })[]) {
  const b = { found: opps.length, qualified: 0, queued: 0, prepared: 0, applied: 0, waiting: 0, weaker: 0, blocked: 0, filtered: 0, setAside: 0 };
  for (const o of opps) {
    if (o.eligibility === "blocked") {
      b.blocked++;
      // Blocked only by the user's own filters (the discovery feed's «вне твоих настроек поиска»), a subset of blocked.
      const list = o.blockers ? j<string[]>(o.blockers, []) : [];
      if (list.length && list.every((x) => blockerKind(x) === "filter")) b.filtered++;
    }
    else if (o.status === "skipped") b.setAside++;
    else if (!isQualified(o)) b.weaker++;
    else {
      b.qualified++;
      if (isSubmitted(o)) b.applied++;
      else if (o.status === "prepared") b.prepared++;
      else if (o.status === "qualified") b.queued++;
      else b.waiting++;
    }
  }
  return b;
}
export type Breakdown = ReturnType<typeof breakdown>;

const VACANCY: Forms = ["вакансию", "вакансии", "вакансий"];
/** Verb agreeing with a count: 1 → «подходит», 2+ → «подходят» (after a number Russian takes the plural here). */
const verb = (n: number, one: string, many: string) => (n === 1 || (n % 10 === 1 && n % 100 !== 11) ? one : many);

/**
 * Discovery summary, sentence-ready: zero parts are hidden, and a single role (or a single kind) is never described as
 * «Остальные: 1 …». `when` = «Сегодня» / «За кампанию».
 *   0          → «Сегодня агент пока не нашёл новых вакансий.»
 *   1          → «Сегодня агент нашёл 1 вакансию — она не проходит по требованиям.»
 *   one kind   → «Сегодня агент нашёл 4 вакансии — все не проходят по требованиям.»
 *   mixed      → «Сегодня агент нашёл 12 вакансий: 5 подходят (Match 70+), 3 — со слабым совпадением, 4 не проходят по требованиям.»
 */
export function discoverySentence(b: Pick<Breakdown, "found" | "qualified" | "weaker" | "blocked" | "setAside"> & { filtered?: number }, when = "Сегодня") {
  if (!b.found) return `${when} агент пока не нашёл новых вакансий.`;
  const filtered = Math.min(b.blocked, b.filtered ?? 0);
  const kinds = [
    { n: b.qualified, one: `подходит (Match ${STRONG_MATCH}+)`, many: `подходят (Match ${STRONG_MATCH}+)`, all: `подходят (Match ${STRONG_MATCH}+)` },
    { n: b.weaker, one: "— со слабым совпадением", many: "— со слабым совпадением", all: "со слабым совпадением", she: "у неё слабое совпадение" },
    { n: b.blocked - filtered, one: "не проходит по требованиям", many: "не проходят по требованиям", all: "не проходят по требованиям" },
    // The same category as the discovery feed line (src/lib/engine/agent.ts): blocked only by the user's own settings.
    { n: filtered, one: "— вне твоих настроек поиска", many: "— вне твоих настроек поиска", all: "вне твоих настроек поиска", she: "она вне твоих настроек поиска" },
    { n: b.setAside, one: "отложена (дубль или пропуск)", many: "отложены (дубли или пропуски)", all: "отложены (дубли или пропуски)" },
  ].filter((k) => k.n > 0);
  const head = `${when} агент нашёл ${count(b.found, VACANCY)}`;
  if (kinds.length === 1) {
    const k = kinds[0];
    if (b.found === 1) return `${head} — ${k.she ?? `она ${k.one}`}.`;
    return `${head} — ${b.found === 2 ? "обе" : "все"} ${k.all}.`;
  }
  return `${head}: ${kinds.map((k) => `${fmtNum(k.n)} ${verb(k.n, k.one, k.many)}`).join(", ")}.`;
}
export type StageKey = (typeof STAGES)[number]["key"];

/* ——— The same lines in the interface language (Today renders these; the Russian originals above stay for other screens) ——— */

export const STAGE_LABEL: Record<StageKey, NsKey<"today">> = {
  goal: "stageGoal", search: "stageSearch", applications: "stageApplications", assessments: "stageAssessments", interviews: "stageInterviews", offers: "stageOffers", hired: "stageHired",
};

export function greetingKey(now = new Date()): NsKey<"today"> {
  const h = almatyHour(now);
  return h >= 5 && h < 12 ? "greetingMorning" : h >= 12 && h < 18 ? "greetingAfternoon" : "greetingEvening";
}

/** «Сегодня» / «Вчера» / «27 сентября» in the interface language. */
export function dayLabelT(t: T, key: string, now = new Date()) {
  if (key === dayKey(now)) return t("today.dayToday");
  if (key === dayKey(new Date(now.getTime() - DAY))) return t("today.dayYesterday");
  const [y, m, d] = key.split("-").map(Number);
  return t.date(new Date(Date.UTC(y, m - 1, d, 12)), "dayMonth");
}

/** goalLine() in the interface language: «Data Analyst · Европа, США · $60 000+». */
export function goalLineT(t: T, goal: { primaryRole: string; countries: string; minSalary: number; currency: string } | null) {
  if (!goal?.primaryRole) return null;
  const regions = regionsFor(j<string[]>(goal.countries, []));
  return [goal.primaryRole, regionNames(t, regions), goal.minSalary ? `${t.money(goal.minSalary, goal.currency)}+` : ""].filter(Boolean).join(" · ");
}

const IN_KEY: Record<string, NsKey<"today">> = { KZ: "inKZ", CIS: "inCIS", EU: "inEU", UK: "inUK", US: "inUS", CA: "inCA", MENA: "inMENA" };

/** doingNow() in the interface language. */
export function doingNowT(t: T, status: string, regions: string[], findJobs: boolean, personalize: boolean) {
  if (status === "paused") return t("today.doingPaused");
  if (status === "hired") return t("today.doingHired");
  if (status === "expired") return t("today.doingExpired");
  if (!findJobs) return personalize ? t("today.doingNoSearch") : t("today.doingOff");
  const inList = regions.filter((r) => r !== "WORLD").map((r) => (IN_KEY[r] ? t(`today.${IN_KEY[r]}`) : r));
  const world = regions.includes("WORLD");
  const where = inList.length ? t(world ? "today.whereInWorld" : "today.whereIn", { list: t.list(inList) }) : world ? t("today.whereWorld") : t("today.whereGoal");
  return t(personalize ? "today.doingSearchCv" : "today.doingSearch", { where });
}

/** discoverySentence(b, «Сегодня») in the interface language — same rules: zero parts hidden, one role never «Остальные: 1 …». */
export function todaySentenceT(t: T, b: Pick<Breakdown, "found" | "qualified" | "weaker" | "blocked" | "setAside"> & { filtered?: number }) {
  if (!b.found) return t("today.foundNone");
  const filtered = Math.min(b.blocked, b.filtered ?? 0);
  const min = STRONG_MATCH;
  const kinds = [
    { n: b.qualified, k: "Qualified" },
    { n: b.weaker, k: "Weaker" },
    { n: b.blocked - filtered, k: "Blocked" },
    { n: filtered, k: "Filtered" },
    { n: b.setAside, k: "SetAside" },
  ].filter((x) => x.n > 0) as { n: number; k: "Qualified" | "Weaker" | "Blocked" | "Filtered" | "SetAside" }[];
  const head = t("today.foundHead", { n: b.found });
  if (kinds.length === 1) {
    const k = kinds[0].k;
    if (b.found === 1) return `${head} — ${t(`today.one${k}`, { min })}.`;
    return `${head} — ${t(b.found === 2 ? "today.both" : "today.all")} ${t(`today.all${k}`, { min })}.`;
  }
  return `${head}: ${kinds.map((x) => t(`today.kind${x.k}`, { n: x.n, min })).join(", ")}.`;
}

/**
 * The number shown under each stage of the progress rail — each stage counts only its own thing:
 * Search = found, Applications = submitted-or-later (the same number as «Подано»), and so on. Empty = nothing shown.
 */
export function stageValues(t: Totals, goalRole: string): Record<StageKey, string> {
  const n = (v: number) => (v ? String(v) : "");
  return {
    goal: goalRole,
    search: n(t.found),
    applications: n(t.submitted),
    assessments: n(t.assessments),
    interviews: n(t.interviews),
    offers: n(t.offers),
    hired: t.hired ? "Да" : "",
  };
}

/** Index into STAGES of the furthest stage reached, from the same totals as stageValues (so rail and numbers agree). */
export function currentStage(t: Totals, campaignStatus: string) {
  if (campaignStatus === "hired" || t.hired) return 6;
  if (t.offers) return 5;
  if (t.interviews) return 4;
  if (t.assessments) return 3;
  if (t.submitted) return 2;
  return 1;
}

// ——— Timeline ———

export type TimelineItem = {
  id: string;
  at: Date;
  kind: "found" | "skipped" | "prepared" | "submitted" | "response" | "interview" | "offer" | "rejection" | "system";
  text: string;
  detail?: string;
  /** `detail` in the interface language (today.*). */
  detailKey?: "hasQuestion";
  href?: string;
  cta?: string;
  /** The CTA in the interface language (today.*); `cta` is its Russian original. */
  ctaKey?: "prepare" | "openOffer";
  match?: number;
};

const RESPONSE_COPY: Record<string, (c: string) => { text: string; kind: TimelineItem["kind"]; cta?: string; ctaKey?: TimelineItem["ctaKey"] }> = {
  interview: (c) => ({ text: `${c}: приглашение на интервью`, kind: "interview", cta: "Подготовиться", ctaKey: "prepare" }),
  assessment: (c) => ({ text: `${c}: следующий этап — тестовое задание`, kind: "interview", cta: "Подготовиться", ctaKey: "prepare" }),
  offer: (c) => ({ text: `Оффер от ${c}`, kind: "offer", cta: "Открыть оффер", ctaKey: "openOffer" }),
  rejection: (c) => ({ text: `${c}: отказ. Статус обновлён автоматически`, kind: "rejection" }),
};

/** Everything the agent did in the last few days, from Event rows plus the opportunities and responses behind them. */
export async function loadTimeline(userId: string, campaignId: string, since: Date) {
  const [events, found, skipped, inbox] = await Promise.all([
    db.event.findMany({
      where: { userId, createdAt: { gte: since }, type: { not: "inbox" }, ...visibleLinkedScope() },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { opportunity: { select: { id: true, match: true, job: { select: { company: true, title: true, location: true, remote: true } } } } },
    }),
    db.opportunity.findMany({
      where: { campaignId, ...visibleScope(), createdAt: { gte: since }, status: { not: "skipped" }, match: { gte: 60 } },
      orderBy: { match: "desc" },
      take: 60,
      select: { id: true, match: true, createdAt: true, job: { select: { company: true, title: true, location: true, remote: true } } },
    }),
    db.opportunity.findMany({
      where: { campaignId, ...visibleScope(), createdAt: { gte: since }, status: "skipped" },
      orderBy: { match: "desc" },
      take: 60,
      select: { id: true, blockers: true, createdAt: true, job: { select: { company: true, title: true, location: true, remote: true } } },
    }),
    db.inboxMessage.findMany({
      where: { userId, receivedAt: { gte: since }, ...visibleLinkedScope() },
      orderBy: { receivedAt: "desc" },
      take: 60,
      include: { opportunity: { select: { id: true, job: { select: { company: true, title: true } }, interviews: { select: { id: true, round: true }, orderBy: { createdAt: "desc" } } } } },
    }),
  ]);

  const items: TimelineItem[] = [];
  const perDay = new Map<string, { found: number; skipped: number }>();
  const bump = (d: Date, k: "found" | "skipped") => {
    const key = dayKey(d);
    const v = perDay.get(key) ?? { found: 0, skipped: 0 };
    v[k]++;
    perDay.set(key, v);
    return v[k];
  };

  // Strongest few finds and a few skips per day — the rest is summarised, not listed.
  for (const o of found) if (bump(o.createdAt, "found") <= 4) items.push({ id: `f-${o.id}`, at: o.createdAt, kind: "found", text: `Найдена роль: ${roleLabelRu(o.job)}`, match: o.match, href: `/app/opportunities/${o.id}` });
  for (const o of skipped) {
    const first = j<string[]>(o.blockers, [])[0];
    const reason = first ? blockerRu(first) : "";
    if (!reason) continue;
    if (bump(o.createdAt, "skipped") <= 3) items.push({ id: `s-${o.id}`, at: o.createdAt, kind: "skipped", text: `Пропущено — ${roleLabelRu(o.job)}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`, href: `/app/opportunities/${o.id}` });
  }

  for (const e of events) {
    const job = e.opportunity?.job;
    const href = e.opportunityId ? `/app/opportunities/${e.opportunityId}` : undefined;
    if (e.type === "prepared" && job) {
      const waits = /ждут подтверждения/.test(e.message);
      items.push({ id: e.id, at: e.createdAt, kind: "prepared", text: `CV адаптирован: ${roleLabelRu(job)}`, detail: waits ? "есть вопрос к тебе" : undefined, detailKey: waits ? "hasQuestion" : undefined, href, match: e.opportunity?.match });
    } else if (e.type === "submitted" && job) {
      items.push({ id: e.id, at: e.createdAt, kind: "submitted", text: `Заявка отправлена: ${roleLabelRu(job)}`, href });
    } else if (e.type === "interview_room") {
      items.push({ id: e.id, at: e.createdAt, kind: "interview", text: e.message.replace("Interview Room создан", "Interview Room готов"), href: "/app/interviews" });
    } else if (e.type === "tick") {
      items.push({ id: e.id, at: e.createdAt, kind: "system", text: e.message });
    } else {
      items.push({ id: e.id, at: e.createdAt, kind: "system", text: e.message, href });
    }
  }

  for (const m of inbox) {
    // «Fernvale Payments · Data Analyst: отказ» — the role is named, so two applications to one company never read alike.
    const job = m.opportunity?.job;
    const company = job ? `${job.company}${job.title ? ` · ${job.title}` : ""}` : m.fromAddr.split("@")[1]?.split(".")[0] ?? "Работодатель";
    const copy = RESPONSE_COPY[m.classification];
    if (!copy) continue;
    const c = copy(company);
    const iv = m.opportunity?.interviews.find((i) => (m.classification === "assessment" ? i.round === "assessment" : i.round !== "assessment"));
    const href = m.classification === "offer" ? "/app/offers" : iv ? `/app/interviews/${iv.id}` : m.opportunity ? `/app/opportunities/${m.opportunity.id}` : "/app/inbox";
    items.push({ id: `m-${m.id}`, at: m.receivedAt, kind: c.kind, text: c.text, href, cta: c.cta, ctaKey: c.ctaKey });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  const days = new Map<string, TimelineItem[]>();
  for (const it of items) {
    const k = dayKey(it.at);
    days.set(k, [...(days.get(k) ?? []), it]);
  }
  return [...days.entries()].map(([key, list]) => {
    const counts = perDay.get(key) ?? { found: 0, skipped: 0 };
    return { key, items: list.slice(0, 30), hidden: Math.max(0, list.length - 30), moreFound: Math.max(0, counts.found - 4), moreSkipped: Math.max(0, counts.skipped - 3) };
  });
}
export type TimelineDay = Awaited<ReturnType<typeof loadTimeline>>[number];

// ——— The whole Today screen ———

export async function loadToday(user: { id: string; autonomy: string; goal: { primaryRole: string; countries: string; minSalary: number; currency: string } | null }, campaign: { id: string; status: string; autoSubmit: boolean; startedAt: Date | null; createdAt: Date; endsAt: Date | null; lastRunAt: Date | null; dailyLimit: number }) {
  const now = Date.now();
  // "Сегодня" = the Almaty calendar day, the same window and definitions as the Opportunities header.
  const dayStart = startOfToday(new Date(now));
  const autonomy = readAutonomy(user.autonomy);
  const [opps, day, approvals, handoffs, upcoming, offers, responsesToday, timeline, ivCounts] = await Promise.all([
    db.opportunity.findMany({
      where: { campaignId: campaign.id, ...visibleScope() },
      select: { status: true, match: true, eligibility: true, blockers: true, createdAt: true, submittedAt: true, interviews: { select: { round: true } }, _count: { select: { offers: true } } },
    }),
    windowNumbers(campaign.id, dayStart, autonomy.autoApplyMinMatch),
    // Only the running campaign's questions: a finished campaign no longer asks anything.
    pendingApprovalsCount(user.id),
    pendingHandoffsCount(user.id),
    // Only rounds still ahead (a past round waiting for «Как прошло?» is not «upcoming»): the same rule as interviewCounts.
    db.interview.findMany({
      where: { userId: user.id, status: "upcoming", OR: [{ scheduledAt: null, round: "assessment" }, { scheduledAt: { gte: new Date(now) } }], ...visibleInterviewScope() },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      select: { id: true, round: true, scheduledAt: true, opportunity: { select: { job: { select: { company: true, title: true } } } } },
    }),
    db.offer.findMany({ where: { userId: user.id, status: { in: ["received", "negotiating"] }, ...visibleLinkedScope() }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, company: true, role: true } }),
    db.inboxMessage.count({ where: { userId: user.id, receivedAt: { gte: dayStart }, classification: { in: ["interview", "assessment", "offer", "rejection"] }, ...visibleLinkedScope() } }),
    loadTimeline(user.id, campaign.id, new Date(now - 3 * DAY)),
    interviewCounts(user.id, new Date(now)),
  ]);

  const t = totals(opps);
  const stage = currentStage(t, campaign.status);
  const today = { found: day.found, qualified: day.qualified, strong: day.strong, submitted: day.submitted, responses: responsesToday };
  const dayOpps = opps.filter((o) => o.createdAt >= dayStart);
  const queue = await nextCycleQueue(campaign, autonomy);
  const { line, regions } = goalLine(user.goal);
  return {
    clock: campaignDay(campaign, now),
    totals: t,
    stage,
    /** Use for the progress rail values (StageBar) instead of reading totals directly. */
    stageValues: stageValues(t, user.goal?.primaryRole ?? ""),
    today,
    /** Exact split of today's finds (sums to today.found; .qualified === today.qualified). */
    todayBreakdown: breakdown(dayOpps),
    /** Today's finds as one sentence (zero parts hidden, never «Остальные: 1 …»): discoverySentence. */
    todaySentence: discoverySentence(breakdown(dayOpps), "Сегодня"),
    /** The same for the whole campaign. */
    campaignSentence: discoverySentence(breakdown(opps), "За кампанию"),
    /** The same split for the whole campaign (sums to totals.found; .qualified === totals.qualified). */
    breakdown: breakdown(opps),
    strongThreshold: autonomy.autoApplyMinMatch,
    /** Roles the next agent cycle would send on its own (for «в очереди — агент подаст в следующем цикле»). */
    queue,
    goalLine: line,
    doing: doingNow(campaign.status, regions, autonomy.findJobs, autonomy.personalizeCv),
    /** Inputs of `doing`, for doingNowT (the same line in the interface language). */
    doingInput: { regions, findJobs: autonomy.findJobs, personalize: autonomy.personalizeCv },
    approvals,
    handoffs,
    upcoming,
    offers,
    /** interviewCounts (src/lib/ops-data.ts): the same numbers as the nav badge, Applications and Interviews. */
    interviews: ivCounts,
    /** Stages still open behind the current one («в процессе» on the rail): only when a future round / open test / offer exists. */
    stageOpen: { assessments: ivCounts.assessments > 0, interviews: ivCounts.upcoming > 0, offers: offers.length > 0 } as Partial<Record<StageKey, boolean>>,
    timeline,
    now,
  };
}
export type Today = Awaited<ReturnType<typeof loadToday>>;

// ——— Agent state for screens outside Today (e.g. Career Mode) ———

/**
 * Whether the agent is actually searching for this user right now, so copy like «Агент ищет за тебя» is only shown
 * when true. hasCampaign = any non-draft campaign ever; running = active or paused and not past endsAt;
 * searching = running, active (not paused) and Find jobs is on.
 */
export async function agentState(user: { id: string; autonomy: string }) {
  const [latest, running] = await Promise.all([currentCampaign(user.id), runningCampaign(user.id)]);
  const findJobs = readAutonomy(user.autonomy).findJobs;
  return {
    hasCampaign: Boolean(latest),
    status: latest?.status ?? null,
    running: Boolean(running),
    paused: running?.status === "paused",
    searching: running?.status === "active" && findJobs,
  };
}
export type AgentState = Awaited<ReturnType<typeof agentState>>;
