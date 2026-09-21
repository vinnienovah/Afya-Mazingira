import type { FeatureVector } from "./feature-engine";
import type { StateId } from "./types";
import model from "./model/states.json";

// Climate Reflex states: k-means with four clusters on the Conduit archive's
// training months (scripts/fit-models.ts), each cluster named by its centre.
// An observation takes the state of the nearest centre in scaled feature space.

export const STATE_MODEL_SUMMARY = model.summary;

export function classifyState(fv: FeatureVector): StateId {
  let best: StateId = 0;
  let bestDist = Infinity;
  model.centroids.forEach((centre, state) => {
    let dist = 0;
    model.features.forEach((name, j) => {
      const x = (fv[name as keyof FeatureVector] - model.feature_mean[j]) / model.feature_std[j];
      dist += (x - centre[j]) ** 2;
    });
    if (dist < bestDist) {
      bestDist = dist;
      best = state as StateId;
    }
  });
  return best;
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
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].state_id === currentState) return segments[i].start;
  }
  return new Date().toISOString();
}

/** The state that most often follows this one in the archive, and how often it does. */
export function getNextTransition(current: StateId): { state_id: StateId; probability: number } {
  const t = model.transitions[current];
  return { state_id: t.to as StateId, probability: t.probability };
}
