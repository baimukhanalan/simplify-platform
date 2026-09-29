import "server-only";
import { db, j, s } from "../db";
import { FICTIONAL_SOURCE, isFictionalJob, isSimulation } from "../mode";
import { APP_TZ, freeRoundSlot } from "../time";
import { AUTO_ANSWER_STATUS, ingestEmail, rescheduleInterview, settleSharedAnswers, standingAnswer } from "./agent";
import { patchPackageAnswer } from "./approvals";
import { marketRange } from "./market";
import { companyDomain, seededRng } from "./seed-jobs";
import { captureError } from "../monitoring";

// Employer activity of the internal fictional-company corpus (SIMPLIFY_MODE=simulation, src/lib/mode.ts).
//
// Every application sent to a fictional employer follows a script that is a pure function of the opportunity id and its
// current stage: whether and when the employer confirms, rejects, sends an assessment, invites to the next round or makes
// an offer. Replies are delivered through ingestEmail — the same path as real employer mail — so the pipeline, Inbox,
// notifications, Interview Rooms and Offer Desk all move exactly as they would. Rows are dated at the moment the script
// says the email arrived, so catching up after days away reads like a real inbox. Applications to live-feed vacancies
// (real companies) are never touched.

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Stages a fictional employer still answers from. */
const OPEN_STAGES = ["submitted", "pending", "assessment", "recruiter", "hiring_manager", "technical", "final"];
const TECH_FAMILIES = new Set(["software_engineer", "data_engineer", "data_scientist", "qa", "data_analyst", "product_analyst"]);

export type SimKind = "confirmation" | "rejection" | "assessment" | "recruiter" | "hiring_manager" | "technical" | "final" | "offer";
export type SimStep = { kind: SimKind; at: Date };

type SimOpp = {
  id: string; status: string; submittedAt: Date | null; pInterview: number;
  job: { source: string; roleFamily: string; massHiring: boolean };
  interviews: { round: string; scheduledAt: Date | null }[];
  inbox: { classification: string; receivedAt: Date }[];
};

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);

/** Almaty wall-clock hour of an instant (UTC+5; the product's home timezone). */
const almatyHour = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, hour: "2-digit", hourCycle: "h23" }).format(d));

/** Recruiters write during their working day: a time at night moves to the next morning (09:00–11:00 Almaty). */
function workingHours(at: number, r: () => number) {
  const d = new Date(at);
  const h = almatyHour(d);
  if (h >= 9 && h < 20) return d;
  const toMorning = ((9 - h + 24) % 24) * HOUR - d.getUTCMinutes() * 60000;
  return new Date(at + toMorning + Math.floor(r() * 120) * 60000);
}

/**
 * The next thing this employer does, or null when it stays silent. Deterministic: seeded by the opportunity id and its
 * current stage, so reloading (or running twice) never reshuffles the story.
 */
