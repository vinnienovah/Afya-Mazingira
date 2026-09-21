// Formatting and unit helpers

/** Format an ISO string to "HH:MM" in Africa/Nairobi. */
export function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-KE", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Africa/Nairobi",
    });
  } catch {
    return iso;
  }
}

/** Format an ISO string to "HH:MM" in Africa/Nairobi (alias for display). */
export function fmtTimeShort(iso: string): string {
  return fmtTime(iso);
}

/** Format an ISO date to "D MMM YYYY" in Africa/Nairobi. */
export function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-KE", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Africa/Nairobi",
    });
  } catch {
    return iso;
  }
}

/** Format a time window: "16:30–17:30" */
export function fmtWindow(start: string, end: string): string {
  return `${fmtTime(start)}–${fmtTime(end)}`;
}

/** Format a value with a unit label. */
export function fmtVal(value: number, unit: string, decimals = 1): string {
  return `${value.toFixed(decimals)}${unit}`;
}

/** Format a temperature value with unit. */
export function fmtTemp(c: number, unit: "C" | "F" = "C"): string {
  if (unit === "F") return `${((c * 9) / 5 + 32).toFixed(0)}°F`;
  return `${c.toFixed(1)}°C`;
}

/** Format minutes ago to a human-readable string. */
export function fmtAgo(minutes: number, lang: "en" | "sw" = "en"): string {
  if (minutes < 2) return lang === "sw" ? "sasa hivi" : "just now";
  if (minutes < 60) return lang === "sw" ? `dakika ${minutes} zilizopita` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return lang === "sw" ? `saa ${hours} zilizopita` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return lang === "sw" ? `siku ${days} zilizopita` : `${days}d ago`;
}

/** Convert a JST/any offset ISO to EAT (UTC+3) local hour decimal. */
export function localHour(iso: string): number {
  const d = new Date(iso);
  // Create a new date in Africa/Nairobi timezone
  const eat = new Date(d.toLocaleString("en-US", { timeZone: "Africa/Nairobi" }));
  return eat.getHours() + eat.getMinutes() / 60;
}

/** Round to 1 decimal. */
export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
