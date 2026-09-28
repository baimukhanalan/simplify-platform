// In-app push moments: where they must not appear. Pure — safe for client components (usePathname) and the server.

/** Screens where a celebratory push would get in the way: the live interview Copilot (the user is mid-interview). */
export const PUSH_EXCLUDED_ROUTES: RegExp[] = [/^\/app\/interviews\/[^/]+\/copilot(?:\/|$)/];

/** True when push moments must be hidden on this path. */
export const isPushHiddenOn = (pathname: string | null | undefined, routes: RegExp[] = PUSH_EXCLUDED_ROUTES) =>
  Boolean(pathname) && routes.some((re) => re.test(pathname!));
