import { NextResponse, type NextRequest } from "next/server";
import { currentUserId } from "@/lib/auth";
import { logEvent } from "@/lib/engine/agent";
import { db } from "@/lib/db";
import { exchangeCode, getMe, hhEnabled, hhRedirectUri, meName, myResumes, storeTokens, HhError } from "@/lib/hh/client";
import { HH_STATE_COOKIE, verifyOAuthState } from "@/lib/hh/oauth-state";

/**
 * hh.kz OAuth callback: verify the signed state, exchange the code, identify the account via GET /me and store the
 * tokens encrypted (Integration userId+provider "hh"). Only applicant accounts are accepted.
 */
export async function GET(req: NextRequest) {
  const back = (q: string) => {
    const res = NextResponse.redirect(new URL(`/app/agent?hh=${q}#hh`, req.url));
    res.cookies.set(HH_STATE_COOKIE, "", { httpOnly: true, path: "/api/integrations/hh", maxAge: 0 });
    return res;
  };
  const userId = await currentUserId();
  if (!userId) return NextResponse.redirect(new URL("/login?next=/app/agent", req.url));
  if (!hhEnabled()) return back("disabled");
  const q = req.nextUrl.searchParams;
  if (!verifyOAuthState(req.cookies.get(HH_STATE_COOKIE)?.value, q.get("state"), userId)) return back("state");
  if (q.get("error")) return back("denied");
  const code = q.get("code");
  const redirectUri = hhRedirectUri(req.nextUrl.origin);
  if (!code || !redirectUri) return back("error");
  try {
    const tokens = await exchangeCode(code, redirectUri);
    const me = await getMe(tokens.access_token);
    if (me.is_applicant === false) return back("not-applicant");
    // One hh account ↔ one Simplify account: checked here for a clear answer, enforced by the DB unique
    // (provider, externalUserId) — a concurrent link of the same account from another user fails with P2002.
    const taken = await db.integration.findFirst({ where: { provider: "hh", externalUserId: String(me.id), userId: { not: userId } }, select: { id: true } });
    if (taken) return back("taken");
    try {
      await storeTokens(userId, tokens, { externalUserId: String(me.id), meta: { name: meName(me) } });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") return back("taken");
      throw e;
    }
    // Exactly one resume: pre-select it (the user can change it on /app/agent).
    try {
      const resumes = await myResumes(userId);
      const row = await db.integration.findUnique({ where: { userId_provider: { userId, provider: "hh" } }, select: { resumeId: true } });
      if (resumes.length === 1 && !row?.resumeId) await db.integration.update({ where: { userId_provider: { userId, provider: "hh" } }, data: { resumeId: resumes[0].id } });
    } catch { /* the selector will load them again */ }
    await logEvent(userId, "integration", `hh.kz подключён: ${meName(me)}`);
    return back("connected");
  } catch (e) {
    console.error("[hh] callback failed", e instanceof HhError ? e.message : e);
    return back("error");
  }
}
