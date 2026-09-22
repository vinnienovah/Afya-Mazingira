// Formatting and unit helpers

import type { Lang } from "./types";

// Nairobi keeps UTC+3 all year, so local dates can be read off a fixed offset.
const EAT_OFFSET_MS = 3 * 3600_000;

export const MONTH_NAMES: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  sw: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"],
};

/** "17 Sep" for a YYYY-MM-DD date, or for the Nairobi date of an ISO timestamp. */
export function fmtDayMonth(iso: string, lang: Lang = "en"): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? iso
    : new Date(Date.parse(iso) + EAT_OFFSET_MS).toISOString().slice(0, 10);
  const [, m, d] = date.split("-");
  return `${Number(d)} ${MONTH_NAMES[lang][Number(m) - 1]}`;
}

/**
 * When a reading was taken, for a "data as of" line: "12:00 EAT" on the same
 * Nairobi day as `nowMs`, "8 Sep, 02:45 EAT" on any other.
 */
export function fmtAsOf(iso: string, lang: Lang = "en", nowMs = Date.now()): string {
  const day = (ms: number) => new Date(ms + EAT_OFFSET_MS).toISOString().slice(0, 10);
  const time = `${fmtTime(iso)} EAT`;
  return day(Date.parse(iso)) === day(nowMs) ? time : `${fmtDayMonth(iso, lang)}, ${time}`;
}

/** Fill {name} placeholders in a translated string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** A signed value with a fixed number of decimals: "+0.4", "-1.2". */
export function fmtSigned(value: number, decimals = 1): string {
  const text = value.toFixed(decimals);
  if (Number(text) === 0) return (0).toFixed(decimals);
  return value > 0 ? `+${text}` : text;
}

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

/** Format an ISO timestamp to "17 Sep 14:00" in Africa/Nairobi. Hourly points
 * spanning more than a day need the date: without it an axis repeats a time. */
export function fmtDateTimeShort(iso: string): string {
  try {
    const d = new Date(iso);
    const day = d.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" });
    return `${day} ${fmtTime(iso)}`;
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
