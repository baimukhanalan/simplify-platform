// Link helpers (pure — client and server).

/**
 * Demo links go nowhere: example.com / example.org / example.net and any *.example host (RFC 2606), e.g. the simulated
 * vacancies at jobs.example.com and the simulated employers' talent@acme.example. The UI must not render these as
 * clickable "open posting" / booking links. Relative, empty or unparsable input is not a demo URL.
 */
export function isDemoUrl(url: string | null | undefined): boolean {
  const raw = (url ?? "").trim();
  if (!raw) return false;
  let host = "";
  try {
    host = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/\.$/, "");
  return /(^|\.)example\.(com|org|net)$/.test(host) || host === "example" || host.endsWith(".example") || host.endsWith(".invalid") || host.endsWith(".test");
}

/** The URL to render as a link, or null for a demo / empty one. */
export const realUrl = (url: string | null | undefined) => (url && !isDemoUrl(url) ? url : null);
