// Calendar helpers for Africa/Nairobi, which keeps UTC+3 all year. Daily
// totals and "today" everywhere in the app mean the Nairobi day.

export const EAT_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86400_000;

/** The Nairobi calendar date (YYYY-MM-DD) of an instant. */
export function nairobiDate(ms: number): string {
  return new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Nairobi calendar date begins. */
export function nairobiDayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - EAT_OFFSET_MS;
}

/** The instant of a Nairobi clock time ("HH:MM") on a Nairobi date. */
export function nairobiTimeMs(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return nairobiDayStartMs(date) + (h * 60 + m) * 60_000;
}

/** The `n` dates ending with `date`, oldest first. */
export function datesEnding(date: string, n: number): string[] {
  const end = Date.parse(`${date}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Day of the year, 1 on 1 January. */
export function dayOfYear(date: string): number {
  const year = Number(date.slice(0, 4));
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
}
