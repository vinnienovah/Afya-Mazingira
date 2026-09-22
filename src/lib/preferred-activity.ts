import { ACTIVITY_PROFILES } from "./afya/constants";

// The default activity chosen on the Profile page, kept in a cookie so the
// Situation page, the Operations form and the server-rendered briefing all
// plan for the same one.
export const ACTIVITY_COOKIE = "afya_activity";

/** The key when it names a known activity profile, otherwise null. */
export function parseActivityKey(value: string | null | undefined): string | null {
  return value && ACTIVITY_PROFILES.some((p) => p.key === value) ? value : null;
}

/** The /api/situation address for an activity. The default activity uses the plain address. */
export function situationUrl(activity: string | null): string {
  return activity && activity !== "general"
    ? `/api/situation?activity=${encodeURIComponent(activity)}`
    : "/api/situation";
}

const listeners = new Set<() => void>();

/** The saved default activity in the browser, or null. */
export function readPreferredActivity(): string | null {
  try {
    const entry = document.cookie.split("; ").find((c) => c.startsWith(`${ACTIVITY_COOKIE}=`));
    return parseActivityKey(entry ? decodeURIComponent(entry.slice(ACTIVITY_COOKIE.length + 1)) : null);
  } catch {
    return null;
  }
}

/** Save the default activity in the browser, or clear it with null. */
export function setPreferredActivity(key: string | null) {
  const value = parseActivityKey(key);
  try {
    document.cookie = value
      ? `${ACTIVITY_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`
      : `${ACTIVITY_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    return;
  }
  listeners.forEach((notify) => notify());
}

export function subscribePreferredActivity(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
