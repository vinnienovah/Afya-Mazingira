import type { PlannedActivity } from "./operations";

// Planned activities on the Operations page, kept in the browser so they
// survive a reload. Archiving sets an activity aside rather than deleting it.

export interface StoredActivity extends PlannedActivity {
  status: "active" | "archived";
  // Starter entries shipped with the page, named through i18n.
  example?: boolean;
  name_key?: string;
}

export const OPERATIONS_STORAGE_KEY = "afya_operations_activities";
const FORMAT_VERSION = 1;

export const EXAMPLE_ACTIVITIES: StoredActivity[] = [
  { id: 1, name: "Outdoor sports training", name_key: "ops_example_sports", start_hour: 14, end_hour: 16, activity_type: "sports", status: "active", example: true },
  { id: 2, name: "Field maintenance work", name_key: "ops_example_maintenance", start_hour: 9, end_hour: 12, activity_type: "outdoor_work", status: "active", example: true },
  { id: 3, name: "Campus event setup", name_key: "ops_example_event", start_hour: 13, end_hour: 17, activity_type: "outdoor_event", status: "active", example: true },
  { id: 4, name: "Agricultural field work", name_key: "ops_example_fieldwork", start_hour: 7, end_hour: 11, activity_type: "field_work", status: "active", example: true },
];

export function serialiseActivities(list: StoredActivity[]): string {
  return JSON.stringify({ version: FORMAT_VERSION, activities: list });
}

const isHour = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24;

function isStoredActivity(v: unknown): v is StoredActivity {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "number" && Number.isFinite(a.id) &&
    typeof a.name === "string" && a.name.trim() !== "" &&
    isHour(a.start_hour) && isHour(a.end_hour) &&
    typeof a.activity_type === "string" &&
    (a.status === "active" || a.status === "archived") &&
    (a.example === undefined || typeof a.example === "boolean") &&
    (a.name_key === undefined || typeof a.name_key === "string")
  );
}

/**
 * The stored list, or null when nothing usable is stored, in which case the
 * examples apply. Entries that do not parse are left out.
 */
export function parseActivities(raw: string | null): StoredActivity[] | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const { version, activities } = data as { version?: unknown; activities?: unknown };
  if (version !== FORMAT_VERSION || !Array.isArray(activities)) return null;
  return activities.filter(isStoredActivity);
}

export function setActivityStatus(list: StoredActivity[], id: number, status: StoredActivity["status"]): StoredActivity[] {
  return list.map((a) => (a.id === id ? { ...a, status } : a));
}

export function removeActivity(list: StoredActivity[], id: number): StoredActivity[] {
  return list.filter((a) => a.id !== id);
}

/** A new active activity with an id no other entry uses. */
export function addActivity(
  list: StoredActivity[],
  activity: Omit<PlannedActivity, "id">,
): StoredActivity[] {
  const id = list.reduce((max, a) => Math.max(max, a.id), 0) + 1;
  return [...list, { ...activity, id, status: "active" }];
}