export function nextStep(o: SimOpp): SimStep | null {
  if (!isFictionalJob(o.job) || !o.submittedAt || !OPEN_STAGES.includes(o.status)) return null;
  const r = seededRng(`sim:${o.id}:${o.status}`);
  const sub = o.submittedAt.getTime();
  const lastMail = Math.max(sub, ...o.inbox.map((m) => m.receivedAt.getTime()));
  const at = (t: number) => workingHours(t, r);
  const roundAt = (round: string) => o.interviews.find((i) => i.round === round)?.scheduledAt?.getTime() ?? lastMail + 3 * DAY;

  if (o.status === "submitted" || o.status === "pending") {
    const confirmed = o.status === "pending" || o.inbox.some((m) => m.classification === "confirmation");
    if (!confirmed && r() < 0.65) return { kind: "confirmation", at: at(sub + between(r, 0.3, 6) * HOUR) };
    const d = seededRng(`sim:${o.id}:decision`);
    const positive = Math.min(0.5, Math.max(0.14, 0.14 + o.pInterview * 0.7 + (o.job.massHiring ? 0.12 : 0)));
    const x = d();
    if (x < positive) {
      const assessShare = o.job.massHiring ? 0.65 : TECH_FAMILIES.has(o.job.roleFamily) ? 0.35 : 0.2;
      return d() < assessShare ? { kind: "assessment", at: at(sub + between(d, 3, 8) * DAY) } : { kind: "recruiter", at: at(sub + between(d, 3, 10) * DAY) };
    }
    if (x < positive + 0.45) return { kind: "rejection", at: at(sub + between(d, 2, 7) * DAY) };
    // Most of the rest never hear back; a few get a late "no".
    return d() < 0.3 ? { kind: "rejection", at: at(sub + between(d, 12, 20) * DAY) } : null;
  }
  if (o.status === "assessment") {
    // The test counts as taken by its deadline (the round's date; 5 days after the invite when none is set). The employer
    // answers 0.5–2.5 days after it: ~60% the next stage (a recruiter interview), ~40% a rejection.
    const sent = Math.max(...o.inbox.filter((m) => m.classification === "assessment").map((m) => m.receivedAt.getTime()), lastMail);
    const due = Math.max(sent, o.interviews.find((i) => i.round === "assessment")?.scheduledAt?.getTime() ?? sent + 5 * DAY);
    return r() < 0.6 ? { kind: "recruiter", at: at(due + between(r, 0.5, 2) * DAY) } : { kind: "rejection", at: at(due + between(r, 1, 2.5) * DAY) };
  }
  if (o.status === "recruiter") {
    const held = roundAt("recruiter");
    const next: SimKind = TECH_FAMILIES.has(o.job.roleFamily) ? "technical" : "hiring_manager";
    return r() < 0.6 ? { kind: next, at: at(held + between(r, 1, 3) * DAY) } : { kind: "rejection", at: at(held + between(r, 1, 4) * DAY) };
  }
  if (o.status === "hiring_manager" || o.status === "technical") {
    const held = roundAt(o.status);
    return r() < 0.55 ? { kind: "final", at: at(held + between(r, 1, 3) * DAY) } : { kind: "rejection", at: at(held + between(r, 2, 5) * DAY) };
  }
  // final
  const held = roundAt("final");
  return r() < 0.5 ? { kind: "offer", at: at(held + between(r, 2, 5) * DAY) } : { kind: "rejection", at: at(held + between(r, 2, 5) * DAY) };
}

// ——— Emails ———

const RECRUITERS = ["Dana", "Aigerim", "Madina", "Timur", "Laura", "Sofia", "Arman", "Kamila", "Daniel", "Emma", "Nurlan", "Alina"];
const RU_DAYS = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];

function fmtWhen(at: Date, ru: boolean) {
  const date = at.toLocaleDateString(ru ? "ru-RU" : "en-GB", { timeZone: APP_TZ, day: "numeric", month: "long" });
  const time = at.toLocaleTimeString("en-GB", { timeZone: APP_TZ, hour: "2-digit", minute: "2-digit" });
  if (ru) {
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: APP_TZ, weekday: "short" }).format(at));
    return `в ${RU_DAYS[dow]}, ${date}, в ${time} (время Алматы)`;
  }
  const weekday = at.toLocaleDateString("en-GB", { timeZone: APP_TZ, weekday: "long" });
  return `${weekday}, ${date} at ${time} (Almaty time, GMT+5)`;
}

type Mail = { subject: string; body: string };
export type MailCtx = { company: string; title: string; first: string; recruiter: string; when?: Date; pay?: string; ru: boolean; mass: boolean; tech: boolean; r: () => number };

