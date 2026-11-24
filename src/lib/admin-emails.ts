// Env-based admin promotion. ADMIN_EMAILS is a comma-separated list of e-mails (case-insensitive, spaces ignored),
// e.g. ADMIN_EMAILS="owner@example.com, ops@example.com". On signup an account with such an e-mail is created with
// role "admin"; on every login an existing account with such an e-mail is promoted to "admin" if it isn't one yet.
// This lets the owner register on production and get the admin panel without touching the database.
// Promotion only: removing an address from ADMIN_EMAILS never demotes anyone — change the role in the database for that.
import "server-only";
import { db } from "./db";

export function adminEmails(raw = process.env.ADMIN_EMAILS): Set<string> {
  return new Set((raw ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")));
}

export const isAdminEmail = (email: string, raw = process.env.ADMIN_EMAILS) => adminEmails(raw).has(email.trim().toLowerCase());

/** The role a new account gets: "admin" for ADMIN_EMAILS, otherwise "user". */
export const signupRole = (email: string, raw = process.env.ADMIN_EMAILS) => (isAdminEmail(email, raw) ? "admin" : "user");

/** On login: promote to admin when listed in ADMIN_EMAILS. Never demotes. Returns the (possibly new) role. */
export async function promoteIfAdminEmail(user: { id: string; email: string; role: string }, raw = process.env.ADMIN_EMAILS) {
  if (user.role === "admin" || !isAdminEmail(user.email, raw)) return user.role;
  await db.user.update({ where: { id: user.id }, data: { role: "admin" } });
  return "admin";
}
