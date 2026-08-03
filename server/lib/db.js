import pg from 'pg';

const { Pool } = pg;

// Railway injects DATABASE_URL. Local dev falls back to a local postgres.
const connectionString =
  process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/housemaster';

// Railway hands the app a private address — postgres.railway.internal — and that
// network does not offer SSL. Its public proxy does. Matching on "railway"
// caught the private host too and forced SSL onto a server that refuses it, so
// go by the host: private and local are plaintext, anything else is encrypted.
const privateHost = /\.railway\.internal|localhost|127\.0\.0\.1|\[::1\]/i.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: privateHost ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

/** Host and database only — never the password — for startup diagnostics. */
export function describeTarget() {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}:${u.port || 5432}${u.pathname} (ssl ${privateHost ? 'off' : 'on'})`;
  } catch {
    return 'an unreadable DATABASE_URL';
  }
}

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
