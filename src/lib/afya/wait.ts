/**
 * The promise's value, or undefined when it takes longer than `ms`. The work
 * itself carries on, so whatever it caches is there for the next request.
 */
export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

// How long a request waits for station history beyond the 30-hour live window
// (days of CHORDS windows on a cold cache) before using its fallback.
export const STATION_HISTORY_WAIT_MS = 4_000;
