import { NextResponse } from "next/server";
import type { z } from "zod";

/**
 * The request body checked against a schema, or the 400 response to send:
 * "invalid_json" when the body is not JSON at all, "invalid_input" when it
 * does not fit the schema.
 */
export async function readJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
): Promise<{ data: z.output<S> } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return { response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "invalid_input" }, { status: 400 }) };
  }
  return { data: parsed.data };
}

/** 503 for a route that needs the database when none is configured. */
export function databaseUnavailable(): NextResponse {
  return NextResponse.json(
    {
      error: "database_unavailable",
      message: "Accounts, plans and alerts need a database, and none is configured on this server (DATABASE_URL is not set).",
    },
    { status: 503 },
  );
}
