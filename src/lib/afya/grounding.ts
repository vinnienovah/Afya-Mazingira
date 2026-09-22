// Grounding check for model-written explanations.
// Structured output fixes the shape of a reply; this checks its content
// against the facts the model was given. A reply that states a number, clock
// time, risk band or data-quality category the facts do not contain is
// rejected, and the caller moves on to the next provider or the template.

import type { QualityStatus, RiskLevel } from "./types";

export interface Grounding {
  /** Values a reply may give in °C */
  temperatures: number[];
  /** Values a reply may give as a percentage */
  percents: number[];
  /** Values a reply may give in millimetres */
  millimetres: number[];
  /** Every number the model was shown, whatever its unit */
  numbers: number[];
  /** Clock times as HH:MM, Africa/Nairobi */
  times: string[];
  /** Risk bands a reply may state: the current one, plus a plan window's own */
  risks: RiskLevel[];
  quality: QualityStatus;
}

export type GroundingVerdict = { ok: true } | { ok: false; reason: string };

type Unit = "c" | "pct" | "mm" | "f" | "other" | "none";

const CLOCK_IN_TEXT = /\b(\d{1,2}):(\d{2})\b/g;
const NUMBER_IN_TEXT = /-?\d+(?:\.\d+)?/g;

/**
 * Builds the grounding from the flat facts object the model saw. The unit of a
 * number comes from its key: `_c` is °C, `_pct` a percentage, `_mm` and
 * `_mm_day` millimetres. Strings contribute the clock times and numbers they
 * contain, so a range such as "18.8–21.2" allows both ends. Numbers and times
 * in the person's own question are allowed too: repeating them is not inventing.
 */
export function groundingFromFacts(
  facts: Record<string, unknown>,
  risks: RiskLevel[],
  quality: QualityStatus,
  question?: string | null,
): Grounding {
  const g: Grounding = { temperatures: [], percents: [], millimetres: [], numbers: [], times: [], risks, quality };

  const add = (key: string, value: number) => {
    g.numbers.push(value);
    if (/_c$/.test(key)) g.temperatures.push(value);
    else if (/_mm(?:_day)?$/.test(key)) g.millimetres.push(value);
    else if (/_pct$/.test(key)) {
      g.percents.push(value);
      // The same share may be written as a fraction: 25 % as 0.25.
      g.numbers.push(value / 100);
    }
  };

  for (const [key, value] of Object.entries(facts)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      add(key, value);
    } else if (typeof value === "string") {
      for (const m of value.matchAll(CLOCK_IN_TEXT)) g.times.push(clock(Number(m[1]), Number(m[2])));
      const withoutClocks = value.replace(CLOCK_IN_TEXT, " ");
      // A hyphen between two digits is a range, not a minus sign.
      for (const m of withoutClocks.replace(/(\d)\s*[-–—]\s*(?=\d)/g, "$1 ").matchAll(NUMBER_IN_TEXT)) {
        add(key, Number(m[0]));
      }
    }
  }

  if (question) {
    const { times, rest } = extractTimes(normalise(question));
    for (const time of times) g.times.push(...time.readings);
    for (const n of extractNumbers(rest)) {
      const value = n.signed ? n.sign * n.value : n.value;
      g.numbers.push(value);
      g.temperatures.push(value);
      g.percents.push(value);
      g.millimetres.push(value);
    }
  }
  return g;
}

/** Checks a reply against the grounding; the first problem found is returned. */
export function checkGrounding(text: string, grounding: Grounding): GroundingVerdict {
  const clean = normalise(text);

  const medical = MEDICAL.exec(clean);
  if (medical) return { ok: false, reason: `medical term "${medical[0]}"` };

  for (const band of assertedRiskBands(clean)) {
    if (!grounding.risks.includes(band)) return { ok: false, reason: `risk band ${band}` };
  }
  for (const status of assertedQuality(clean)) {
    if (status !== grounding.quality) return { ok: false, reason: `data quality ${status}` };
  }

  const { times, rest } = extractTimes(clean);
  for (const time of times) {
    if (!time.readings.some((r) => grounding.times.includes(r))) {
      return { ok: false, reason: `time "${time.raw.trim()}"` };
    }
  }

  for (const n of extractNumbers(rest)) {
    if (!numberAllowed(n, grounding)) return { ok: false, reason: `number "${n.raw.trim()}"` };
  }
  return { ok: true };
}

