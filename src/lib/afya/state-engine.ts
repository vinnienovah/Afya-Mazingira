import type { FeatureVector } from "./feature-engine";
import type { StateId } from "./types";
import { nextState } from "./constants";

// ─── Climate Reflex Environmental State Engine ────────────────────────────────
// KMeans was trained offline on ~44,000 15-min observations.
// Centroids below are the fitted cluster centers (in normalized feature space).
// Feature order mirrors the 19 features used in the KMeans model.

// Feature names used by the state model
const STATE_FEATURES: (keyof FeatureVector)[] = [
  "temp_sht", "humidity_sht", "si1145_vis", "si1145_ir",
  "wind_spd", "wet_bulb_globe_temp", "wet_bulb_temp",
  "temp_delta_1h", "humidity_delta_1h", "radiation_delta_1h",
  "temp_mean_1h", "wbgt_mean_1h", "temp_std_1h",
  "hour_sin", "hour_cos",
];

// Normalization parameters (mean, std) per feature — fitted on training data
const FEATURE_STATS: Partial<Record<keyof FeatureVector, [number, number]>> = {
  temp_sht: [19.8, 4.2],
  humidity_sht: [63.5, 18.4],
  si1145_vis: [420, 310],
  si1145_ir: [2400, 1850],
  wind_spd: [1.4, 0.7],
  wet_bulb_globe_temp: [17.2, 2.9],
  wet_bulb_temp: [15.1, 2.6],
  temp_delta_1h: [0.1, 0.8],
  humidity_delta_1h: [-0.3, 3.2],
  radiation_delta_1h: [50, 480],
  temp_mean_1h: [19.8, 4.1],
  wbgt_mean_1h: [17.2, 2.8],
  temp_std_1h: [0.4, 0.3],
  hour_sin: [0, 0.71],
  hour_cos: [0, 0.71],
};

// KMeans cluster centroids in normalized [z-score] space
// Cluster mapping: 0=Cool&Humid, 1=RapidWarming, 2=Hot/HighRad, 3=Cooling/Recovery
const CENTROIDS: Record<StateId, Partial<Record<keyof FeatureVector, number>>> = {
  // Cool & Humid Stable: cool, humid, dark, still, low WBGT
  0: {
    temp_sht: -1.4, humidity_sht: 1.3, si1145_vis: -1.3, si1145_ir: -1.3,
    wind_spd: -0.5, wet_bulb_globe_temp: -1.5, wet_bulb_temp: -1.4,
    temp_delta_1h: -0.2, humidity_delta_1h: 0.1, radiation_delta_1h: -0.1,
    temp_mean_1h: -1.4, wbgt_mean_1h: -1.5, temp_std_1h: -0.2,
    hour_sin: 0.6, hour_cos: -0.8,
  },
  // Rapid Warming: warming fast, humidity falling, radiation rising
  1: {
    temp_sht: 0.2, humidity_sht: -0.4, si1145_vis: 0.5, si1145_ir: 0.4,
    wind_spd: -0.2, wet_bulb_globe_temp: -0.3, wet_bulb_temp: -0.3,
    temp_delta_1h: 2.2, humidity_delta_1h: -1.8, radiation_delta_1h: 1.8,
    temp_mean_1h: 0.0, wbgt_mean_1h: -0.4, temp_std_1h: 0.8,
    hour_sin: -0.5, hour_cos: 0.3,
  },
  // Hot / High-Radiation: peak daytime
  2: {
    temp_sht: 1.6, humidity_sht: -1.5, si1145_vis: 1.6, si1145_ir: 1.7,
    wind_spd: 0.8, wet_bulb_globe_temp: 1.8, wet_bulb_temp: 1.5,
    temp_delta_1h: 0.3, humidity_delta_1h: -0.2, radiation_delta_1h: 0.1,
    temp_mean_1h: 1.6, wbgt_mean_1h: 1.8, temp_std_1h: 0.2,
    hour_sin: 0.0, hour_cos: 0.9,
  },
  // Cooling / Recovery: falling temp, humidity recovering
  3: {
    temp_sht: 0.3, humidity_sht: 0.2, si1145_vis: -0.6, si1145_ir: -0.7,
    wind_spd: 0.2, wet_bulb_globe_temp: 0.2, wet_bulb_temp: 0.1,
    temp_delta_1h: -1.8, humidity_delta_1h: 1.5, radiation_delta_1h: -1.4,
    temp_mean_1h: 0.4, wbgt_mean_1h: 0.3, temp_std_1h: -0.3,
    hour_sin: -0.4, hour_cos: -0.4,
  },
};

/**
 * Classify the environmental state from a feature vector.
 * Deterministic — mirrors the offline KMeans model.
 */
export function classifyState(fv: FeatureVector): StateId {
  let bestState: StateId = 0;
  let bestDist = Infinity;

  for (const stateId of [0, 1, 2, 3] as StateId[]) {
    const centroid = CENTROIDS[stateId];
    let dist = 0;
    for (const feat of STATE_FEATURES) {
      const [mean, std] = FEATURE_STATS[feat] ?? [0, 1];
      const normalized = (fv[feat] - mean) / std;
      const c = centroid[feat] ?? 0;
      dist += Math.pow(normalized - c, 2);
    }
    dist = Math.sqrt(dist);
    if (dist < bestDist) {
      bestDist = dist;
      bestState = stateId;
    }
  }
  return bestState;
}

/**
 * Classify full series → segmented state history.
 */
export function buildStateHistory(
  featureSeries: (FeatureVector | null)[],
  timestamps: string[],
): { state_id: StateId; start: string; end: string }[] {
  const segments: { state_id: StateId; start: string; end: string }[] = [];
  let currentState: StateId | null = null;
  let segmentStart = "";

  for (let i = 0; i < featureSeries.length; i++) {
    const fv = featureSeries[i];
    if (!fv) continue;
    const state = classifyState(fv);
    if (state !== currentState) {
      if (currentState !== null) {
        segments.push({ state_id: currentState, start: segmentStart, end: timestamps[i - 1] });
      }
      currentState = state;
      segmentStart = timestamps[i];
    }
  }
  if (currentState !== null) {
    segments.push({ state_id: currentState, start: segmentStart, end: timestamps[timestamps.length - 1] });
  }
  return segments;
}

/** Find the current state's "since" timestamp from a segmented history. */
export function stateSince(segments: { state_id: StateId; start: string; end: string }[], currentState: StateId): string {
  // Find the most recent segment matching the current state
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].state_id === currentState) return segments[i].start;
  }
  return new Date().toISOString();
}

/** Get the next-state transition for a given state. */
export function getNextTransition(current: StateId): { state_id: StateId; probability: number } {
  return nextState(current);
}
