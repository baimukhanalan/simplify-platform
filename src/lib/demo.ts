import { isSimulation } from "./mode";

// Staff tools (employers answer now; the manual "run agent now" button is only shown there too, though the action itself
// stays available to every user, rate-limited).
//   live mode: the public demo account, staff, and everyone when SIMPLIFY_DEMO_TOOLS=1 (local development by default).
//   simulation mode (src/lib/mode.ts): employers answer on their own, so the tools are hidden from every account except
//   staff (role "admin") — or everyone with an explicit SIMPLIFY_DEMO_TOOLS=1.
export const DEMO_EMAILS = new Set(["demo@simplify.kz"]);

export function demoToolsEnabled(user: { email: string; role?: string } | null | undefined) {
  if (!user) return false;
  if (process.env.SIMPLIFY_DEMO_TOOLS === "1") return true;
  if (isSimulation()) return user.role === "admin";
  if (process.env.NODE_ENV !== "production" && process.env.SIMPLIFY_DEMO_TOOLS !== "0") return true;
  return DEMO_EMAILS.has(user.email) || user.role === "admin";
}
