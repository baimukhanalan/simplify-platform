// CV dates (pure: safe on server and client). One parser for the CV heuristic, years of experience and the UI.
//
// Formats: "Jan 2022", "January 2022", "Sept. 2021", "Январь 2022", "января 2022", "янв. 2022", "01.2022", "1/2022",
// "2022-01", "2022", and open ends "now / present / current / today / н.в. / настоящее время / по настоящее время / сейчас".

type Precision = "month" | "year" | "present";
export type CvDate = { y: number; m: number; precision: Precision };

// Prefix → month (1-based). Russian genitive/nominative/short forms share a prefix: январь / января / янв.
const MONTH_PREFIX: [RegExp, number][] = [
  [/^jan/, 1], [/^feb/, 2], [/^mar/, 3], [/^apr/, 4], [/^may/, 5], [/^jun/, 6], [/^jul/, 7], [/^aug/, 8], [/^sep/, 9], [/^oct/, 10], [/^nov/, 11], [/^dec/, 12],
  [/^янв/, 1], [/^фев/, 2], [/^мар/, 3], [/^апр/, 4], [/^ма[йя]/, 5], [/^июн/, 6], [/^июл/, 7], [/^авг/, 8], [/^сен/, 9], [/^окт/, 10], [/^ноя/, 11], [/^дек/, 12],
];

