// ─── Shared Copernicus Data Space Ecosystem (CDSE) helpers ──────────────────
// Token acquisition + Sentinel Hub Statistics access, shared by the primary
// JKUAT/Kiambu satellite context (sources-external.ts) and the multi-county
// regional NDVI sampling (map-data.ts). Kept in its own module so those two
// don't need to import each other.

export function hasCopernicusCreds(): boolean {
  return !!(process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET);
}

let tokenCache: { token: string; expiresAt: number } | null = null;
let tokenInflight: Promise<string> | null = null;

export async function cdseToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  if (tokenInflight) return tokenInflight;

  tokenInflight = (async () => {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.COPERNICUS_CLIENT_ID!,
      client_secret: process.env.COPERNICUS_CLIENT_SECRET!,
    }).toString();
    const res = await fetch(
      "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!res.ok) throw new Error(`CDSE token HTTP ${res.status}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("CDSE token missing");
    // Refresh a little before actual expiry to avoid using a stale token.
    tokenCache = { token: json.access_token, expiresAt: Date.now() + Math.max(60, (json.expires_in ?? 1800) - 60) * 1000 };
    return json.access_token;
  })();

  try {
    return await tokenInflight;
  } finally {
    tokenInflight = null;
  }
}

export type Bbox = [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]

/**
 * Mean NDVI over a bbox across a UTC date range, via the Sentinel Hub
 * Statistics API. Requested as one daily bucket per day in range (Sentinel
 * Hub requires a dataMask output for multi-bucket aggregation), then the
 * most recent day that looks like a real, mostly-clear scene is picked —
 * a day whose stats are still uniform/near-zero after unmixing is almost
 * always full cloud/shadow, not a real land signal. Unfiltered for anything
 * more rigorous than that — callers needing a guaranteed clear-scene
 * guarantee should pre-select one from the catalog first (see the primary
 * JKUAT/Kiambu path in sources-external.ts). A wider range increases the
 * chance of finding at least one usable day — useful for the small
 * per-county sample boxes used by the regional outlook, where Sentinel-2's
 * ~5 day revisit means a single day often has no coverage at all.
 */
export async function ndviStatisticsForBbox(
  token: string,
  bbox: Bbox,
  fromDayIso: string, // "YYYY-MM-DD"
  toDayIso: string = fromDayIso,
): Promise<number | null> {
  const from = `${fromDayIso}T00:00:00Z`;
  const to = `${toDayIso}T23:59:59Z`;
  const body = {
    input: {
      bounds: {
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
        bbox,
      },
      data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from, to } } }],
    },
    aggregation: {
      timeRange: { from, to },
      aggregationInterval: { of: "P1D" },
      evalscript:
        "//VERSION=3\n" +
        'function setup(){return{input:["B04","B08","dataMask"],output:[{id:"default",bands:["NDVI"]},{id:"dataMask",bands:1}]}}\n' +
        "function evaluatePixel(s){var d=s.B04+s.B08;return{default:[d===0?0:(s.B08-s.B04)/d],dataMask:[s.dataMask]}}",
    },
  };
  const res = await fetch("https://sh.dataspace.copernicus.eu/api/v1/statistics", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) throw new Error(`statistics HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      interval?: { from?: string };
      outputs?: { default?: { bands?: { NDVI?: { stats?: { mean?: number; stDev?: number; sampleCount?: number; noDataCount?: number } } } } };
    }[];
  };
  const days = json.data ?? [];

  // Most recent first; accept the first day that isn't a flat/near-zero
  // (near-certainly fully clouded) scene.
  for (let i = days.length - 1; i >= 0; i--) {
    const stats = days[i].outputs?.default?.bands?.NDVI?.stats;
    if (!stats || stats.mean == null || !Number.isFinite(stats.mean)) continue;
    const coverage = 1 - (stats.noDataCount ?? 0) / Math.max(1, stats.sampleCount ?? 1);
    if (coverage < 0.5) continue; // mostly no-data — not a usable scene
    if ((stats.stDev ?? 0) < 0.02) continue; // flat signal — almost certainly cloud/shadow
    return stats.mean;
  }
  return null;
}
