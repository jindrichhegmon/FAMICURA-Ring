/*
 * Decides whether a recording window is open right now.
 *
 * A window is a daily time range. from > to crosses midnight (22:00-06:00),
 * which is what a night watch needs, so it is a supported shape rather than
 * an error. No DOM access: unit tested in Node.
 */

export const MAX_INTERVALS = 5;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm) {
  if (!HHMM.test(String(hhmm || ""))) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

export function crossesMidnight(interval) {
  const f = toMinutes(interval.from), t = toMinutes(interval.to);
  return f !== null && t !== null && f > t;
}

export function isWithin(interval, date = new Date()) {
  if (!interval || interval.enabled === false) return false;
  const f = toMinutes(interval.from), t = toMinutes(interval.to);
  if (f === null || t === null || f === t) return false;

  const now = date.getHours() * 60 + date.getMinutes();
  return f < t ? (now >= f && now < t) : (now >= f || now < t);
}

/** The first open window, or null. */
export function activeInterval(intervals, date = new Date()) {
  for (const interval of intervals || []) if (isWithin(interval, date)) return interval;
  return null;
}

/**
 * Which camera should be recording now. Returns {deviceId, interval} for the
 * first device with an open window, so the caller has one answer to act on.
 */
export function dueRecording(schedules, date = new Date()) {
  for (const [deviceId, intervals] of Object.entries(schedules || {})) {
    const interval = activeInterval(intervals, date);
    if (interval) return { deviceId, interval };
  }
  return null;
}

export function fmtInterval(interval) {
  return `${interval.from}–${interval.to}` + (crossesMidnight(interval) ? " (přes půlnoc)" : "");
}

/** Blank rows are what an untouched editor row looks like. */
export function collectIntervals(rows) {
  return rows
    .map((r) => ({ from: String(r.from || "").trim(), to: String(r.to || "").trim(),
                   enabled: r.enabled !== false }))
    .filter((r) => r.from || r.to);
}
