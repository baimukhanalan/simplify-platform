// One definition of "today" for every screen: the calendar day in Asia/Almaty (the product's home timezone).

export const APP_TZ = "Asia/Almaty";

const partsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Offset of APP_TZ from UTC at `at`, in ms (Almaty is UTC+5 today; derived from tzdata so a rule change can't skew it). */
function tzOffsetMs(at: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** 00:00 of the current Almaty calendar day, as an absolute instant. */
export function startOfToday(now: Date = new Date()) {
  const off = tzOffsetMs(now);
  const local = new Date(now.getTime() + off);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - off);
}

// ——— Round times (interviews and assessments) ———

const HALF_HOUR = 30 * 60000;
/** Business hours for a proposed interview slot, Almaty time: weekdays, slots start 10:00 … 17:30 (the call ends by 18:00). */
export const SLOT_FIRST_MIN = 10 * 60;
export const SLOT_LAST_MIN = 17 * 60 + 30;

/**
 * The nearest business-hours slot in Asia/Almaty (Mon–Fri, 10:00–18:00, on a 30-minute grid) at or after `at`
 * ("up") or at or before it ("down"). A placeholder «in 3 days» from a 04:31 cycle becomes 10:00 of a working day.
 */
export function businessSlot(at: Date, dir: "up" | "down" = "up") {
  const off = tzOffsetMs(at);
  // "local": a Date whose UTC fields read as Almaty wall-clock time.
  let t = at.getTime() + off;
  t = dir === "up" ? Math.ceil(t / HALF_HOUR) * HALF_HOUR : Math.floor(t / HALF_HOUR) * HALF_HOUR;
  for (let i = 0; i < 14; i++) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    const min = d.getUTCHours() * 60 + d.getUTCMinutes();
    const dayStart = t - min * 60000;
    if (dow === 0 || dow === 6) { t = dir === "up" ? dayStart + 86400000 + SLOT_FIRST_MIN * 60000 : dayStart - 86400000 + SLOT_LAST_MIN * 60000; continue; }
    if (min < SLOT_FIRST_MIN) { t = dir === "up" ? dayStart + SLOT_FIRST_MIN * 60000 : dayStart - 86400000 + SLOT_LAST_MIN * 60000; continue; }
    if (min > SLOT_LAST_MIN) { t = dir === "up" ? dayStart + 86400000 + SLOT_FIRST_MIN * 60000 : dayStart + SLOT_LAST_MIN * 60000; continue; }
    break;
  }
  return new Date(t - off);
}

/** 23:59 of the Almaty calendar day of `at` — an assessment deadline is the end of its day, never «04:30». */
export function endOfDayAlmaty(at: Date) {
  const off = tzOffsetMs(at);
  const local = new Date(at.getTime() + off);
  local.setUTCHours(23, 59, 0, 0);
  return new Date(local.getTime() - off);
}

/**
 * The time a round is stored with. Assessment → 23:59 Almaty of its day; any interview round → a business-hours slot.
 * A future time moves forward to its slot; a past time moves back, so it never jumps into the future.
 */
export function snapRoundTime(round: string, at: Date, now: Date = new Date()) {
  if (round === "assessment") {
    const end = endOfDayAlmaty(at);
    return at <= now && end > now ? at : end;
  }
  return businessSlot(at, at > now ? "up" : "down");
}

/** Two interview rounds closer than this overlap (a call plus travel / buffer on either side). */
export const ROUND_GAP_MS = 90 * 60000;

/**
 * A free business-hours slot for a new round, deterministic for the same inputs. The day is the one snapRoundTime picks
 * for `at`; within it the slots 10:00 … 17:30 are tried starting from `start` (0..1, a seeded draw — so rounds spread
 * over the day instead of all landing on 10:00) and the first one at least ROUND_GAP_MS away from every `busy` round is
 * taken. A full day moves on to the next working day (backwards for a time already past, never into the future).
 * Assessments keep their 23:59 deadline; only a same-company assessment on the same day moves a day on.
 * `busy`: the user's other upcoming rounds (their time and company).
 */
export function freeRoundSlot(round: string, at: Date, opts: { now?: Date; start?: number; company?: string; busy?: { at: Date; company?: string; round?: string }[] } = {}) {
  const now = opts.now ?? new Date();
  const busy = opts.busy ?? [];
  const snapped = snapRoundTime(round, at, now);
  const future = snapped > now;
  const step = future ? 86400000 : -86400000;
  if (round === "assessment") {
    let t = snapped;
    for (let i = 0; i < 14 && busy.some((b) => b.company === opts.company && Math.abs(b.at.getTime() - t.getTime()) < ROUND_GAP_MS); i++) {
      t = endOfDayAlmaty(new Date(t.getTime() + step));
    }
    return t;
  }
  const meetings = busy.filter((b) => b.round !== "assessment").map((b) => b.at.getTime());
  const slots = (SLOT_LAST_MIN - SLOT_FIRST_MIN) / 30 + 1;
  const first = Math.min(slots - 1, Math.max(0, Math.floor((opts.start ?? 0) * slots)));
  const off = tzOffsetMs(snapped);
  let dayLocal = Math.floor((snapped.getTime() + off) / 86400000) * 86400000;
  for (let d = 0; d < 21; d++, dayLocal += step) {
    const dow = new Date(dayLocal).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let k = 0; k < slots; k++) {
      const t = dayLocal + (SLOT_FIRST_MIN + ((first + k) % slots) * 30) * 60000 - off;
      if (!future && t > now.getTime()) continue; // a past round never jumps into the future
      if (meetings.some((m) => Math.abs(m - t) < ROUND_GAP_MS)) continue;
      return new Date(t);
    }
  }
  return snapped; // three weeks fully booked: keep the plain slot rather than none
}
