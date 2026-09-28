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
  const ref = String(form.get("ref") ?? "").trim().toUpperCase() || null;
  const rl = await rateLimit("signup", 5, 60 * 60 * 1000);
  if (!rl.ok) return { error: "Слишком много регистраций с этого адреса. Попробуй позже." };
  if (name.length < 2) return { error: "Введи имя" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Некорректный email" };
  if (password.length < 8) return { error: "Пароль — минимум 8 символов" };
  if (form.get("terms") !== "on") return { error: "Нужно согласие с условиями и политикой данных" };
  if (await db.user.findUnique({ where: { email } })) return { error: "Аккаунт с таким email уже есть — войди" };
  const partner = ref ? await db.partner.findUnique({ where: { code: ref } }) : null;
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

export async function logout() {
  await destroySession();
  redirect("/login");
}
