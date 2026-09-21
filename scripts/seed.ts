// Afya Mazingira database seed
// Run after drizzle-kit push. Seeds model metadata and demo ERA5/CHIRPS context.

import { config } from "dotenv";
config({ path: ".env" });
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  modelMetadata, era5Context, chirpsContext,
} from "../src/db/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function seed() {
  console.log("Seeding the Afya Mazingira database…");

  // Model metadata
  await db.insert(modelMetadata).values([
    {
      name: "wbgt_forecast_1h",
      version: "1.0.0",
      algorithm: "ExtraTreesRegressor",
      target: "wet_bulb_globe_temp",
      horizon_minutes: 60,
      mae: 0.57,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
      artifact_path: "ml/artifacts/extra_trees_1h_v1.pkl",
    },
    {
      name: "wbgt_forecast_3h",
      version: "1.0.0",
      algorithm: "CatBoostRegressor",
      target: "wet_bulb_globe_temp",
      horizon_minutes: 180,
      mae: 0.93,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
      artifact_path: "ml/artifacts/catboost_3h_v1.cbm",
    },
    {
      name: "wbgt_forecast_6h",
      version: "1.0.0",
      algorithm: "ExtraTreesRegressor",
      target: "wet_bulb_globe_temp",
      horizon_minutes: 360,
      mae: 1.23,
      training_start: "2025-06-01",
      training_end: "2026-08-01",
      artifact_path: "ml/artifacts/extra_trees_6h_v1.pkl",
    },
  ]).onConflictDoNothing();

  // ERA5 context sample (last 12 hours)
  const now = Date.now();
  for (let i = 11; i >= 0; i--) {
    const t = new Date(now - i * 3600 * 1000);
    await db.insert(era5Context).values({
      valid_time: t,
      temp_c: 22.3 + Math.sin(i * 0.5) * 3.5,
      dewpoint_c: 11.2,
      relative_humidity: 55 + Math.cos(i * 0.5) * 15,
      pressure_hpa: 850.1,
      wind_speed_ms: 1.8,
      wind_dir_deg: 115,
      solar_wm2: Math.max(0, 750 * Math.sin(((i - 6) / 12) * Math.PI)),
      precip_hourly_mm: 0.0,
      soil_moisture: 0.18,
    }).onConflictDoNothing();
  }

  // CHIRPS context (last 7 days)
  const today = new Date().toISOString().slice(0, 10);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
    await db.insert(chirpsContext).values({
      valid_date: d,
      rain_mm: Math.random() * 3,
      rain_7d_mm: 14.7,
      rain_30d_mm: 48.2,
      percentile: 62,
      dry_spell_days: 4,
      wet_spell_days: 1,
    }).onConflictDoNothing();
  }

  console.log("Seed complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
