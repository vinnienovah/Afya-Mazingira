import { db, hasDatabase } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// The app runs without a database (accounts, plans and alerts are then off),
// so a missing one is reported rather than treated as the app being down.
export async function GET() {
  if (!hasDatabase()) return Response.json({ ok: true, database: "not_configured" });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "ok" });
  } catch {
    return Response.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