export function employerMail(kind: SimKind, c: MailCtx): Mail {
  const hi = c.ru ? `Здравствуйте${c.first ? `, ${c.first}` : ""}!` : `Hi${c.first ? ` ${c.first}` : ""},`;
  const sign = c.ru ? `С уважением,\n${c.recruiter}, команда подбора ${c.company}` : `Best regards,\n${c.recruiter}\nTalent Acquisition, ${c.company}`;
  const alt = c.r() < 0.5;
  const when = c.when ? fmtWhen(c.when, c.ru) : "";
  if (c.ru) {
    switch (kind) {
      case "confirmation": return { subject: `Мы получили ваш отклик — ${c.title}`, body: `${hi}\n\nСпасибо за отклик на вакансию «${c.title}» в ${c.company}. Мы получили ваше резюме — рекрутер изучит его в ближайшие дни и вернётся с ответом.\n\n${sign}` };
      case "rejection": return { subject: `Ваш отклик на вакансию «${c.title}»`, body: `${hi}\n\nБлагодарим за интерес к ${c.company} и время, которое вы уделили отклику. К сожалению, сейчас мы не готовы пригласить вас на следующий этап по вакансии «${c.title}». Мы сохраним ваше резюме и напишем, если появится подходящая позиция.\n\n${sign}` };
      case "assessment": return { subject: `${c.company}: тестовое задание — ${c.title}`, body: `${hi}\n\nСпасибо за отклик на вакансию «${c.title}». Следующий шаг — ${c.tech ? "тестовое задание (практическая задача, около 2–3 часов)" : "короткое онлайн-тестирование (около 40 минут)"}. Выполнить его нужно в течение 5 дней.\n\nУдачи!\n${sign}` };
      case "recruiter": return { subject: `Приглашение на интервью — ${c.title}`, body: `${hi}\n\nМы посмотрели ваше резюме и приглашаем вас на интервью с рекрутером ${when}. Созвон займёт около 30 минут: расскажем о команде и задачах, обсудим ваш опыт и ожидания. Ссылку на звонок пришлём накануне.\n\n${sign}` };
      case "hiring_manager": return { subject: `Следующий этап — ${c.title}`, body: `${hi}\n\nСпасибо за разговор! Приглашаем вас на интервью с hiring manager команды ${when}. Встреча займёт около часа.\n\n${sign}` };
      case "technical": return { subject: `Техническое интервью — ${c.title}`, body: `${hi}\n\nСпасибо за разговор! Приглашаем вас на техническое интервью ${when}. Около часа: разберём практическую задачу и ваш опыт.\n\n${sign}` };
      case "final": return { subject: `Финальный этап — ${c.title}`, body: `${hi}\n\nОтличные новости: приглашаем вас на финальное интервью с руководителем направления ${when}.\n\n${sign}` };
      case "offer": return { subject: `Оффер — ${c.title}`, body: `${hi}\n\nРады предложить вам позицию «${c.title}» в ${c.company}! ${c.pay ?? ""}\nОфициальный оффер с деталями — во вложении к следующему письму. Будем рады ответу в течение недели.\n\n${sign}` };
    }
  }
  switch (kind) {
    case "confirmation": return alt
      ? { subject: `We received your application — ${c.title}`, body: `${hi}\n\nThank you for applying to ${c.company}! We have received your application for ${c.title} and our team will review it over the next few days.\n\n${sign}` }
      : { subject: `Thanks for applying to ${c.company}`, body: `${hi}\n\nThank you for your application for the ${c.title} role. It has been received and is now with our recruiting team. We'll get back to you as soon as we have reviewed it.\n\n${sign}` };
    case "rejection": return alt
      ? { subject: `Your application to ${c.company}`, body: `${hi}\n\nThank you for your interest in the ${c.title} position and for the time you put into your application. Unfortunately, we have decided to move forward with other candidates whose experience more closely matches our current needs.\n\nWe will keep your details on file and wish you the best in your search.\n\n${sign}` }
      : { subject: `Update on your application — ${c.title}`, body: `${hi}\n\nThanks again for applying to ${c.company}. After careful review we will not be moving forward with your application for ${c.title} at this time. Unfortunately, we can only continue with a small number of candidates.\n\n${sign}` };
    case "assessment": return c.tech
      ? { subject: `${c.company} — next step: take-home assessment`, body: `${hi}\n\nThank you for applying for ${c.title}. As a next step, we'd like you to complete a short take-home assessment (about 2–3 hours of work). Please submit it within 5 days.\n\nGood luck!\n${sign}` }
      : { subject: `${c.company} — online assessment`, body: `${hi}\n\nThanks for your interest in ${c.title}. As a next step, please complete this online assessment (about 40 minutes) within 5 days.\n\nGood luck!\n${sign}` };
    case "recruiter": return { subject: `Interview invitation — ${c.title} at ${c.company}`, body: `${hi}\n\nWe reviewed your application and would like to invite you to an interview with our recruiter on ${when}. It is a 30-minute video call to get to know you, talk about the role and answer your questions. A calendar invite with the link will follow.\n\n${sign}` };
    case "hiring_manager": return { subject: `Next step — ${c.title} at ${c.company}`, body: `${hi}\n\nThank you for the great conversation! We would like to invite you to an interview with the hiring manager on ${when}. The call takes about an hour.\n\n${sign}` };
    case "technical": return { subject: `Technical interview — ${c.title}`, body: `${hi}\n\nThank you for your time so far! We would like to invite you to an interview with the team: the next step is a technical interview on ${when}. Plan for about 60–75 minutes.\n\n${sign}` };
    case "final": return { subject: `Final interview — ${c.title} at ${c.company}`, body: `${hi}\n\nGreat news: we would like to invite you to an interview for the final round on ${when}, with the head of the department.\n\n${sign}` };
    case "offer": return { subject: `Offer — ${c.title} at ${c.company}`, body: `${hi}\n\nWe are pleased to extend you an offer for the ${c.title} position at ${c.company}! ${c.pay ?? ""}\nThe formal offer letter with all details follows in a separate email. We would love to hear back from you within a week.\n\n${sign}` };
  }
}

