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

const CYR_LATIN: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
  р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i",
};

/** An ASCII file-name part: «Freedom Finance» → "Freedom-Finance", «Аналитик данных» → "Analitik-dannykh". */
export function fileSlug(s: string, max = 40) {
  const latin = [...s.normalize("NFKD").replace(/[̀-ͯ]/g, "")].map((ch) => {
    const t = CYR_LATIN[ch.toLowerCase()];
    return t == null ? ch : ch !== ch.toLowerCase() && t ? t[0].toUpperCase() + t.slice(1) : t;
  }).join("");
  return latin.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}

/** The CV PDF file name: company + job title — never the internal version id. «CV-Kaspi-kz-BI-Analyst.pdf». */
export function cvPdfFilename(company: string, title: string) {
  const parts = [fileSlug(company), fileSlug(title, 60)].filter(Boolean);
  return `CV-${parts.join("-") || "application"}.pdf`;
}
