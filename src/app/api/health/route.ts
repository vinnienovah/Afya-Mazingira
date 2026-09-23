import { db, hasDatabase } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// The app runs without a database (accounts, plans and alerts are then off),
// so a missing one is reported rather than treated as the app being down.
export async function GET() {
  // database_configured is what the pages offering accounts, saved plans and
  // alerts read to decide whether to say those are switched off here.
  if (!hasDatabase()) return Response.json({ ok: true, database: "not_configured", database_configured: false });
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "ok", database_configured: true });
  } catch {
    return Response.json({ ok: false, database: "unreachable", database_configured: true }, { status: 503 });
  }
}
