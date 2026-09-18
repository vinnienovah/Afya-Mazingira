// ─── Regional Environmental Outlook data ─────────────────────────────────────
// County polygons are simplified outline approximations of real county shapes
// (labeled DEMO). A production deployment replaces these with authoritative
// GeoJSON boundaries preprocessed from Shapefile/GeoPackage (spec §41.2).

export interface CountyFeature {
  type: "Feature";
  properties: {
    name: string;
    name_sw: string;
    outlook_category: "LOW" | "ELEVATED" | "HIGH" | "VERY_HIGH";
    confidence: "LOW" | "MODERATE" | "HIGH";
    temperature_anomaly_c: number;
    rain_24h_mm: number;
    soil_moisture: number;
    ndvi_mean: number | null;
    lst_c: number | null;
    sources: string[];
    trend: "rising" | "stable" | "falling";
    outlook_hours: { hour: string; category: string }[];
  };
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
}

export interface CountyCollection {
  type: "FeatureCollection";
  features: CountyFeature[];
}

// Simplified county outlines in [lng, lat] space (closed rings).
// Shapes approximate real county geography around the JKUAT/Juja anchor.
const SHAPES: Record<string, [number, number][]> = {
  // Nairobi — compact county around the capital
  Nairobi: [
    [36.65, -1.28], [36.72, -1.17], [36.83, -1.16], [36.94, -1.18],
    [37.08, -1.22], [37.10, -1.32], [37.05, -1.41], [36.92, -1.45],
    [36.80, -1.43], [36.70, -1.40], [36.63, -1.35], [36.65, -1.28],
  ],
  // Kiambu — wraps Nairobi's north & west; Juja sits in its south-east
  Kiambu: [
    [36.56, -1.05], [36.62, -0.92], [36.70, -0.83], [36.80, -0.80],
    [36.90, -0.78], [36.97, -0.84], [37.05, -0.95], [37.08, -1.10],
    [37.08, -1.22], [36.94, -1.18], [36.83, -1.16], [36.72, -1.17],
    [36.65, -1.28], [36.60, -1.20], [36.55, -1.12], [36.56, -1.05],
  ],
  // Machakos — large county east of Nairobi
  Machakos: [
    [37.08, -1.22], [37.10, -1.32], [37.12, -1.45], [37.16, -1.58],
    [37.28, -1.70], [37.42, -1.78], [37.55, -1.82], [37.60, -1.72],
    [37.58, -1.55], [37.50, -1.40], [37.38, -1.30], [37.24, -1.22],
    [37.10, -1.20], [37.08, -1.22],
  ],
  // Kajiado — vast southern county (extends beyond the map frame)
  Kajiado: [
    [36.38, -1.60], [36.50, -1.52], [36.63, -1.48], [36.80, -1.44],
    [36.92, -1.45], [37.05, -1.41], [37.12, -1.45], [37.16, -1.58],
    [37.28, -1.70], [37.42, -1.78], [37.55, -1.82], [37.50, -2.05],
    [37.45, -2.30], [37.42, -2.60], [37.35, -2.88], [37.10, -2.90],
    [36.80, -2.88], [36.55, -2.80], [36.42, -2.55], [36.36, -2.25],
    [36.33, -1.95], [36.35, -1.72], [36.38, -1.60],
  ],
  // Murang'a — north-east highlands
  "Murang'a": [
    [36.97, -0.84], [37.00, -0.76], [37.08, -0.72], [37.16, -0.71],
    [37.24, -0.73], [37.30, -0.80], [37.32, -0.90], [37.28, -1.00],
    [37.20, -1.10], [37.12, -1.12], [37.05, -0.95], [36.97, -0.84],
  ],
  // Kirinyaga — north-east, runs off the map frame
  Kirinyaga: [
    [37.30, -0.80], [37.40, -0.72], [37.52, -0.66], [37.66, -0.62],
    [37.76, -0.56], [37.72, -0.50], [37.52, -0.50], [37.40, -0.56],
    [37.32, -0.64], [37.24, -0.73], [37.30, -0.80],
  ],
};

