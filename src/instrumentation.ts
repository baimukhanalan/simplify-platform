import type { Instrumentation } from "next";

/**
 * Server errors of Server Components, Route Handlers, Server Actions and the proxy → ErrorLog (+ Sentry when SENTRY_DSN
 * is set). Awaited as Next asks; captureError itself is bounded (≤1.5 s) and never throws.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // Prisma needs Node; the app has no edge routes.
  try {
    const { captureError, sourceOfRouteType } = await import("./lib/monitoring");
    const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : "";
    await captureError(err, {
      source: sourceOfRouteType(context.routeType),
      // routePath is the file-system route (/app/applications/[id]) — groups well; the concrete path only as a fallback.
      route: context.routePath || request.path,
      digest,
      userId: await userIdFromHeaders(request.headers),
      meta: { method: request.method, routeType: context.routeType, renderSource: context.renderSource ?? null, path: request.path },
    });
  } catch {
    /* never let monitoring affect the response */
  }
};

/** The session user, read from the request's cookie header (JWT verify only, no DB). */
async function userIdFromHeaders(headers: NodeJS.Dict<string | string[]>): Promise<string | null> {
  try {
    const cookie = [headers.cookie ?? ""].flat().join("; ");
    const { sessionUserIdFromCookieHeader } = await import("./lib/monitoring/session");
    return await sessionUserIdFromCookieHeader(cookie);
  } catch {
    return null;
  }
}
