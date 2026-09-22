import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// The connection is set up on first use rather than at import, so routes that
// never touch the database keep working when DATABASE_URL is not set.

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not set");
    this.name = "DatabaseUnavailableError";
  }
}

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

type Database = NodePgDatabase & { $client: Pool };

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

let instance: Database | null = null;

/** The drizzle client. Throws DatabaseUnavailableError without DATABASE_URL. */
export function getDb(): Database {
  if (instance) return instance;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DatabaseUnavailableError();

  const pool = globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: databaseUrl });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }
  instance = drizzle(pool);
  return instance;
}

// Without a database, a query chain still builds and only fails when awaited,
// as a lost connection would, so callers' own error handling covers it.
function failingQuery(error: Error): unknown {
  const settled = Promise.reject(error);
  settled.catch(() => {});
  const chain: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return settled.then.bind(settled);
      if (prop === "catch") return settled.catch.bind(settled);
      if (prop === "finally") return settled.finally.bind(settled);
      return chain;
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

/** The same client as getDb(), looked up on each use. */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    let real: Database;
    try {
      real = getDb();
    } catch (error) {
      return failingQuery(error as Error);
    }
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
