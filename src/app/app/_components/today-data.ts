import "server-only";
import { db, j } from "@/lib/db";
import { reachedInterview } from "@/lib/engine/insights";
import { readAutonomy } from "@/lib/engine/autonomy";
import { regionsFor } from "@/lib/regions";

const DAY = 86400000;
const TZ = "Asia/Almaty";

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

const REGION_SHORT: Record<string, string> = { KZ: "Казахстан", CIS: "СНГ", EU: "Европа", UK: "UK", US: "США", CA: "Канада", MENA: "ОАЭ", WORLD: "Remote worldwide" };
const REGION_IN: Record<string, string> = { KZ: "Казахстане", CIS: "СНГ", EU: "Европе", UK: "Великобритании", US: "США", CA: "Канаде", MENA: "ОАЭ" };

const joinRu = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} и ${xs[xs.length - 1]}`);

function money(n: number, cur: string) {
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : cur === "KZT" ? "₸" : `${cur} `;
  if (cur === "KZT") return `${Math.round(n / 1000).toLocaleString("ru-RU")}k ₸`;
  return `${sym}${Math.round(n / 1000)}k`;
}

export function goalLine(goal: { primaryRole: string; countries: string; minSalary: number; currency: string } | null) {
  if (!goal?.primaryRole) return { line: null as string | null, regions: [] as string[] };
  const regions = regionsFor(j<string[]>(goal.countries, []));
  const parts = [goal.primaryRole, regions.map((r) => REGION_SHORT[r] ?? r).join(", "), goal.minSalary ? `${money(goal.minSalary, goal.currency)}+` : ""].filter(Boolean);
  return { line: parts.join(" · "), regions };
}

export function doingNow(status: string, regions: string[], findJobs: boolean, personalize: boolean) {
  if (status === "paused") return "Кампания на паузе — Simplify не ищет и не отправляет новые заявки.";
  if (status === "hired") return "Кампания завершена оффером. Simplify следит за рынком в Passive Career Mode.";
  if (status === "expired") return "60 дней кампании прошли. Вся история сохранена ниже.";
  if (!findJobs) return personalize ? "Поиск новых вакансий выключен — Simplify готовит заявки из уже найденных." : "Поиск и персонализация выключены в настройках агента.";
  const inList = regions.filter((r) => r !== "WORLD").map((r) => REGION_IN[r] ?? r);
  const world = regions.includes("WORLD");
  const where = inList.length ? `в ${joinRu(inList)}${world ? ", а также remote по всему миру" : ""}` : world ? "remote по всему миру" : "по твоей цели";
  return `Simplify сейчас ищет новые вакансии ${where}${personalize ? " и адаптирует CV под самые сильные из них" : ""}.`;
}

// ——— Campaign numbers & stage ———

export const STAGES = [
  { key: "goal", label: "Career Goal" },
  { key: "search", label: "Search" },
  { key: "applications", label: "Applications" },
  { key: "assessments", label: "Assessments" },
  { key: "interviews", label: "Interviews" },
  { key: "offers", label: "Offers" },
  { key: "hired", label: "Hired" },
] as const;

type OppRow = { status: string; match: number; createdAt: Date; submittedAt: Date | null; interviews: { round: string }[]; _count: { offers: number } };

export function totals(opps: OppRow[]) {
  const submitted = opps.filter((o) => o.submittedAt);
  return {
    found: opps.length,
    qualified: opps.filter((o) => !["found", "skipped"].includes(o.status)).length,
    submitted: submitted.length,
    responses: submitted.filter((o) => !["submitted", "pending"].includes(o.status)).length,
    assessments: opps.filter((o) => o.status === "assessment" || o.interviews.some((i) => i.round === "assessment")).length,
    interviews: opps.filter((o) => reachedInterview(o.status, o.interviews.filter((i) => i.round !== "assessment").length)).length,
    offers: opps.filter((o) => ["offer", "hired"].includes(o.status) || o._count.offers > 0).length,
    hired: opps.some((o) => o.status === "hired"),
  };
}
export type Totals = ReturnType<typeof totals>;

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
  href?: string;
  cta?: string;
  match?: number;
};

const RESPONSE_COPY: Record<string, (c: string) => { text: string; kind: TimelineItem["kind"]; cta?: string }> = {
  interview: (c) => ({ text: `${c} пригласили на интервью`, kind: "interview", cta: "Prepare" }),
  assessment: (c) => ({ text: `${c} прислали assessment — ты прошёл на следующий этап`, kind: "interview", cta: "Start preparation" }),
  offer: (c) => ({ text: `Оффер от ${c}`, kind: "offer", cta: "Review" }),
  rejection: (c) => ({ text: `${c}: application declined. Статус обновлён автоматически`, kind: "rejection" }),
};

/** Everything the agent did in the last few days, from Event rows plus the opportunities and responses behind them. */
export async function loadTimeline(userId: string, campaignId: string, since: Date) {
  const [events, found, skipped, inbox] = await Promise.all([
    db.event.findMany({
      where: { userId, createdAt: { gte: since }, type: { not: "inbox" } },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { opportunity: { select: { id: true, match: true, job: { select: { company: true, title: true } } } } },
    }),
    db.opportunity.findMany({
      where: { campaignId, createdAt: { gte: since }, status: { not: "skipped" }, match: { gte: 60 } },
      orderBy: { match: "desc" },
      take: 60,
      select: { id: true, match: true, createdAt: true, job: { select: { company: true, title: true } } },
    }),
    db.opportunity.findMany({
      where: { campaignId, createdAt: { gte: since }, status: "skipped" },
      orderBy: { match: "desc" },
      take: 60,
      select: { id: true, blockers: true, createdAt: true, job: { select: { company: true } } },
    }),
    db.inboxMessage.findMany({
      where: { userId, receivedAt: { gte: since } },
      orderBy: { receivedAt: "desc" },
      take: 60,
      include: { opportunity: { select: { id: true, job: { select: { company: true } }, interviews: { select: { id: true, round: true }, orderBy: { createdAt: "desc" } } } } },
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
  for (const o of found) if (bump(o.createdAt, "found") <= 4) items.push({ id: `f-${o.id}`, at: o.createdAt, kind: "found", text: `Найдена роль: ${o.job.title} — ${o.job.company}`, match: o.match, href: `/app/opportunities/${o.id}` });
  for (const o of skipped) {
    const reason = j<string[]>(o.blockers, [])[0];
    if (!reason) continue;
    if (bump(o.createdAt, "skipped") <= 3) items.push({ id: `s-${o.id}`, at: o.createdAt, kind: "skipped", text: `Skipped ${o.job.company}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`, href: `/app/opportunities/${o.id}` });
  }

  for (const e of events) {
    const job = e.opportunity?.job;
    const href = e.opportunityId ? `/app/opportunities/${e.opportunityId}` : undefined;
    if (e.type === "prepared" && job) {
      const waits = /ждут подтверждения/.test(e.message);
      items.push({ id: e.id, at: e.createdAt, kind: "prepared", text: `CV адаптирован под ${job.title} — ${job.company}`, detail: waits ? "есть вопрос к тебе" : undefined, href, match: e.opportunity?.match });
    } else if (e.type === "submitted" && job) {
      items.push({ id: e.id, at: e.createdAt, kind: "submitted", text: `Заявка отправлена: ${job.title} — ${job.company}`, href });
    } else if (e.type === "interview_room") {
      items.push({ id: e.id, at: e.createdAt, kind: "interview", text: e.message.replace("Interview Room создан", "Interview Room готов"), href: "/app/interviews" });
    } else if (e.type === "tick") {
      items.push({ id: e.id, at: e.createdAt, kind: "system", text: e.message });
    } else {
      items.push({ id: e.id, at: e.createdAt, kind: "system", text: e.message, href });
    }
  }

  for (const m of inbox) {
    const company = m.opportunity?.job.company ?? m.fromAddr.split("@")[1]?.split(".")[0] ?? "Работодатель";
    const copy = RESPONSE_COPY[m.classification];
    if (!copy) continue;
    const c = copy(company);
    const iv = m.opportunity?.interviews.find((i) => (m.classification === "assessment" ? i.round === "assessment" : i.round !== "assessment"));
    const href = m.classification === "offer" ? "/app/offers" : iv ? `/app/interviews/${iv.id}` : m.opportunity ? `/app/opportunities/${m.opportunity.id}` : "/app/inbox";
    items.push({ id: `m-${m.id}`, at: m.receivedAt, kind: c.kind, text: c.text, href, cta: c.cta });
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

export async function loadToday(user: { id: string; autonomy: string; goal: { primaryRole: string; countries: string; minSalary: number; currency: string } | null }, campaign: { id: string; status: string; startedAt: Date | null; createdAt: Date; endsAt: Date | null; lastRunAt: Date | null; dailyLimit: number }) {
  const now = Date.now();
  const since24 = new Date(now - DAY);
  const autonomy = readAutonomy(user.autonomy);
  const [opps, approvals, upcoming, offers, responses24, timeline] = await Promise.all([
    db.opportunity.findMany({
      where: { campaignId: campaign.id },
      select: { status: true, match: true, createdAt: true, submittedAt: true, interviews: { select: { round: true } }, _count: { select: { offers: true } } },
    }),
    db.approval.count({ where: { userId: user.id, status: "pending" } }),
    db.interview.findMany({
      where: { userId: user.id, status: "upcoming" },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      select: { id: true, round: true, scheduledAt: true, opportunity: { select: { job: { select: { company: true, title: true } } } } },
    }),
    db.offer.findMany({ where: { userId: user.id, status: { in: ["received", "negotiating"] } }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, company: true, role: true } }),
    db.inboxMessage.count({ where: { userId: user.id, receivedAt: { gte: since24 }, classification: { in: ["interview", "assessment", "offer", "rejection"] } } }),
    loadTimeline(user.id, campaign.id, new Date(now - 3 * DAY)),
  ]);

  const t = totals(opps);
  const fresh = opps.filter((o) => o.createdAt >= since24);
  const today = {
    found: fresh.length,
    qualified: fresh.filter((o) => !["found", "skipped"].includes(o.status)).length,
    strong: fresh.filter((o) => o.status !== "skipped" && o.match >= (autonomy.autoApplyMinMatch ?? 75)).length,
    submitted: opps.filter((o) => o.submittedAt && o.submittedAt >= since24).length,
    responses: responses24,
  };
  const { line, regions } = goalLine(user.goal);
  return {
    clock: campaignDay(campaign, now),
    totals: t,
    stage: currentStage(t, campaign.status),
    today,
    strongThreshold: autonomy.autoApplyMinMatch ?? 75,
    goalLine: line,
    doing: doingNow(campaign.status, regions, autonomy.findJobs, autonomy.personalizeCv),
    approvals,
    upcoming,
    offers,
    timeline,
    now,
  };
}
export type Today = Awaited<ReturnType<typeof loadToday>>;