/** Offer pay as the employer states it: the local currency and period of the role, from an annual USD amount. */
function localPay(usd: number, job: { countries: string; location: string; remote: string }, ru: boolean) {
  const c = j<string[]>(job.countries, []);
  const g = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const r10k = (n: number) => Math.round(n / 10000) * 10000;
  if (c.includes("KZ") && !c.includes("*")) {
    const m = r10k((usd * 500) / 12);
    return ru ? `Заработная плата — ${String(m).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₸ в месяц до вычета налогов.` : `The offer is a monthly gross salary of ${g(m)} KZT.`;
  }
  if (c.includes("GB")) return `The base salary is £${g(Math.round(usd / 1.27 / 1000) * 1000)} per year.`;
  if (c.some((x) => ["UZ", "KG", "GE", "AM"].includes(x))) return ru ? `Заработная плата — $${g(Math.round(usd / 12 / 100) * 100)} в месяц.` : `The salary is $${g(Math.round(usd / 12 / 100) * 100)} per month (net).`;
  if (c.includes("AE")) return `The package is AED ${g(Math.round(usd / 0.27 / 12 / 500) * 500)} per month, tax-free.`;
  if (c.includes("US") || c.includes("*")) return `The base salary is $${g(usd)} per year.`;
  return `The base salary is €${g(Math.round(usd / 1.08 / 1000) * 1000)} per year.`;
}

const REGION_OF = (countries: string[]) =>
  countries.includes("KZ") && !countries.includes("*") ? "KZ" : countries.includes("GB") ? "UK" : countries.includes("US") ? "US" : countries.includes("AE") ? "MENA" : countries.includes("*") ? "WORLD" : countries.some((x) => ["UZ", "KG", "GE", "AM"].includes(x)) ? "CIS" : "EU";

// ——— Applying a step ———

const STEP_STATUS: Record<SimKind, string> = { confirmation: "pending", rejection: "rejected", assessment: "assessment", recruiter: "recruiter", hiring_manager: "hiring_manager", technical: "technical", final: "final", offer: "offer" };

type FullOpp = Awaited<ReturnType<typeof loadOpps>>[number];

