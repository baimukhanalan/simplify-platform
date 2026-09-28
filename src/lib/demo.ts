// Demo-only tools (simulated employer replies, manual agent runs) are available to the public demo
// account, to staff, and to everyone when SIMPLIFY_DEMO_TOOLS=1 (local development by default).
export const DEMO_EMAILS = new Set(["demo@simplify.kz"]);

export function demoToolsEnabled(user: { email: string; role?: string } | null | undefined) {
  if (!user) return false;
  if (process.env.SIMPLIFY_DEMO_TOOLS === "1" || (process.env.NODE_ENV !== "production" && process.env.SIMPLIFY_DEMO_TOOLS !== "0")) return true;
  return DEMO_EMAILS.has(user.email) || user.role === "admin";
}
