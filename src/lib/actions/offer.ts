"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "../auth";
import { db, j, s, noNul } from "../db";
import { logEvent } from "../engine/agent";

const PATH = "/app/offers";
const int = (v: FormDataEntryValue | null, max = 100_000_000) => Math.max(0, Math.min(max, Math.round(Number(String(v ?? "").replace(/[\s,]/g, "")) || 0)));
const str = (v: FormDataEntryValue | null, max = 200) => noNul(String(v ?? "")).trim().slice(0, max);
const CURRENCIES = ["USD", "EUR", "GBP", "KZT", "CAD", "AED"];

function terms(form: FormData) {
  const currency = CURRENCIES.includes(String(form.get("currency"))) ? String(form.get("currency")) : "USD";
  return {
    base: int(form.get("base")),
    currency,
    bonus: int(form.get("bonus")),
    equity: str(form.get("equity")),
    signingBonus: int(form.get("signingBonus")),
    benefits: s(str(form.get("benefits"), 1000).split(/[,\n]/).map((b) => b.trim()).filter(Boolean).slice(0, 20)),
    vacationDays: int(form.get("vacationDays"), 365),
    probationMonths: int(form.get("probationMonths"), 24),
    remote: ["remote", "hybrid", "onsite"].includes(String(form.get("remote"))) ? String(form.get("remote")) : "remote",
    relocation: str(form.get("relocation")),
    noticePeriod: str(form.get("noticePeriod"), 60),
  };
}

export type OfferFormState = { error?: string; ok?: boolean } | undefined;

export async function addOffer(_: OfferFormState, form: FormData): Promise<OfferFormState> {
  const user = await requireUser();
  const company = str(form.get("company"), 120);
  const role = str(form.get("role"), 160);
  const t = terms(form);
  if (!company) return { error: "Укажи компанию." };
  if (!role) return { error: "Укажи должность." };
  if (t.base < 1000) return { error: "Укажи годовую базовую зарплату (например, 68000)." };
  const oppId = str(form.get("opportunityId"), 40);
  const opp = oppId ? await db.opportunity.findFirst({ where: { id: oppId, campaign: { userId: user.id } } }) : null;
  await db.offer.create({ data: { userId: user.id, opportunityId: opp?.id ?? null, company, role, ...t } });
  if (opp && !["hired", "offer"].includes(opp.status)) await db.opportunity.update({ where: { id: opp.id }, data: { status: "offer" } });
  await logEvent(user.id, "offer", `Оффер добавлен вручную: ${company} — ${role}`, opp?.id);
  revalidatePath(PATH);
  return { ok: true };
}

async function ownOffer(userId: string, id: string) {
  return db.offer.findFirst({ where: { id, userId } });
}

export async function updateOffer(_: OfferFormState, form: FormData): Promise<OfferFormState> {
  const user = await requireUser();
  const offer = await ownOffer(user.id, str(form.get("offerId"), 40));
  if (!offer) return { error: "Оффер не найден." };
  const t = terms(form);
  if (t.base < 1000) return { error: "Базовая зарплата должна быть годовой суммой." };
  await db.offer.update({ where: { id: offer.id }, data: t });
  revalidatePath(PATH);
  return { ok: true };
}

export async function saveNegotiation(form: FormData) {
  const user = await requireUser();
  const offer = await ownOffer(user.id, str(form.get("offerId"), 40));
  if (!offer || offer.status === "accepted" || offer.status === "declined") return;
  const prev = j<Record<string, unknown>>(offer.negotiation, {});
  const level = ["soft", "balanced", "assertive"].includes(String(form.get("level"))) ? String(form.get("level")) : "balanced";
  const negotiation = { ...prev, level, target: int(form.get("target")), ask: int(form.get("ask")), walkaway: int(form.get("walkaway")), notes: str(form.get("notes"), 2000), savedAt: new Date().toISOString() };
  await db.offer.update({ where: { id: offer.id }, data: { negotiation: s(negotiation), status: "negotiating" } });
  await logEvent(user.id, "negotiation", `Negotiation Assistant: план сохранён (${offer.company}, ask ${negotiation.ask})`, offer.opportunityId);
  revalidatePath(PATH);
}

export async function recordFinal(form: FormData) {
  const user = await requireUser();
  const offer = await ownOffer(user.id, str(form.get("offerId"), 40));
  const finalBase = int(form.get("finalBase"));
  if (!offer || finalBase < 1000 || offer.status === "accepted" || offer.status === "declined") return;
  const prev = j<Record<string, unknown>>(offer.negotiation, {});
  await db.offer.update({ where: { id: offer.id }, data: { finalBase, status: "negotiating", negotiation: s({ ...prev, result: { finalBase, delta: finalBase - offer.base, at: new Date().toISOString() } }) } });
  await logEvent(user.id, "negotiation", `${offer.company}: итог переговоров — база ${finalBase} (${finalBase >= offer.base ? "+" : ""}${finalBase - offer.base})`, offer.opportunityId);
  revalidatePath(PATH);
}

export async function declineOffer(form: FormData) {
  const user = await requireUser();
  const offer = await ownOffer(user.id, str(form.get("offerId"), 40));
  if (!offer || offer.status === "accepted") return;
  await db.offer.update({ where: { id: offer.id }, data: { status: "declined" } });
  await logEvent(user.id, "offer", `Оффер отклонён: ${offer.company}`, offer.opportunityId);
  revalidatePath(PATH);
}
