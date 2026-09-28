// Stable, chronological order for past jobs / projects / education (pure; safe for client and server).

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  янв: 1, фев: 2, мар: 3, апр: 4, мая: 5, май: 5, июн: 6, июл: 7, авг: 8, сен: 9, окт: 10, ноя: 11, дек: 12,
};
const PRESENT = /present|current|now|по н\.?в|настоящ|сейчас|н\.в\./i;

/** "Jan 2024" / "2024-03" / "03.2024" / "2024" → a sortable month index; "present" → +∞; unknown → -∞. */
export function dateRank(s: string | null | undefined): number {
  const v = (s ?? "").trim();
  if (!v) return Number.NEGATIVE_INFINITY;
  if (PRESENT.test(v)) return Number.POSITIVE_INFINITY;
  const year = v.match(/(19|20)\d{2}/)?.[0];
  if (!year) return Number.NEGATIVE_INFINITY;
  const iso = v.match(/(?:19|20)\d{2}[-./](\d{1,2})/)?.[1] ?? v.match(/(\d{1,2})[-./](?:19|20)\d{2}/)?.[1];
  const word = v.toLowerCase().match(/[a-zа-яё]{3}/)?.[0];
  const month = iso ? Number(iso) : word && MONTHS[word] ? MONTHS[word] : 0;
  return Number(year) * 12 + month;
}

/**
 * Current positions first, then by end date, then start date (newest first); ties keep a fixed order by id so the
 * list never reshuffles between renders or after an edit.
 */
export function byRecency<T extends { id: string; startDate?: string | null; endDate?: string | null }>(a: T, b: T) {
  const end = dateRank(b.endDate || (b.startDate ? "present" : "")) - dateRank(a.endDate || (a.startDate ? "present" : ""));
  if (end && Number.isFinite(end)) return end;
  if (end) return end > 0 ? 1 : -1;
  const start = dateRank(b.startDate) - dateRank(a.startDate);
  if (start && Number.isFinite(start)) return start;
  if (start) return start > 0 ? 1 : -1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
