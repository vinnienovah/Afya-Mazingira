// Afya Mazingira database seed. Run once after `npm run db:push`:
//
//   npx tsx scripts/seed.ts
//
// Records the fitted forecast (src/lib/afya/model/wbgt-forecast.json) in the
// model_metadata table, with its test-month error at each horizon. Nothing
// else is seeded: weather and rainfall context are always fetched live.

import { config } from "dotenv";
config({ path: ".env" });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { modelMetadata } from "../src/db/schema";
import model from "../src/lib/afya/model/wbgt-forecast.json";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

const HORIZONS = [["1h", 4], ["3h", 12], ["6h", 24], ["9h", 36]] as const;

async function seed() {
  console.log("Recording the fitted forecast in model_metadata…");
  await db
    .insert(modelMetadata)
    .values(
      HORIZONS.map(([horizon, step]) => ({
        name: `wbgt_forecast_${horizon}`,
        version: model.periods.test[1],
        algorithm: model.method,
        target: model.target,
        horizon_minutes: step * 15,
        mae: model.steps[step - 1].test_mae,
        training_start: model.periods.train[0],
        training_end: model.periods.train[1],
        artifact_path: "src/lib/afya/model/wbgt-forecast.json",
      })),
    )
    .onConflictDoNothing();
  console.log("Seed complete.");
  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