function loadOpps(userId: string, onlyId?: string) {
  return db.opportunity.findMany({
    where: {
      ...(onlyId ? { id: onlyId } : {}),
      campaign: { userId, status: { in: ["active", "paused"] } },
      job: { source: FICTIONAL_SOURCE },
      submittedAt: { not: null },
      status: { in: OPEN_STAGES },
    },
    orderBy: { submittedAt: "asc" },
    select: {
      id: true, status: true, submittedAt: true, pInterview: true, updatedAt: true,
      job: { select: { source: true, roleFamily: true, massHiring: true, company: true, title: true, seniority: true, countries: true, location: true, remote: true, salaryMin: true, salaryMax: true, languages: true } },
      interviews: { select: { id: true, round: true, scheduledAt: true, status: true } },
      inbox: { select: { classification: true, receivedAt: true } },
      campaign: { select: { user: { select: { name: true } } } },
    },
  });
}

/** Rows written while applying a step are dated when the email "arrived" (never in the future). */
async function backdate(userId: string, opportunityId: string, mark: Date, at: Date) {
  if (Date.now() - at.getTime() < 60000) return;
  const since = { gte: mark };
  await db.inboxMessage.updateMany({ where: { userId, opportunityId, receivedAt: since }, data: { receivedAt: at } });
  await db.event.updateMany({ where: { userId, opportunityId, createdAt: since }, data: { createdAt: at } });
  await db.interview.updateMany({ where: { userId, opportunityId, createdAt: since }, data: { createdAt: at } });
  await db.offer.updateMany({ where: { userId, opportunityId, createdAt: since }, data: { createdAt: at } });
  await db.notification.updateMany({ where: { userId, createdAt: since, type: { in: ["interview", "assessment", "offer"] } }, data: { createdAt: at } });
}

/**
 * Claims the step before any mail is written: only the run that moves the opportunity's updatedAt from the value it read
 * (with the stage unchanged) plays it. A concurrent run in another instance (cron + a page view) that read the same row
 * gets count 0 and skips, so the employer never writes the same email twice.
 */
// A claimed step holds a short lease: updatedAt is pushed into the future while the reply is written, so a run that read
// the row after the claim (same status, same updatedAt) still can't claim it again. The lease ends when the step finishes
// (releaseStep) or, after a crash, by itself.
const LEASE_MS = 2 * 60 * 1000;
async function claimStep(o: Pick<FullOpp, "id" | "status" | "updatedAt">) {
  const now = new Date();
  if (o.updatedAt > now) return false; // another run holds the lease
  const r = await db.opportunity.updateMany({ where: { id: o.id, status: o.status, updatedAt: o.updatedAt }, data: { updatedAt: new Date(now.getTime() + LEASE_MS) } });
  return r.count > 0;
}
const releaseStep = (id: string) => db.opportunity.update({ where: { id }, data: { updatedAt: new Date() } });

