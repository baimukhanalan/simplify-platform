import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { hhAuthorizeUrl, hhEnabled, hhRedirectUri } from "@/lib/hh/client";
import { HH_STATE_COOKIE, HH_STATE_TTL_S, newOAuthState } from "@/lib/hh/oauth-state";

/**
 * Start connecting the user's OWN hh.kz account (OAuth authorization code). The signed state lives in an httpOnly
 * cookie scoped to the callback; hh redirects back to /api/integrations/hh/callback.
 */
export async function GET(req: NextRequest) {
  const user = await requireUser();
  const back = (q: string) => NextResponse.redirect(new URL(`/app/agent?hh=${q}#hh`, req.url));
  if (!hhEnabled()) return back("disabled");
  const redirectUri = hhRedirectUri(req.nextUrl.origin);
  if (!redirectUri) return back("error");
  const { nonce, cookie } = newOAuthState(user.id);
  const res = NextResponse.redirect(hhAuthorizeUrl(nonce, redirectUri));
  res.cookies.set(HH_STATE_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/integrations/hh", maxAge: HH_STATE_TTL_S });
  return res;
}
