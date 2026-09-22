/** A depth of water the farmer says they put on the field, net of runoff. */
export interface IrrigationEntry {
  /** Nairobi calendar day, YYYY-MM-DD */
  date: string;
  mm: number;
}

// A single pass deeper than this is beyond a hose, a watering can or one run
// down a furrow, and is more likely a litres-per-plot figure entered as mm.
export const MAX_ENTRY_MM = 150;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function windowStart(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Drop what the balance cannot use, and sum repeats: a field watered twice in
 * a day is one day's water as far as the root zone is concerned. The window is
 * the balance's own, so a longer log changes nothing.
 */
export function normaliseLog(entries: IrrigationEntry[], today: string, windowDays: number): IrrigationEntry[] {
  const first = windowStart(today, windowDays);
  const byDate = new Map<string, number>();
  for (const entry of entries) {
    if (!DATE.test(entry.date) || entry.date < first || entry.date > today) continue;
    if (!Number.isFinite(entry.mm) || entry.mm <= 0) continue;
    const mm = Math.min(MAX_ENTRY_MM, entry.mm);
    byDate.set(entry.date, Math.min(MAX_ENTRY_MM, (byDate.get(entry.date) ?? 0) + mm));
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, mm]) => ({ date, mm: Math.round(mm * 10) / 10 }));
}

export function appliedByDate(entries: IrrigationEntry[]): Map<string, number> {
  return new Map(entries.map((e) => [e.date, e.mm]));
}

export function totalAppliedMm(entries: IrrigationEntry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + e.mm, 0) * 10) / 10;
}
