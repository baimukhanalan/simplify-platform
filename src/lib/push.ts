// In-app push moments: where they must not appear. Pure — safe for client components (usePathname) and the server.

/** Screens where a celebratory push would get in the way: the live interview Copilot (the user is mid-interview). */
export const PUSH_EXCLUDED_ROUTES: RegExp[] = [/^\/app\/interviews\/[^/]+\/copilot(?:\/|$)/];

/**
 * Screens that already show a push's news themselves: an offer push on the Offer Desk, a hired push on the HIRED screen.
 * There that push type stays quiet (moment layer and bell notifier alike); other push types still show.
 */
export const PUSH_EXCLUDED_BY_TYPE: Record<string, RegExp[]> = {
  offer: [/^\/app\/offers(?:\/|$)/],
  hired: [/^\/app\/hired(?:\/|$)/],
};

/** True when push moments must be hidden on this path (all of them, or — with `type` — that type's own screens too). */
export const isPushHiddenOn = (pathname: string | null | undefined, routes: RegExp[] = PUSH_EXCLUDED_ROUTES, type?: string | null) =>
  Boolean(pathname) && (routes.some((re) => re.test(pathname!)) || Boolean(type && PUSH_EXCLUDED_BY_TYPE[type]?.some((re) => re.test(pathname!))));

/** A push of `type` is hidden on `pathname`: the global exclusions (Copilot) plus that type's own screens. */
export const isPushTypeHiddenOn = (pathname: string | null | undefined, type: string | null | undefined) => isPushHiddenOn(pathname, PUSH_EXCLUDED_ROUTES, type);
