"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db, j } from "../db";
import { PLANS } from "../engine/taxonomy";
import { runTick, simulateResponses, logEvent, submit, prepare } from "../engine/agent";
import { assessReadiness } from "../engine/readiness";

async function readinessFor(userId: string) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true, goal: true, facts: true, _count: { select: { stories: true } } } });
  const p = u.profile!, g = u.goal!;
  return assessReadiness({
    profile: { yearsExperience: p.yearsExperience, skills: j(p.skills, []), englishLevel: p.englishLevel, cvText: p.cvText, summary: p.summary, workAuth: j(p.workAuth, []), needsSponsorship: p.needsSponsorship, linkedin: p.linkedin, github: p.github, portfolio: p.portfolio },
    facts: u.facts, stories: u._count.stories,
    goal: { primaryRole: g.primaryRole, seniority: g.seniority, minSalary: g.minSalary, countries: j(g.countries, []), workModes: j(g.workModes, []), dreamCompanies: j(g.dreamCompanies, []), sponsorshipNeeded: g.sponsorshipNeeded },
  });
}

/**
 * Test-mode checkout: records a paid Payment (provider "test") and activates a 60-day campaign.
 * A real provider (Kaspi Pay / Stripe) plugs in here; the rest of the flow is unchanged.
 */
export async function checkout(form: FormData) {
  const user = await requireUser();
  const plan = PLANS[String(form.get("plan")) as keyof typeof PLANS] ?? PLANS.local;
  if (!user.goal?.primaryRole) redirect("/app/goal?need=goal");
  const code = String(form.get("partner") ?? user.referredByCode ?? "").trim().toUpperCase();
  const partner = code ? await db.partner.findUnique({ where: { code } }) : null;
  const readiness = await readinessFor(user.id);
  const now = new Date();
  const campaign = await db.campaign.create({
    data: { userId: user.id, plan: plan.key, priceKzt: plan.priceKzt, status: "active", mode: user.goal!.mode, readiness: readiness.score, dailyLimit: plan.dailyLimit, autoSubmit: j<{ autoSubmit?: boolean }>(user.consents, {}).autoSubmit !== false, startedAt: now, endsAt: new Date(now.getTime() + plan.days * 86400000) },
  });
  await db.payment.create({ data: { userId: user.id, campaignId: campaign.id, amount: plan.priceKzt, currency: "KZT", provider: "test", status: "paid", partnerCode: partner?.code ?? null, partnerCut: partner ? Math.round(plan.priceKzt * partner.revShare) : 0 } });
  await db.user.update({ where: { id: user.id }, data: { careerMode: "active" } });
  await logEvent(user.id, "campaign_started", `Career Campaign «${plan.label}» запущена на ${plan.days} дней`);
  await runTick(campaign.id);
  revalidatePath("/app", "layout");
  redirect("/app?started=1");
}

export async function activeCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: { in: ["active", "paused"] } }, orderBy: { createdAt: "desc" } });
}

export async function runAgentNow() {
  const user = await requireUser();
  const c = await activeCampaign(user.id);
  if (c) await runTick(c.id);
  revalidatePath("/app", "layout");
}

export async function simulateEmployers() {
  const user = await requireUser();
  await simulateResponses(user.id);
  revalidatePath("/app", "layout");
}

export async function setCampaignStatus(form: FormData) {
  const user = await requireUser();
  const c = await activeCampaign(user.id);
  const status = String(form.get("status"));
  if (!c || !["active", "paused"].includes(status)) return;
  await db.campaign.update({ where: { id: c.id }, data: { status } });
  await logEvent(user.id, "campaign_status", status === "paused" ? "Кампания на паузе" : "Кампания возобновлена");
  revalidatePath("/app", "layout");
}

export async function updateCampaignSettings(form: FormData) {
  const user = await requireUser();
  const c = await activeCampaign(user.id);
  if (!c) return;
  await db.campaign.update({ where: { id: c.id }, data: { dailyLimit: Math.max(1, Math.min(25, Number(form.get("dailyLimit")) || c.dailyLimit)), autoSubmit: form.get("autoSubmit") === "on" } });
  revalidatePath("/app", "layout");
}

/** Manually prepare or submit one opportunity (from the vacancy list). */
export async function prepareOpportunity(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  const o = await db.opportunity.findFirst({ where: { id, campaign: { userId: user.id } } });
  if (o) await prepare(id);
  revalidatePath("/app", "layout");
}

export async function submitOpportunity(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  const o = await db.opportunity.findFirst({ where: { id, campaign: { userId: user.id } } });
  if (o) await submit(id, form.get("via") === "user" ? "user" : "agent");
  revalidatePath("/app", "layout");
}

export async function markHired(form: FormData) {
  const user = await requireUser();
  const c = await db.campaign.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const offerId = String(form.get("offerId") ?? "");
  if (offerId) {
    const offer = await db.offer.findFirst({ where: { id: offerId, userId: user.id } });
    if (offer) {
      await db.offer.update({ where: { id: offerId }, data: { status: "accepted" } });
      if (offer.opportunityId) await db.opportunity.update({ where: { id: offer.opportunityId }, data: { status: "hired" } });
      const p = await db.profile.findUnique({ where: { userId: user.id } });
      if (p) await db.profile.update({ where: { userId: user.id }, data: { salaryExpectation: offer.finalBase ?? offer.base } });
    }
  }
  if (c) await db.campaign.update({ where: { id: c.id }, data: { status: "hired", hiredAt: new Date() } });
  await db.user.update({ where: { id: user.id }, data: { careerMode: "passive" } });
  await logEvent(user.id, "hired", "HIRED — кампания завершена. Включён Passive Career Mode");
  revalidatePath("/app", "layout");
  redirect("/app/career?hired=1");
}

