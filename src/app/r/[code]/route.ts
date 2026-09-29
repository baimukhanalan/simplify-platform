import { NextResponse, type NextRequest } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE, findReferrer, normalizeCode } from "@/lib/referral";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Invite link https://<app>/r/<CODE>: remembers the code for 30 days (httpOnly cookie, read by the signup action) and
 * opens signup with the code prefilled. Unknown codes still land on signup — just without the cookie.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const dest = new URL("/login", req.nextUrl.origin);
  dest.searchParams.set("mode", "signup");
  if (!(await rateLimit("referral-link", 60, 10 * 60 * 1000)).ok) return NextResponse.redirect(dest, 303);
  let decoded = "";
  try { decoded = decodeURIComponent(raw ?? ""); } catch { /* malformed escape → no code */ }
  const code = normalizeCode(decoded);
  if (!code || !(await findReferrer(code))) return NextResponse.redirect(dest, 303);
  dest.searchParams.set("ref", code);
  const res = NextResponse.redirect(dest, 303);
  res.cookies.set(REFERRAL_COOKIE, code, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: REFERRAL_COOKIE_MAX_AGE,
  });
  res.headers.set("cache-control", "no-store");
  return res;
}