/** Plays one employer reply. Returns false when another run already claimed it (nothing written). */
async function applyStep(userId: string, o: FullOpp, step: SimStep) {
  if (!isFictionalJob(o.job)) throw new Error("simulation: live-feed vacancy"); // never, by construction — a hard guard
  if (!(await claimStep(o))) return false;
  const r = seededRng(`mail:${o.id}:${step.kind}`);
  const ru = j<string[]>(o.job.languages, []).includes("Russian") && !j<string[]>(o.job.languages, []).includes("English");
  const first = (o.campaign.user.name ?? "").trim().split(/\s+/)[0] ?? "";
  const round = ["recruiter", "hiring_manager", "technical", "final"].includes(step.kind) ? step.kind : step.kind === "assessment" ? "assessment" : null;
  // The round's date: an interview 2–5 working days after the invite; an assessment is due in 5 days. The slot never
  // overlaps the user's other upcoming rounds (±90 min) and is spread over the day (freeRoundSlot, src/lib/time.ts).
  const when = round ? await roundSlot(userId, o, round, round === "assessment" ? new Date(step.at.getTime() + 5 * DAY) : new Date(step.at.getTime() + between(r, 2, 5) * DAY), step.at) : undefined;
  let usd = 0, pay: string | undefined;
  if (step.kind === "offer") {
    const countries = j<string[]>(o.job.countries, []);
    const band = o.job.salaryMin && o.job.salaryMax ? o.job.salaryMin + (o.job.salaryMax - o.job.salaryMin) * between(r, 0.35, 0.7) : marketRange(o.job.roleFamily, o.job.seniority, [REGION_OF(countries)]).mid;
    usd = Math.max(1000, Math.round(band / 1000) * 1000);
    pay = localPay(usd, o.job, ru);
  }
  const m = employerMail(step.kind, { company: o.job.company, title: o.job.title, first, recruiter: RECRUITERS[Math.floor(r() * RECRUITERS.length)], when, pay, ru, mass: o.job.massHiring, tech: TECH_FAMILIES.has(o.job.roleFamily), r });
  const domain = companyDomain(o.job.company);
  const mark = new Date(Date.now() - 1000);
  // Earlier rounds that have taken place by now are done.
  await db.interview.updateMany({ where: { opportunityId: o.id, status: "upcoming", scheduledAt: { lte: step.at } }, data: { status: "done" } });
  await ingestEmail(userId, { from: `${o.job.company} Recruiting <talent@${domain}>`, subject: m.subject, body: m.body, simulated: true, opportunityId: o.id });
  // The templates are classified by Inbox Intelligence like any mail; should a wording ever be read differently, the
  // stage still moves as the script says (and the step is never replayed).
  const expected = STEP_STATUS[step.kind];
  const cur = await db.opportunity.findUnique({ where: { id: o.id }, select: { status: true } });
  if (cur && cur.status === o.status && expected !== o.status) {
    await db.opportunity.update({ where: { id: o.id }, data: { status: expected } });
    await db.inboxMessage.updateMany({ where: { opportunityId: o.id, receivedAt: { gte: mark } }, data: { classification: step.kind === "confirmation" || step.kind === "rejection" || step.kind === "assessment" || step.kind === "offer" ? step.kind : "interview" } });
  }
  if (round && when) {
    const iv = await db.interview.findFirst({ where: { opportunityId: o.id, round }, select: { id: true } });
    if (iv) await rescheduleInterview(iv.id, when, { exact: true });
  }
  if (step.kind === "offer") {
    const region = REGION_OF(j<string[]>(o.job.countries, []));
    const benefits = region === "KZ" ? ["Private health insurance", "Annual bonus up to 2 salaries", "Learning budget"] : region === "US" ? ["Medical, dental and vision", "401(k) match", "Equity"] : ["Health insurance", "Learning budget", "Home-office stipend"];
    await db.offer.updateMany({
      where: { opportunityId: o.id, createdAt: { gte: mark } },
      data: { base: usd, currency: "USD", benefits: s(benefits), vacationDays: region === "KZ" ? 24 : region === "US" ? 20 : region === "UK" ? 25 : 28, probationMonths: 3, noticePeriod: region === "KZ" ? "1 month" : "2 weeks", remote: o.job.remote },
    });
  }
  if (step.kind === "rejection" || step.kind === "offer") {
    await db.interview.updateMany({ where: { opportunityId: o.id, status: "upcoming", scheduledAt: { lte: new Date() } }, data: { status: "done" } });
  }
  // The round the reply answers gets its outcome (the user's own debrief result, if any, is kept): the next stage or an
  // offer → passed, a rejection → failed.
  if (step.kind !== "confirmation" && ROUNDS.includes(o.status)) {
    await db.interview.updateMany({ where: { opportunityId: o.id, round: o.status, status: { in: ["upcoming", "done"] }, OR: [{ scheduledAt: null }, { scheduledAt: { lte: step.at } }] }, data: { status: step.kind === "rejection" ? "failed" : "passed" } });
  }
  await backdate(userId, o.id, mark, step.at);
  await releaseStep(o.id);
  return true;
}

const ROUNDS = ["assessment", "recruiter", "hiring_manager", "technical", "final"];

/**
 * When a simulated employer schedules `round`: a free slot of that day (seeded by the opportunity and round, so a replay
 * picks the same one), away from every other upcoming round of the user — two companies never share a time, and one
 * company never gets two rounds at once.
 */
