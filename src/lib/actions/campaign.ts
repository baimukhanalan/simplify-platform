"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "../auth";
import { db } from "../db";
import { PLANS } from "../engine/taxonomy";
import { runTick, simulateResponses, logEvent, submit, prepare } from "../engine/agent";
import { createInvoice } from "../payments/kaspi";
import { toUSD } from "../engine/fx";

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
  const invoice = await createInvoice(user.id, plan.key, String(form.get("partner") ?? ""));
  redirect(`/pay/kaspi/${invoice.externalId}`);
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
      if (p) await db.profile.update({ where: { userId: user.id }, data: { salaryExpectation: toUSD(offer.finalBase ?? offer.base, offer.currency) } }); // profile salary is USD
    }
  }
  if (c) await db.campaign.update({ where: { id: c.id }, data: { status: "hired", hiredAt: new Date() } });
  await db.user.update({ where: { id: user.id }, data: { careerMode: "passive" } });
  await logEvent(user.id, "hired", "HIRED — кампания завершена. Включён Passive Career Mode");
  revalidatePath("/app", "layout");
  redirect("/app/career?hired=1");
}

