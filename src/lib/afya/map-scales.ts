// Colour scales for the Risk Map layers, shared by the map, its legend and the
// tests. Grey means no data, never a low value.

import { RISK_META } from "./constants";
import type { RiskLevel } from "./types";
import type { HourSource } from "./map-data";

export const NO_DATA_COLOUR = "#C9CCCA";

export interface ScaleStep {
  /** Values below this take the step's colour */
  below: number;
  colour: string;
  label: string;
}

// Air temperature in one hue, light to dark, across the range the eleven
// counties span from the cool highlands to the hot dry east.
export const THERMAL_STEPS: ScaleStep[] = [
  { below: 14, colour: "#ECA47F", label: "< 14 °C" },
  { below: 18, colour: "#E28755", label: "14–18 °C" },
  { below: 22, colour: "#D56927", label: "18–22 °C" },
  { below: 26, colour: "#C15000", label: "22–26 °C" },
  { below: 30, colour: "#A53E00", label: "26–30 °C" },
  { below: Infinity, colour: "#822F00", label: "≥ 30 °C" },
];

export const RAIN_STEPS: ScaleStep[] = [
  { below: 0.5, colour: "#EAF4FA", label: "< 0.5 mm" },
  { below: 2, colour: "#93C5FD", label: "0.5–2 mm" },
  { below: 6, colour: "#3786B5", label: "2–6 mm" },
  { below: 12, colour: "#1E5A8A", label: "6–12 mm" },
  { below: Infinity, colour: "#0F3A5C", label: "≥ 12 mm" },
];

export const NDVI_STEPS: ScaleStep[] = [
  { below: 0.2, colour: "#D4B896", label: "NDVI < 0.2" },
  { below: 0.35, colour: "#A8C686", label: "0.2–0.35" },
  { below: 0.5, colour: "#5B9E6B", label: "0.35–0.5" },
  { below: 0.65, colour: "#1A6B3C", label: "0.5–0.65" },
  { below: Infinity, colour: "#0D4625", label: "≥ 0.65" },
];

export function scaleColour(steps: ScaleStep[], value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA_COLOUR;
  return (steps.find((s) => value < s.below) ?? steps[steps.length - 1]).colour;
}

export const thermalColour = (tempC: number | null | undefined) => scaleColour(THERMAL_STEPS, tempC);
export const rainColour = (mm: number | null | undefined) => scaleColour(RAIN_STEPS, mm);
export const ndviColour = (ndvi: number | null | undefined) => scaleColour(NDVI_STEPS, ndvi);

export function outlookColour(category: RiskLevel | null | undefined): string {
  return category ? RISK_META[category].color : NO_DATA_COLOUR;
}

/** i18n keys naming where an hour's value came from. */
export const HOUR_SOURCE_LABEL_KEY: Record<HourSource, string> = {
  station_measured: "map_src_station_measured",
  station_forecast: "map_src_station_forecast",
  regional_forecast: "map_src_regional_forecast",
};
