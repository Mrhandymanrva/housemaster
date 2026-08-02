import pg from 'pg';

const { Pool } = pg;

// Railway injects DATABASE_URL. Local dev falls back to a local postgres.
const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/housemaster';

export const pool = new Pool({
  connectionString,
  ssl: /railway|rlwy|proxy\.rlwy/.test(connectionString) ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

export const q = (text, params) => pool.query(text, params);

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
