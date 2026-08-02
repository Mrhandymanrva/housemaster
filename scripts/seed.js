import { readFile } from 'node:fs/promises';
import { pool } from '../server/lib/db.js';
import { hash } from '../server/lib/auth.js';

const sql = await readFile(new URL('../db/seed/demo.sql', import.meta.url), 'utf8');
await pool.query(sql);

const email = process.env.SEED_ADMIN_EMAIL || 'mason@hmrichmond.com';
const pw = process.env.SEED_ADMIN_PASSWORD;
if (!pw) {
  console.log('Demo records loaded. Set SEED_ADMIN_PASSWORD to also create the owner login.');
} else {
  await pool.query(
    `INSERT INTO users (employee_id, email, password_hash, app_role)
     SELECT id, $1, $2, 'owner' FROM employees WHERE lower(email) = lower($1)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, await hash(pw)]
  );
  console.log(`Demo records loaded. Owner login ready for ${email}.`);
}
await pool.end();