function normalise(text: string): string {
  return text
    .replace(/[\u00a0\u202f\u2009]/g, " ")
    .replace(/\u2212/g, "-")
    .replace(/[º˚]/g, "°")
    .replace(/℃/g, "°C")
    .replace(/℉/g, "°F");
}

function clock(h: number, m: number): string {
  return `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// Medical claims

const MEDICAL = /\b(?:diagnos(?:e|es|ed|is|ing)|malaria|cholera|asthma attack|hospitals?|hospitali|kipindupindu)\b/i;

// Risk bands and data quality

const BANDS: { re: RegExp; level: RiskLevel }[] = [
  { re: /^(?:very[\s_-]*high|juu\s+sana)\b/i, level: "VERY_HIGH" },
  { re: /^(?:elevated|imeinuka|iliyoinuka)\b/i, level: "ELEVATED" },
  { re: /^(?:high|juu)\b/i, level: "HIGH" },
  { re: /^(?:low|chini)\b/i, level: "LOW" },
];

const QUALITIES: { re: RegExp; status: QualityStatus }[] = [
  { re: /^(?:good|nzuri|mzuri)\b/i, status: "GOOD" },
  { re: /^(?:degraded|reduced|imedhoofika|umedhoofika|hafifu|umepungua|dhaifu)\b/i, status: "DEGRADED" },
  { re: /^(?:poor|mbaya|duni)\b/i, status: "POOR" },
];

// Words that may sit between a subject and the category it is given:
// "thermal exposure risk is currently ELEVATED", "hatari ya joto ni JUU".
const LINKING = new RegExp(
  "^(?:[\\s:=,\"'“”‘’()\\-–—]|\\b(?:is|are|remains|stays|stands|sits|was|will|be|remain|stay|becomes?|has|have|been|" +
    "rated|as|currently|now|still|today|at|of|an?|the|which|level|category|tier|band|ni|iko|ipo|imekuwa|itakuwa|" +
    "kwa|sasa|katika|kiwango|cha|ya)\\b)+",
  "i",
);

const EN_RISK_SUBJECT =
  /\b(?:(?:thermal|heat|heat[- ]stress|exposure)\s+(?:exposure\s+)?risk(?:\s+(?:level|tier|category|band|rating))?|risk\s+(?:level|tier|category|band|rating))\b/gi;
const SW_RISK_SUBJECT =
  /\b(?:kiwango\s+cha\s+hatari(?:\s+ya\s+(?:kupatwa\s+na\s+)?joto)?|hatari\s+ya\s+(?:kupatwa\s+na\s+|kupata\s+)?joto)\b/gi;
// "an ELEVATED thermal exposure risk", "a low-risk time"
const BAND_BEFORE_RISK =
  /\b(very[\s_-]*high|elevated|high|low)(?:["'”’]\s*)?[\s-]+(?:(?:thermal|heat|heat-stress|exposure)\s+)*risk\b(?!\s+(?:of|for|from)\s+(?!heat|thermal|exposure))/gi;
// A bare "risk" is read as the heat risk unless something else qualifies it.
const BARE_RISK = /\brisk\b/gi;
const BARE_HATARI = /\bhatari\b(?!\s+ya\b)/gi;
const OTHER_RISKS =
  /\b(?:rain|rainfall|flood|flooding|drift|spray|spraying|wash-?off|washing|disease|pest|fire|frost|planting|erosion|storm|lightning)\s*$/i;

function bandAt(text: string): RiskLevel | null {
  const rest = text.replace(LINKING, "");
  for (const { re, level } of BANDS) if (re.test(rest)) return level;
  return null;
}

function assertedRiskBands(text: string): RiskLevel[] {
  const found: RiskLevel[] = [];
  const covered: [number, number][] = [];

  for (const re of [EN_RISK_SUBJECT, SW_RISK_SUBJECT]) {
    for (const m of text.matchAll(re)) {
      covered.push([m.index, m.index + m[0].length]);
      const band = bandAt(text.slice(m.index + m[0].length, m.index + m[0].length + 60));
      if (band) found.push(band);
    }
  }
  for (const m of text.matchAll(BAND_BEFORE_RISK)) {
    const band = bandAt(m[1]);
    if (band) found.push(band);
    covered.push([m.index, m.index + m[0].length]);
  }
  for (const re of [BARE_RISK, BARE_HATARI]) {
    for (const m of text.matchAll(re)) {
      if (covered.some(([s, e]) => m.index >= s && m.index < e)) continue;
      if (OTHER_RISKS.test(text.slice(Math.max(0, m.index - 20), m.index))) continue;
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
      if (/^\s+(?:of|for|from)\s+(?!heat|thermal|exposure)/i.test(after)) continue;
      const band = bandAt(after);
      if (band) found.push(band);
    }
  }
  return found;
}

const EN_QUALITY_SUBJECT =
  /\b(?:data\s+quality|quality\s+of\s+(?:the\s+)?(?:station\s+|sensor\s+)?(?:data|readings|observations))\b/gi;
const SW_QUALITY_SUBJECT = /\bubora\s+wa\s+(?:data|takwimu|vipimo)\b/gi;
const QUALITY_BEFORE_SUBJECT = /\b(good|degraded|poor)\s+(?:station\s+)?data\s+quality\b/gi;

function qualityAt(text: string): QualityStatus | null {
  const rest = text.replace(LINKING, "");
  for (const { re, status } of QUALITIES) if (re.test(rest)) return status;
  return null;
}

function assertedQuality(text: string): QualityStatus[] {
  const found: QualityStatus[] = [];
  for (const re of [EN_QUALITY_SUBJECT, SW_QUALITY_SUBJECT]) {
    for (const m of text.matchAll(re)) {
      const status = qualityAt(text.slice(m.index + m[0].length, m.index + m[0].length + 40));
      if (status) found.push(status);
    }
  }
  for (const m of text.matchAll(QUALITY_BEFORE_SUBJECT)) {
    const status = qualityAt(m[1]);
    if (status) found.push(status);
  }
  return found;
}

// Clock times

interface TimeMention {
  raw: string;
  /** Every HH:MM the mention can stand for */
  readings: string[];
}

const SW_DAYPART = /^[^.;!?]{0,25}?\b(?:asubuhi|mchana|alasiri|jioni|usiku|alfajiri)\b/i;

/**
 * Finds clock times and blanks them out of the text, so their digits are not
 * read as numbers. "1:45 PM" reads as 13:45, and a bare "1:45" as either 01:45
 * or 13:45. After "saa", a time with a part of the day ("saa 11:53 jioni") may
 * also be Swahili time, which counts the hours from 06:00.
 */
function extractTimes(text: string): { times: TimeMention[]; rest: string } {
  const times: TimeMention[] = [];
  const patterns = [
    /(?<![\d:.])(\d{1,2}):(\d{2})(?!\d)(?:\s*([ap])\.?\s?m\b\.?)?/gi,
    /(?<![\d:.])(\d{1,2})\.(\d{2})\s*([ap])\.?\s?m\b\.?/gi,
    /(?<![\d:.])(\d{1,2})()\s*([ap])\.?\s?m\b\.?/gi,
  ];
  let rest = text;
  for (const re of patterns) {
    rest = rest.replace(re, (raw: string, hh: string, mm: string, ap: string | undefined, offset: number) => {
      const h = Number(hh);
      const m = mm === "" ? 0 : Number(mm);
      if (m > 59 || h > 24) return raw;
      const readings: string[] = [];
      if (ap) {
        if (h < 1 || h > 12) return raw;
        readings.push(clock((h % 12) + (ap.toLowerCase() === "p" ? 12 : 0), m));
      } else {
        readings.push(clock(h, m));
        const afterSaa = /\bsaa\s*$/i.test(rest.slice(Math.max(0, offset - 6), offset));
        if (h <= 12 && !afterSaa) readings.push(clock(h + 12, m));
        if (h <= 12 && afterSaa && SW_DAYPART.test(rest.slice(offset + raw.length))) {
          const base = (h + 6) % 12;
          readings.push(clock(base, m), clock(base + 12, m));
        }
      }
      times.push({ raw, readings });
      return " ".repeat(raw.length);
    });
  }
  return { times, rest };
}

// Numbers

interface NumberMention {
  raw: string;
  value: number;
  decimals: number;
  signed: boolean;
  sign: 1 | -1;
  unit: Unit;
}

// "May" is left out: "20 may rise" is not a date.
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|" +
  "januari|februari|machi|aprili|juni|julai|agosti|septemba|oktoba|novemba|desemba";
const DATES = new RegExp(
  `\\b\\d{4}-\\d{2}-\\d{2}(?:T[\\d:.]+Z?)?\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\b|\\b(?:${MONTHS})\\s+\\d{1,2}\\b`,
  "gi",
);
const DURATION_AFTER =
  /^\s*-?\s*(?:h|hrs?|hours?|minutes?|mins?|days?|weeks?|months?|years?|yrs?|seconds?|secs?)\b/i;
const DURATION_BEFORE = /\b(?:saa|masaa|dakika|siku|wiki|mwezi|miezi|mwaka|miaka)\s*\+?\s*$/i;

function unitAfter(after: string): Unit | null {
  if (/^\s*(?:°\s*F|fahrenheit)\b/i.test(after)) return "f";
  if (/^\s*°/.test(after)) return "c";
  if (/^\s*(?:degrees?|deg)\b/i.test(after)) return "c";
  if (/^C\b/.test(after)) return "c";
  if (/^\s*(?:nyuzi\s*joto|nyuzijoto|nyuzi|digrii|sentigredi)\b/i.test(after)) return "c";
  if (/^\s*(?:%|percent\b|per\s+cent\b)/i.test(after)) return "pct";
  if (/^\s*(?:mm\b|millimet(?:er|re)s?\b|milimita\b|milimeta\b)/i.test(after)) return "mm";
  if (/^\s*(?:m\/s|km\/h|kph|mph|hpa|mbar|w\/m)/i.test(after)) return "other";
  return null;
}

function unitBefore(before: string): Unit | null {
  if (/(?:nyuzi\s*joto|nyuzijoto|nyuzi|digrii)\s*(?:za\s*)?$/i.test(before)) return "c";
  if (/asilimia\s*$/i.test(before)) return "pct";
  if (/(?:milimita|milimeta)\s*$/i.test(before)) return "mm";
  return null;
}

// "18.8 to 21.2°C": the first number of a range takes the unit of the second.
function rangeUnit(after: string): Unit | null {
  const m = /^\s*(?:–|—|-|to|and|hadi|mpaka|na)\s*[+-]?\d+(?:\.\d+)?/i.exec(after);
  return m ? unitAfter(after.slice(m[0].length)) : null;
}

function extractNumbers(text: string): NumberMention[] {
  const clean = text.replace(DATES, (d) => " ".repeat(d.length));
  const found: NumberMention[] = [];
  for (const m of clean.matchAll(/([+-]?)(\d+(?:\.\d+)?)/g)) {
    const [raw, signText, digits] = m;
    const before = clean.slice(0, m.index);
    const after = clean.slice(m.index + raw.length);

    // Part of a name or code: ERA5, Sentinel-2, 3D-PAWS, 1st.
    if (!signText && /[\p{L}\d.]$/u.test(before)) continue;
    if (signText === "-" && /\p{L}$/u.test(before)) continue;
    if (/^\p{L}/u.test(after) && !/^(?:C\b|mm\b|h\b|hrs?\b)/.test(after)) continue;
    if (/^-\p{L}/u.test(after)) continue;

    if (DURATION_AFTER.test(after) || DURATION_BEFORE.test(before)) continue;

    let signed = signText !== "";
    let sign: 1 | -1 = signText === "-" ? -1 : 1;
    // "18.8-21.2°C" or "18.8°C - 21.2°C" is a range, not a negative number.
    if (signText === "-" && /(?:\d|°\s*C?|%|mm)\s*$/i.test(before)) {
      signed = false;
      sign = 1;
    }

    const value = Number(digits);
    const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
    if (!signed && decimals === 0 && digits.length === 4 && value >= 1900 && value <= 2100) continue;

    const unit = unitAfter(after) ?? unitBefore(before) ?? rangeUnit(after) ?? "none";
    // Small whole numbers with no unit are counts ("two of the 4 sensors").
    if (unit === "none" && decimals === 0 && value <= 12) continue;

    found.push({ raw, value, decimals, signed, sign, unit });
  }
  return found;
}

/**
 * A mention matches a fact when the fact, rounded to the mention's own
 * precision, gives the mention: "24°C" for 23.9 and "0.79" for 0.789 pass,
 * "19.8°C" for 19.5 does not. Without an explicit sign the magnitude is
 * compared, so "26% drier" matches an anomaly of -26.
 */
function numberAllowed(n: NumberMention, g: Grounding): boolean {
  const pool =
    n.unit === "c" ? g.temperatures
      : n.unit === "pct" ? g.percents
        : n.unit === "mm" ? g.millimetres
          : n.unit === "f" ? []
            : g.numbers;
  const tolerance = 0.5 * 10 ** -n.decimals + 1e-9;
  const target = n.signed ? n.sign * n.value : n.value;
  return pool.some((fact) => Math.abs(target - (n.signed ? fact : Math.abs(fact))) <= tolerance);
}
