"use server";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db, noNul } from "../db";
import { createSession, destroySession, hashPassword, verifyPassword, safeNext } from "../auth";
import { rateLimit } from "../rate-limit";

// Compared against when the email is unknown, so response time doesn't reveal registered emails.
const DUMMY_HASH = "$2b$10$amW.fFYYQfcqtq3LP07xoOVkitHOgBKqneTNY/32vhppfmc8w9MRi";

export type AuthState = { error?: string } | undefined;

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const rl = await rateLimit("login", 10, 15 * 60 * 1000);
  const rlEmail = await rateLimit(`login:${email}`, 8, 15 * 60 * 1000);
  if (!rl.ok || !rlEmail.ok) return { error: "Слишком много попыток. Попробуй через 15 минут." };
  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) return { error: "Неверный email или пароль" };
  await createSession(user.id);
  redirect(safeNext(form.get("next")));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const name = noNul(String(form.get("name") ?? "")).trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ref = normalizeReferral(form.get("ref"));
  const rl = await rateLimit("signup", 5, 60 * 60 * 1000);
  if (!rl.ok) return { error: "Слишком много регистраций с этого адреса. Попробуй позже." };
  if (name.length < 2) return { error: "Введи имя" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Некорректный email" };
  if (password.length < 8) return { error: "Пароль — минимум 8 символов" };
  if (form.get("terms") !== "on") return { error: "Нужно согласие с условиями и политикой данных" };
  if (await db.user.findUnique({ where: { email } })) return { error: "Аккаунт с таким email уже есть — войди" };
  // An unknown or malformed code is ignored (signup still succeeds), never stored.
  const partner = ref ? await db.partner.findUnique({ where: { code: ref }, select: { code: true } }) : null;
  let user: { id: string };
  try {
    user = await db.user.create({
      data: {
        name, email, passwordHash: await hashPassword(password), referredByCode: partner?.code ?? null,
        consents: JSON.stringify({ terms: true, autoSubmit: true, emailScan: false, copilot: true, analytics: form.get("analytics") === "on", at: new Date().toISOString() }),
        profile: { create: {} }, goal: { create: {} },
      },
    });
  } catch (e) {
    // Concurrent double-submit: the unique email index wins the race.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "Аккаунт с таким email уже есть — войди" };
    throw e;
  }
  await db.event.create({ data: { userId: user.id, type: "signup", message: "Аккаунт создан" } });
  await createSession(user.id);
  const plan = String(form.get("plan") ?? "");
  redirect(plan === "local" || plan === "international" ? `/onboarding?plan=${plan}` : "/onboarding");
}

/** Referral code as stored: upper-case, 2–32 of A–Z, 0–9, "-" or "_". Anything else is no code. */
function normalizeReferral(raw: FormDataEntryValue | string | null | undefined) {
  const code = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9_-]{2,32}$/.test(code) ? code : null;
}

export type ReferralCheck = { valid: boolean; partnerName: string | null };

/** For the signup badge («Код партнёра: AMA Skills»): is this referral code a real partner's? Rate-limited per address. */
export async function checkReferral(code: string): Promise<ReferralCheck> {
  const ref = normalizeReferral(code);
  if (!ref) return { valid: false, partnerName: null };
  const rl = await rateLimit("referral-check", 30, 10 * 60 * 1000);
  if (!rl.ok) return { valid: false, partnerName: null };
  const partner = await db.partner.findUnique({ where: { code: ref }, select: { name: true } });
  return partner ? { valid: true, partnerName: partner.name } : { valid: false, partnerName: null };
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