async function roundSlot(userId: string, o: Pick<FullOpp, "id" | "job">, round: string, at: Date, now: Date) {
  const rows = await db.interview.findMany({
    where: { userId, status: "upcoming", scheduledAt: { not: null }, NOT: { opportunityId: o.id, round } },
    select: { scheduledAt: true, round: true, opportunity: { select: { job: { select: { company: true } } } } },
  });
  const busy = rows.map((b) => ({ at: b.scheduledAt as Date, round: b.round, company: b.opportunity.job.company }));
  return freeRoundSlot(round, at, { now, start: seededRng(`slot:${o.id}:${round}`)(), company: o.job.company, busy });
}

/**
 * An assessment of a fictional employer counts as taken once its deadline has passed: it shows as done («Ждём ответа»)
 * until the employer answers (nextStep). The user never has to do anything for it. Returns how many were closed.
 */
export async function closeTakenAssessments(userId: string, now = new Date()) {
  const r = await db.interview.updateMany({
    where: { userId, round: "assessment", status: "upcoming", scheduledAt: { lte: now }, opportunity: { job: { source: FICTIONAL_SOURCE } } },
    data: { status: "done" },
  });
  return r.count;
}

export type SimulationResult = { steps: number; nextAt: Date | null };

/**
 * Plays every employer reply that is due by `now` for the user's applications to fictional employers (active or paused
 * campaigns). Idempotent: a step changes the stage it was drawn from, so running again only plays what became due since.
 * Returns how many emails arrived and when the next one is due.
 */
export async function simulateEmployerActivity(userId: string, opts: { now?: Date; opportunityId?: string } = {}): Promise<SimulationResult> {
  const now = opts.now ?? new Date();
  let steps = 0;
  let nextAt: Date | null = null;
  await closeTakenAssessments(userId, now);
  for (let pass = 0; pass < 6; pass++) {
    const opps = await loadOpps(userId, opts.opportunityId);
    let progressed = false;
    nextAt = null;
    for (const o of opps) {
      const step = nextStep(o);
      if (!step) continue;
      if (step.at > now) { if (!nextAt || step.at < nextAt) nextAt = step.at; continue; }
      if (!(await applyStep(userId, o, step))) continue;
      steps++;
      progressed = true;
    }
    if (!progressed) break;
  }
  return { steps, nextAt };
}

/**
 * Plays one specific employer reply for one application at `at` (the seed's storyline: an upcoming interview, an open
 * assessment, an offer). Only for open applications to fictional employers; returns false otherwise.
 */
export async function playStep(userId: string, opportunityId: string, kind: SimKind, at: Date) {
  const [o] = await loadOpps(userId, opportunityId);
  if (!o) return false;
  return applyStep(userId, o, { kind, at });
}

/**
 * Staff tool ("employers answer now"): every open application to a fictional employer gets its next scripted reply
 * immediately, whatever its planned time. Silent employers stay silent. Returns how many emails arrived.
 */
export async function fastForwardEmployers(userId: string) {
  let n = 0;
  for (const o of await loadOpps(userId)) {
    const step = nextStep(o);
    if (!step) continue;
    if (await applyStep(userId, o, { ...step, at: new Date() })) n++;
  }
  return n;
}

// ——— No chores (simulation mode only) ———

/** Note on a question or handoff closed because the agent no longer works on that role. */
export const SIM_CLOSED_NOTE = "Вакансия больше не в работе — вопрос закрыт";

/** Approval.status of an answer the agent gave on its own in simulation mode. Never a standing answer in live mode. */
export const SIM_AUTO_STATUS = AUTO_ANSWER_STATUS;

/**
 * Simulation mode keeps nothing on the user's plate. Only the fictional corpus is in scope: live-feed vacancies (real
 * companies) and their questions / handoffs are never touched here — they are simply out of sight (visibleScope,
 * pendingQueueWhere, agentQueue) and come back as they were in live mode. Every open question of a fictional role gets
 * the agent's standing answer (standingAnswer, stored with status SIM_AUTO_STATUS so live mode never reuses it), every
 * open handoff of one is closed, and packages waiting on a shared question take the answer. Idempotent; no-op in live
 * mode. Run by the seed, runTick and, lazily, once per user per few minutes on page views (maybeSettleChores).
 */
