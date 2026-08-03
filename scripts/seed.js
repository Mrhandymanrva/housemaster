// Sample records — employees, vehicles, policies, radon sets — so the
// compliance horizon has something on it while you are looking around.
//
// Optional, and not how you get a login: the first owner is created from the
// sign-in screen the first time you open a fresh deployment.
//
//   npm run seed:demo
import { readFile } from 'node:fs/promises';
import { pool } from '../server/lib/db.js';

const sql = await readFile(new URL('../db/seed/demo.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('Demo records loaded.');
await pool.end();
