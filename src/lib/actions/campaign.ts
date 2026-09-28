"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db } from "../db";
import { PLANS } from "../engine/taxonomy";
import { runTick, simulateResponses, logEvent, notify, submit, prepare } from "../engine/agent";
import { createInvoice } from "../payments/kaspi";
import { toUSD } from "../engine/fx";
import { rateLimitUser } from "../rate-limit";

/**
 * Checkout: creates a Kaspi Pay invoice (mock provider) and sends the user to the payment page.
 * The campaign is activated only by the signed payment webhook — see src/lib/payments/kaspi.ts.
 */
export async function checkout(form: FormData) {
  const user = await requireUser();
  const plan = PLANS[String(form.get("plan")) as keyof typeof PLANS] ?? PLANS.local;
  if (!user.goal?.primaryRole) redirect("/app/goal?need=goal");
  // One campaign at a time: a double submit or a second tab must not create (and charge for) another one.
  if (await activeCampaign(user.id)) redirect("/app/campaign");
  // Partner attribution comes from the account (referredByCode), never from the form.
  const invoice = await createInvoice(user.id, plan.key);
  redirect(`/pay/kaspi/${invoice.externalId}`);
}

/**
 * The user's running campaign: active/paused and not past endsAt (ticks expire campaigns lazily, so the status
 * alone can lag). Not exported: every export of a "use server" file is a callable endpoint, and this takes a userId.
 */
async function activeCampaign(userId: string) {
  return db.campaign.findFirst({ where: { userId, status: { in: ["active", "paused"] }, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } });
}

export async function runAgentNow() {
  const user = await requireUser();
  const c = await activeCampaign(user.id);
  // Each cycle runs discovery + AI personalization; cap manual runs per user (cron/first-run ticks count too).
  if (c && (await rateLimitUser("run-agent", user.id, 10, 60 * 60 * 1000, { eventTypes: ["tick"] })).ok) await runTick(c.id);
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
  const offerId = String(form.get("offerId") ?? "");
  const offer = offerId ? await db.offer.findFirst({ where: { id: offerId, userId: user.id }, include: { opportunity: { select: { campaignId: true } } } }) : null;
  // The campaign to close: the one the accepted offer came from, else the running one, else the latest non-hired one.
  const notHired = { userId: user.id, status: { notIn: ["hired", "draft"] } };
  const c =
    (offer?.opportunity?.campaignId ? await db.campaign.findFirst({ where: { ...notHired, id: offer.opportunity.campaignId } }) : null) ??
    (await activeCampaign(user.id)) ??
    (await db.campaign.findFirst({ where: notHired, orderBy: { createdAt: "desc" } }));

  // Double-submit guard: every transition is conditional, and only the request that wins it has side effects.
  const acceptedNow = offer ? (await db.offer.updateMany({ where: { id: offer.id, userId: user.id, status: { not: "accepted" } }, data: { status: "accepted" } })).count > 0 : false;
  const hiredNow = c ? (await db.campaign.updateMany({ where: { id: c.id, status: { not: "hired" } }, data: { status: "hired", hiredAt: new Date() } })).count > 0 : false;
  if (!acceptedNow && !hiredNow) redirect(c || offer ? "/app/hired" : "/app/career");

  if (offer && acceptedNow) {
    if (offer.opportunityId) await db.opportunity.update({ where: { id: offer.opportunityId }, data: { status: "hired" } });
    const p = await db.profile.findUnique({ where: { userId: user.id } });
    if (p) await db.profile.update({ where: { userId: user.id }, data: { salaryExpectation: toUSD(offer.finalBase ?? offer.base, offer.currency) } }); // profile salary is USD
  }
  await db.user.update({ where: { id: user.id }, data: { careerMode: "passive" } });
  await logEvent(user.id, "hired", "HIRED — кампания завершена. Включён Passive Career Mode", offer?.opportunityId);
  await notify(user.id, "hired", offer ? `HIRED: ${offer.role.slice(0, 80)} — ${offer.company.slice(0, 60)}` : "HIRED — кампания завершена", "Поздравляем! Агент перестал подавать заявки и включил Passive Career Mode.", "/app/hired");
  revalidatePath("/app", "layout");
  redirect("/app/career?hired=1");
}