export async function settleSimulationChores(userId: string) {
  const out = { answered: 0, closed: 0 };
  if (!isSimulation()) return out;
  const pending = await db.approval.findMany({
    where: { userId, status: "pending", OR: [{ opportunityId: null }, { opportunity: { job: { source: FICTIONAL_SOURCE } } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, question: true, proposed: true, opportunityId: true },
  });
  for (const a of pending) {
    if (a.kind === "handoff") {
      out.closed += (await db.approval.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "rejected", answer: SIM_CLOSED_NOTE, resolvedAt: new Date() } })).count;
      continue;
    }
    const answer = await standingAnswer(userId, a);
    const won = await db.approval.updateMany({ where: { id: a.id, status: "pending" }, data: { status: SIM_AUTO_STATUS, answer, resolvedAt: new Date() } });
    if (!won.count) continue;
    out.answered++;
    if (a.opportunityId) await patchPackageAnswer(a.opportunityId, a.question, answer, "approved");
  }
  await settleSharedAnswers(userId);
  await closeTakenAssessments(userId);
  return out;
}

const chores = new Map<string, { at: number; run: Promise<unknown> }>();
const CHORES_EVERY_MS = 10 * 60000;

/** Guarded settleSimulationChores for page views (requireUser): at most once per user every 10 minutes per process. */
export async function maybeSettleChores(userId: string, now = Date.now()) {
  if (!isSimulation()) return;
  const g = chores.get(userId);
  if (g && now - g.at < CHORES_EVERY_MS) { await g.run; return; }
  const run = settleSimulationChores(userId).catch((e) => { console.error("[simulation] chores failed", userId, e); return captureError(e, { userId, meta: { step: "simulation-chores" } }); });
  chores.set(userId, { at: now, run });
  await run;
}

// ——— Entry points (simulation mode only) ———

const guard = new Map<string, { at: number; nextAt: number | null }>();
const LAZY_EVERY_MS = 6 * HOUR;

/**
 * Cheap, guarded catch-up for pages the user opens (Today): runs the employer simulation when the last run for this
 * user was more than 6 h ago, or a reply it knew about has become due since. No-op in live mode.
 */
export async function maybeSimulateEmployers(userId: string, now = Date.now()) {
  if (!isSimulation()) return 0;
  const g = guard.get(userId);
  if (g && now - g.at < LAZY_EVERY_MS && !(g.nextAt && g.nextAt <= now)) return 0;
  guard.set(userId, { at: now, nextAt: null });
  try {
    const r = await simulateEmployerActivity(userId, { now: new Date(now) });
    guard.set(userId, { at: now, nextAt: r.nextAt?.getTime() ?? null });
    return r.steps;
  } catch (e) {
    console.error("[simulation] employer activity failed", userId, e);
    await captureError(e, { userId, meta: { step: "simulation-employers" } });
    return 0;
  }
}

/** The agent just sent something: the next page view re-checks employer replies instead of waiting out the guard. */
export function resetSimulationGuard(userId: string) {
  guard.delete(userId);
}

/** Cron: employer activity for every user with an active campaign. No-op in live mode. */
export async function simulateAllEmployers(userIds: string[], deadline = Infinity) {
  if (!isSimulation()) return { users: 0, steps: 0 };
  let users = 0, steps = 0;
  for (const userId of [...new Set(userIds)]) {
    if (Date.now() > deadline) break;
    try {
      const r = await simulateEmployerActivity(userId);
      guard.set(userId, { at: Date.now(), nextAt: r.nextAt?.getTime() ?? null });
      steps += r.steps;
      users++;
    } catch (e) {
      console.error("[simulation] employer activity failed", userId, e);
      await captureError(e, { source: "cron", userId, meta: { step: "simulation-employers" } });
    }
  }
  return { users, steps };
}
