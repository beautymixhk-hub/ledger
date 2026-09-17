import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Managed Postgres (Neon, Supabase, RDS) generally needs SSL; local usually doesn't.
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected Postgres error:", err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  if (process.env.NODE_ENV === "development") {
    console.log(`[db] ${Date.now() - start}ms  ${text.split("\n")[0].slice(0, 70)}`);
  }
  return res;
}

/** Run a set of statements in a transaction. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
