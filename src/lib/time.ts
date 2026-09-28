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
