import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";

// Singleton across Next.js dev hot-reloads; attachDatabasePool wires the pool
// into Vercel Fluid compute lifecycle (no-op locally).
const globalForDb = globalThis as unknown as { __mmPool?: Pool };

export const pool =
  globalForDb.__mmPool ??
  (() => {
    const p = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: { rejectUnauthorized: false },
    });
    attachDatabasePool(p);
    globalForDb.__mmPool = p;
    return p;
  })();

export const db = drizzle(pool, { schema });
export { schema };
