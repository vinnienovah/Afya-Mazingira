import type { IrrigationEntry } from "./irrigation-log";

// The log is held on the device that recorded it. Nothing is kept on the
// server: a phone shared between two plots would otherwise mix them.
const KEY = "afya.irrigation.v1";

const EMPTY: IrrigationEntry[] = [];
const listeners = new Set<() => void>();

// useSyncExternalStore calls the snapshot on every render and compares by
// identity, so the parsed list is held until the stored text itself changes.
let cachedText: string | null = null;
let cached: IrrigationEntry[] = EMPTY;

function storedText(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(text: string | null): IrrigationEntry[] {
  if (!text) return EMPTY;
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return EMPTY;
    const entries = value.flatMap((e) =>
      e && typeof e === "object" && typeof (e as IrrigationEntry).date === "string" && typeof (e as IrrigationEntry).mm === "number"
        ? [{ date: (e as IrrigationEntry).date, mm: (e as IrrigationEntry).mm }]
        : [],
    );
    return entries.length > 0 ? entries : EMPTY;
  } catch {
    return EMPTY;
  }
}

export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function readLog(): IrrigationEntry[] {
  const text = storedText();
  if (text !== cachedText) {
    cachedText = text;
    cached = parse(text);
  }
  return cached;
}

/** The server has no device log, and neither has the first client render. */
export function readServerLog(): IrrigationEntry[] {
  return EMPTY;
}

export function writeLog(entries: IrrigationEntry[]): void {
  const text = JSON.stringify(entries);
  try {
    window.localStorage.setItem(KEY, text);
  } catch {
    // A full or blocked store costs the record, not the advice.
  }
  cachedText = text;
  cached = entries;
  for (const listener of listeners) listener();
}
