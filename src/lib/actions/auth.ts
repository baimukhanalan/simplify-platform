"use server";
import { redirect } from "next/navigation";
import { db } from "../db";
import { createSession, destroySession, hashPassword, verifyPassword } from "../auth";

export type AuthState = { error?: string } | undefined;

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return { error: "Неверный email или пароль" };
  await createSession(user.id);
  redirect(String(form.get("next") || "/app"));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ref = String(form.get("ref") ?? "").trim().toUpperCase() || null;
  if (name.length < 2) return { error: "Введите имя" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Некорректный email" };
  if (password.length < 8) return { error: "Пароль — минимум 8 символов" };
  if (form.get("terms") !== "on") return { error: "Нужно согласие с условиями и политикой данных" };
  if (await db.user.findUnique({ where: { email } })) return { error: "Аккаунт с таким email уже есть — войдите" };
  const partner = ref ? await db.partner.findUnique({ where: { code: ref } }) : null;
  const user = await db.user.create({
    data: {
      name, email, passwordHash: await hashPassword(password), referredByCode: partner?.code ?? null,
      consents: JSON.stringify({ terms: true, autoSubmit: true, emailScan: false, copilot: true, analytics: form.get("analytics") === "on", at: new Date().toISOString() }),
      profile: { create: {} }, goal: { create: {} },
    },
  });
  await db.event.create({ data: { userId: user.id, type: "signup", message: "Аккаунт создан" } });
  await createSession(user.id);
  redirect("/onboarding");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
