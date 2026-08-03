import { Router } from 'express';
import { q } from '../lib/db.js';
import { verifyLogin, signToken, requireAuth, hash } from '../lib/auth.js';
import { wrap, bad, HttpError } from '../lib/http.js';

const r = Router();

r.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await verifyLogin(email || '', password || '');
  if (!user) throw new HttpError(401, 'That email and password do not match an account.');
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, role: user.app_role, name: user.full_name },
  });
}));

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// --------------------------------------------------------------- first run
// A brand new database has no logins, so there is nobody who could sign in to
// create one. The sign-in screen asks for the first owner instead, and this
// closes for good the moment that account exists.
//
// The gap between the deploy going green and that first account existing is
// open to whoever finds the URL. It is short and it never reopens, but it is
// real: set the owner up as soon as the deploy finishes.
r.get('/setup', wrap(async (_req, res) => {
  const { rows } = await q(`SELECT count(*)::int AS n FROM users`);
  res.json({ needs_first_owner: rows[0].n === 0 });
}));

r.post('/setup', wrap(async (req, res) => {
  const { full_name, email, password } = req.body || {};
  if (!full_name?.trim()) throw bad('Enter your name.');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw bad('Enter a real email address.');
  if (typeof password !== 'string' || password.length < 12) {
    throw bad('Use at least 12 characters. A phrase you will remember beats a short scramble.');
  }

  // The employee row first, so the owner appears on the staff list like anyone
  // else. If this is retried, match the existing row rather than duplicate it.
  const person = await q(
    `INSERT INTO employees (full_name, email, job_title, role)
     VALUES ($1, $2, 'Owner', 'Owner')
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [full_name.trim(), email.toLowerCase()]
  );

  // Guarded by NOT EXISTS rather than by the count above, so two people racing
  // the setup screen cannot both come away owners.
  const { rows } = await q(
    `INSERT INTO users (email, password_hash, app_role, employee_id)
     SELECT $1, $2, 'owner', $3
      WHERE NOT EXISTS (SELECT 1 FROM users)
     RETURNING id, email, app_role, employee_id`,
    [email.toLowerCase(), await hash(password), person.rows[0].id]
  );
  if (!rows[0]) throw new HttpError(409, 'Someone has already set this up. Sign in instead.');

  const user = rows[0];
  await q(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, diff)
     VALUES ($1, 'users', $1, 'first_owner', NULL)`,
    [user.id]
  );

  res.status(201).json({
    token: signToken(user),
    user: { id: user.id, email: user.email, role: user.app_role, name: full_name.trim() },
  });
}));

export default r;
