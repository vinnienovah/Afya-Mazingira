import { useCallback, useSyncExternalStore } from "react";
import {
  EXAMPLE_ACTIVITIES, OPERATIONS_STORAGE_KEY, parseActivities, serialiseActivities,
  type StoredActivity,
} from "@/lib/afya/operations-store";

const listeners = new Set<() => void>();
// This session's list, kept in memory too so edits still work when the
// browser refuses storage (private windows, blocked site data).
let memory: string | null = null;
let cached: { raw: string | null; list: StoredActivity[] } | null = null;

function readRaw(): string | null {
  if (memory !== null) return memory;
  try {
    return window.localStorage.getItem(OPERATIONS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function snapshot(): StoredActivity[] {
  const raw = readRaw();
  if (!cached || cached.raw !== raw) cached = { raw, list: parseActivities(raw) ?? EXAMPLE_ACTIVITIES };
  return cached.list;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab saved a newer list.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== OPERATIONS_STORAGE_KEY) return;
    memory = null;
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function save(list: StoredActivity[]) {
  const raw = serialiseActivities(list);
  memory = raw;
  try {
    window.localStorage.setItem(OPERATIONS_STORAGE_KEY, raw);
  } catch {
    // Kept in memory for this session only.
  }
  listeners.forEach((notify) => notify());
}

/** The Operations page's planned activities and a function that changes and saves them. */
export function useStoredActivities() {
  const list = useSyncExternalStore(subscribe, snapshot, () => EXAMPLE_ACTIVITIES);
  const update = useCallback((change: (list: StoredActivity[]) => StoredActivity[]) => save(change(snapshot())), []);
  return [list, update] as const;
}
