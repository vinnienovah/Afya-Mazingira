// Calendar days in Africa/Nairobi. Kenya keeps East Africa Time (UTC+3) all
// year, so a fixed offset is exact. Safe to import on the client.

export const EAT_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86400_000;

/** The Nairobi date (YYYY-MM-DD) of an instant. */
export function nairobiDate(t: number | string | Date): string {
  const ms = typeof t === "number" ? t : new Date(t).getTime();
  return new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Nairobi at the start of a YYYY-MM-DD date, in UTC milliseconds. */
export function nairobiDayStart(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) - EAT_OFFSET_MS;
}

/** A YYYY-MM-DD date moved by a whole number of days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