const MONTH_WORD = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|(?:янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-яё]*\.?`;
const YEAR = String.raw`(?:19|20)\d{2}`;
/** One date token. Order matters: the longer forms first. */
const DATE_SRC = String.raw`(?:(?:${MONTH_WORD})\s*,?\s*${YEAR}|(?:0?[1-9]|1[0-2])\s*[./-]\s*${YEAR}|${YEAR}\s*[./-]\s*(?:0?[1-9]|1[0-2])(?!\d)|${YEAR})`;
/**
 * An open end. Written as a whole phrase, never as a substring test: "янв" contains "нв", and a naive `/н\.?в/` once turned
 * every «Январь 2022» start into «today» (0 months for the current job).
 */
const PRESENT_SRC = String.raw`(?:(?:по|до)\s+)?(?:настоящее\s+время|наст\.?\s*вр(?:емя|\.)?|н\.\s?в\.?|сегодняшний\s+день|сей\s+день|текущий\s+момент|сейчас|now|present|current(?:ly)?|today|ongoing|to\s+date|date|қазір)`;
const SEP_SRC = String.raw`\s*(?:-{1,2}|–|—|‒|−|‐|‑|~|→|\bto\b|\buntil\b|\btill\b|(?<![\p{L}])по(?![\p{L}])|(?<![\p{L}])до(?![\p{L}]))\s*`;

/** A date range anywhere in a line; global — a two-column PDF line can carry two roles. Groups: 1 = start, 2 = end. */
export const RANGE_RE = new RegExp(String.raw`(?<![\p{L}\p{N}])(${DATE_SRC})${SEP_SRC}(${PRESENT_SRC}|${DATE_SRC})(?![\p{L}\p{N}])`, "giu");
const PRESENT_RE = new RegExp(String.raw`^${PRESENT_SRC}$`, "iu");

/** Ranges in a line, in order. */
export function findRanges(line: string): { start: string; end: string; index: number; length: number }[] {
  return [...line.matchAll(RANGE_RE)].map((m) => ({ start: m[1].trim(), end: m[2].trim(), index: m.index ?? 0, length: m[0].length }));
}
export const hasRange = (line: string) => findRanges(line).length > 0;

const nowParts = (now: Date) => ({ y: now.getFullYear(), m: now.getMonth() + 1 });

/** "Январь 2022" → {2022, 1, month}; "2021" → {2021, 7, year}; "now" → today. Null when it is not a date. */
export function parseCvDate(token: string, now = new Date()): CvDate | null {
  const t = token.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return null;
  if (PRESENT_RE.test(t)) return { ...nowParts(now), precision: "present" };
  const year = t.match(/(?:19|20)\d{2}/);
  if (!year) return null;
  const y = Number(year[0]);
  if (y < 1950 || y > now.getFullYear() + 1) return null;
  const word = t.match(/^[a-zа-яё]+/)?.[0];
  if (word) {
    const month = MONTH_PREFIX.find(([re]) => re.test(word))?.[1];
    return month ? { y, m: month, precision: "month" } : { y, m: 7, precision: "year" };
  }
  const num = t.match(/^(\d{1,2})\s*[./-]\s*\d{4}$/) ?? t.match(/^\d{4}\s*[./-]\s*(\d{1,2})$/);
  if (num) {
    const m = Number(num[1]);
    if (m >= 1 && m <= 12) return { y, m, precision: "month" };
  }
  // A bare year: its middle — "2020 – 2021" reads as about a year, whatever the real months were.
  return { y, m: 7, precision: "year" };
}

/**
 * Interval in fractional months since year 0, or null. The end month counts in full ("Mar 2023 – Dec 2023" = 10 months);
 * an open end runs to today. A same-year "2021 – 2021" counts half a year.
 */
export function rangeMonths(start: string, end: string, now = new Date()): { from: number; to: number } | null {
  const a = parseCvDate(start, now);
  if (!a || a.precision === "present") return null;
  const b = end.trim() ? parseCvDate(end, now) : null;
  if (!b) return null;
  const from = a.y * 12 + (a.m - 1);
  let to: number;
  if (b.precision === "present") {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    to = now.getFullYear() * 12 + now.getMonth() + (now.getDate() - 1) / days;
  } else if (b.precision === "month") to = b.y * 12 + b.m; // inclusive end month
  else to = b.y * 12 + (b.m - 1);
  if (a.precision === "year" && b.precision === "year" && a.y === b.y) to = from + 6;
  if (to < from) return null;
  return { from, to };
}

type DatedFact = { kind: string; startDate: string; endDate: string };

/** Total paid experience from employment date ranges: overlaps merged (two jobs at once count once). */
export function experienceFromFacts(facts: DatedFact[], now = new Date()) {
  const jobs = facts.filter((f) => f.kind === "employment");
  const latestStart = Math.max(-1, ...jobs.map((f) => { const d = parseCvDate(f.startDate, now); return d && d.precision !== "present" ? d.y * 12 + d.m : -1; }));
  const spans: { from: number; to: number }[] = [];
  let dated = 0;
  for (const f of jobs) {
    // A current job is sometimes written with the start only ("Kaspi, 2022"): open-ended when it is the latest one.
    const s = parseCvDate(f.startDate, now);
    const openEnd = !f.endDate.trim() && s && s.precision !== "present" && s.y * 12 + s.m === latestStart ? "now" : f.endDate;
    const r = rangeMonths(f.startDate, openEnd, now);
    if (r) { spans.push(r); dated++; }
  }
  spans.sort((x, y) => x.from - y.from);
  let months = 0;
  let cur: { from: number; to: number } | null = null;
  for (const sp of spans) {
    if (cur && sp.from <= cur.to) cur.to = Math.max(cur.to, sp.to);
    else { if (cur) months += cur.to - cur.from; cur = { ...sp }; }
  }
  if (cur) months += cur.to - cur.from;
  return { years: Math.round((months / 12) * 10) / 10, dated, jobs: jobs.length };
}

/** Years of experience derivable from the facts alone (employment ranges, overlaps merged). 0 when nothing is dated. */
export const yearsFromFacts = (facts: DatedFact[], now = new Date()) => experienceFromFacts(facts, now).years;

/**
 * The years value to trust after a parse. Dated roles are the evidence: when every role has parseable dates the merged
 * ranges win (an AI total or a heuristic slip can't contradict them); when some roles are undated the ranges are a floor.
 */
export function reliableYears(stated: number, facts: DatedFact[], now = new Date()) {
  const e = experienceFromFacts(facts, now);
  const s = Number.isFinite(stated) && stated > 0 ? Math.round(stated * 10) / 10 : 0;
  if (!e.dated) return s;
  if (e.dated === e.jobs) return e.years;
  return Math.max(e.years, s);
}

const MONTH_RU_SHORT = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];

/** One CV date for the Russian UI: "Jan 2024" → «янв. 2024», "2021" → «2021», "present" → «сейчас». Unknown text as is. */
export function fmtFactDate(token: string, now = new Date()) {
  const d = parseCvDate(token, now);
  if (!d) return token.trim();
  if (d.precision === "present") return "сейчас";
  if (d.precision === "year") return String(d.y);
  return `${MONTH_RU_SHORT[d.m - 1]} ${d.y}`;
}

/** A fact's period for the Russian UI: «янв. 2024 — сейчас», «2020 — 2021», «сент. 2019». Empty when there are no dates. */
export function fmtFactPeriod(start: string, end: string, now = new Date()) {
  const a = start.trim() ? fmtFactDate(start, now) : "";
  const b = end.trim() ? fmtFactDate(end, now) : "";
  if (a && b) return `${a} — ${b}`;
  return a || b;
}
