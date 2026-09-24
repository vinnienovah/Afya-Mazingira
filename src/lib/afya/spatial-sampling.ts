import type { Geometry, Position } from "geojson";

export interface SpatialSample { lat: number; lng: number; weight: number }

function inRing(x: number, y: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function containsPoint(geometry: Geometry, lng: number, lat: number): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  return polygons.some(([outer, ...holes]) => inRing(lng, lat, outer) && !holes.some((h) => inRing(lng, lat, h)));
}

/** Regular cell-centre quadrature across the complete geometry, excluding holes.
 * Cos(latitude) weights approximate cell area. These are spatial samples, not
 * native model cells; statistics and exceedance shares are explicitly estimates.
 * No fabricated fallback point is supplied for an unsampled geometry. */
export function countySamples(geometry: Geometry, divisions = 10): SpatialSample[] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
  const points = polygons.flatMap((p) => p[0]);
  if (!points.length) return [];
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const west = Math.min(...xs), east = Math.max(...xs), south = Math.min(...ys), north = Math.max(...ys);
  if (east <= west || north <= south) return [];
  const samples: SpatialSample[] = [];
  for (let row = 0; row < divisions; row++) for (let col = 0; col < divisions; col++) {
    const lat = south + (row + 0.5) * (north - south) / divisions;
    const lng = west + (col + 0.5) * (east - west) / divisions;
    if (containsPoint(geometry, lng, lat)) samples.push({ lat, lng, weight: Math.cos(lat * Math.PI / 180) });
  }
  return samples;
}

export interface SpatialSummary {
  mean: number | null;
  min: number | null;
  max: number | null;
  above_pct: number | null;
  coverage_pct: number;
  valid_samples: number;
  total_samples: number;
}

/** Missing samples never become zero. Suppress statistics below 80% coverage. */
export function summarizeSamples(samples: SpatialSample[], values: (number | null)[], threshold = 21): SpatialSummary {
  const total = samples.reduce((sum, s) => sum + s.weight, 0);
  const valid = samples.flatMap((s, i) => values[i] != null && Number.isFinite(values[i]) ? [{ ...s, value: values[i]! }] : []);
  const weight = valid.reduce((sum, s) => sum + s.weight, 0);
  const coverage = total ? 100 * weight / total : 0;
  const enough = coverage >= 80 && valid.length >= 2;
  return {
    mean: enough ? valid.reduce((sum, s) => sum + s.value * s.weight, 0) / weight : null,
    min: enough ? Math.min(...valid.map((s) => s.value)) : null,
    max: enough ? Math.max(...valid.map((s) => s.value)) : null,
    above_pct: enough ? 100 * valid.filter((s) => s.value >= threshold).reduce((sum, s) => sum + s.weight, 0) / weight : null,
    coverage_pct: coverage,
    valid_samples: valid.length,
    total_samples: samples.length,
  };
}