function makePoly(
  name: string,
  name_sw: string,
  category: CountyFeature["properties"]["outlook_category"],
  confidence: CountyFeature["properties"]["confidence"],
  tempAnomaly: number,
  rain24h: number,
  soilMoisture: number,
  ndvi: number | null,
  lst: number | null,
  trend: "rising" | "stable" | "falling",
  outlookHours: { hour: string; category: string }[],
): CountyFeature {
  return {
    type: "Feature",
    properties: {
      name,
      name_sw,
      outlook_category: category,
      confidence,
      temperature_anomaly_c: tempAnomaly,
      rain_24h_mm: rain24h,
      soil_moisture: soilMoisture,
      ndvi_mean: ndvi,
      lst_c: lst,
      sources: ["ERA5-Land", "CHIRPS"],
      trend,
      outlook_hours: outlookHours,
    },
    geometry: {
      type: "Polygon",
      coordinates: [SHAPES[name]],
    },
  };
}

export function getRegionalOutlook(): CountyCollection {
  return {
    type: "FeatureCollection",
    features: [
      makePoly("Nairobi", "Nairobi", "ELEVATED", "MODERATE", 1.8, 3.2, 0.16, 0.31, 36.2, "rising", [
        { hour: "09:00", category: "LOW" },
        { hour: "12:00", category: "ELEVATED" },
        { hour: "15:00", category: "HIGH" },
        { hour: "18:00", category: "ELEVATED" },
      ]),
      makePoly("Kiambu", "Kiambu", "ELEVATED", "MODERATE", 1.3, 4.8, 0.19, 0.52, 33.1, "stable", [
        { hour: "09:00", category: "LOW" },
        { hour: "12:00", category: "ELEVATED" },
        { hour: "15:00", category: "ELEVATED" },
        { hour: "18:00", category: "LOW" },
      ]),
      makePoly("Machakos", "Machakos", "HIGH", "MODERATE", 2.4, 0.8, 0.11, 0.28, 38.6, "rising", [
        { hour: "09:00", category: "LOW" },
        { hour: "12:00", category: "HIGH" },
        { hour: "15:00", category: "HIGH" },
        { hour: "18:00", category: "ELEVATED" },
      ]),
      makePoly("Kajiado", "Kajiado", "HIGH", "LOW", 3.1, 0.2, 0.08, 0.19, 41.3, "rising", [
        { hour: "09:00", category: "ELEVATED" },
        { hour: "12:00", category: "HIGH" },
        { hour: "15:00", category: "VERY_HIGH" },
        { hour: "18:00", category: "HIGH" },
      ]),
      makePoly("Murang'a", "Murang'a", "LOW", "MODERATE", 0.6, 8.4, 0.24, 0.61, 29.8, "stable", [
        { hour: "09:00", category: "LOW" },
        { hour: "12:00", category: "LOW" },
        { hour: "15:00", category: "ELEVATED" },
        { hour: "18:00", category: "LOW" },
      ]),
      makePoly("Kirinyaga", "Kirinyaga", "ELEVATED", "MODERATE", 1.5, 4.1, 0.17, 0.44, 34.5, "stable", [
        { hour: "09:00", category: "LOW" },
        { hour: "12:00", category: "ELEVATED" },
        { hour: "15:00", category: "HIGH" },
        { hour: "18:00", category: "ELEVATED" },
      ]),
    ],
  };
}

// ─── Satellite acquisitions metadata ─────────────────────────────────────────

export interface SatelliteAcquisition {
  id: string;
  sensor: "Sentinel-2" | "Sentinel-3";
  acquired: string; // ISO date
  layer: string;
  label: string;
  resolution: string;
  provenance: string;
}

export function getSatelliteAcquisitions(): SatelliteAcquisition[] {
  return [
    {
      id: "s2-20260812",
      sensor: "Sentinel-2",
      acquired: "2026-08-12",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260822",
      sensor: "Sentinel-2",
      acquired: "2026-08-22",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260903",
      sensor: "Sentinel-2",
      acquired: "2026-09-03",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s2-20260905",
      sensor: "Sentinel-2",
      acquired: "2026-09-05",
      layer: "ndvi",
      label: "Sentinel-2 NDVI",
      resolution: "10 m",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s3-20260904",
      sensor: "Sentinel-3",
      acquired: "2026-09-04",
      layer: "lst",
      label: "Sentinel-3 LST",
      resolution: "~1 km",
      provenance: "SATELLITE_DERIVED",
    },
    {
      id: "s3-20260906",
      sensor: "Sentinel-3",
      acquired: "2026-09-06",
      layer: "lst",
      label: "Sentinel-3 LST",
      resolution: "~1 km",
      provenance: "SATELLITE_DERIVED",
    },
  ];
}
