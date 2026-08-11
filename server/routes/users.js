// ---------------------------------------------------------------------------
// Logins. Who can sign in, and what each of them is allowed to do.
//
// Kept out of the generic /api/records CRUD on purpose: password_hash must
// never be selected into a list view, and the rules below (you cannot outrank
// yourself, you cannot remove the last owner) do not exist for any other table.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q } from '../lib/db.js';
import { wrap, bad, notFound, forbidden } from '../lib/http.js';
import { requireAuth, requireRole, hash } from '../lib/auth.js';
import { ROLES, RANK } from '../../field/app/roles.js';

const r = Router();

// One definition, shared with the phone. See field/roles.js.

/** Everything about a login except the one column that must never leave. */
const SHAPE = `u.id, u.email, u.app_role, u.active, u.last_login_at, u.created_at,
               u.employee_id, e.full_name, e.job_title`;
const FROM = `FROM users u LEFT JOIN employees e ON e.id = u.employee_id`;

const checkPassword = (pw) => {
  if (typeof pw !== 'string' || pw.length < 12) {
    throw bad('Use at least 12 characters. A short phrase you will remember beats a short scramble.');
  }
};

/** You cannot hand out access you do not have yourself. */
function checkGrant(actor, role) {
  if (!ROLES.includes(role)) throw bad(`Role must be one of: ${ROLES.join(', ')}`);
  if (RANK[role] > RANK[actor.role]) {
    throw forbidden(`Only ${role} or higher can give someone ${role} access.`);
  }
}

/** Refuse the change that would leave nobody able to undo it. */
async function checkLastOwner(userId) {
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM users
      WHERE active AND app_role = 'owner' AND id <> $1`,
    [userId]
  );
  if (rows[0].n === 0) {
    throw bad('This is the only active owner. Give someone else owner access first.');
  }
}

async function audit(req, id, action, diff) {
  await q(
    `INSERT INTO audit_log (user_id, entity, entity_id, action, diff) VALUES ($1,$2,$3,$4,$5)`,
    [req.user?.id || null, 'users', id, action, diff ? JSON.stringify(diff) : null]
  );
}

// ------------------------------------------------------------ own password
// Anyone can change their own, and has to prove they know the current one.
r.post('/me/password', requireAuth, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  checkPassword(new_password);

  const { rows } = await q(`SELECT password_hash FROM users WHERE id = $1 AND active`, [req.user.id]);
  if (!rows[0]) throw notFound('Your account is no longer active.');
  if (!(await bcrypt.compare(current_password || '', rows[0].password_hash))) {
    throw bad('That is not your current password.');
  }

  await q(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hash(new_password), req.user.id]);
  await audit(req, req.user.id, 'password_change', null);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------- list
r.get('/', requireAuth, requireRole('admin'), wrap(async (_req, res) => {
  const { rows } = await q(`SELECT ${SHAPE} ${FROM} ORDER BY u.active DESC, e.full_name NULLS LAST, u.email`);
  res.json({ users: rows, roles: ROLES });
}));

// ----------------------------------------------------------------- create
r.post('/', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { email, password, app_role = 'field', employee_id = null } = req.body || {};
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw bad('Enter a real email address.');
  checkPassword(password);
  checkGrant(req.user, app_role);

  const dupe = await q(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
  if (dupe.rows[0]) throw bad('Someone already signs in with that email.');

  const { rows } = await q(
    `INSERT INTO users (email, password_hash, app_role, employee_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, await hash(password), app_role, employee_id || null]
  );
  await audit(req, rows[0].id, 'create', { email, app_role, employee_id });

  const created = await q(`SELECT ${SHAPE} ${FROM} WHERE u.id = $1`, [rows[0].id]);
  res.status(201).json({ user: created.rows[0] });
}));

// ----------------------------------------------------------------- update
// Role, active flag, and which employee the login belongs to.
r.patch('/:id', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await q(`SELECT id, app_role, active FROM users WHERE id = $1`, [req.params.id]);
  const target = rows[0];
  if (!target) throw notFound('No such login.');

  // Editing someone senior to you is off limits, or admins could demote the owner.
  if (RANK[target.app_role] > RANK[req.user.role]) {
    throw forbidden(`${target.app_role} accounts can only be changed by ${target.app_role} or higher.`);
  }

  const patch = {};
  if (req.body.app_role !== undefined) {
    checkGrant(req.user, req.body.app_role);
    if (target.id === req.user.id && RANK[req.body.app_role] < RANK[req.user.role]) {
      throw bad('You cannot lower your own access. Ask someone else to do it.');
    }
    if (target.app_role === 'owner' && req.body.app_role !== 'owner') await checkLastOwner(target.id);
    patch.app_role = req.body.app_role;
  }
  if (req.body.active !== undefined) {
    const active = Boolean(req.body.active);
    if (target.id === req.user.id && !active) throw bad('You cannot switch off your own login.');
    if (!active && target.app_role === 'owner') await checkLastOwner(target.id);
    patch.active = active;
  }
  if (req.body.employee_id !== undefined) patch.employee_id = req.body.employee_id || null;

  const entries = Object.entries(patch);
  if (!entries.length) throw bad('Nothing to change.');

  const set = entries.map(([k], i) => `${k} = $${i + 1}`).join(', ');
  const vals = entries.map(([, v]) => v);
  vals.push(target.id);
  await q(`UPDATE users SET ${set} WHERE id = $${vals.length}`, vals);
  await audit(req, target.id, 'update', patch);

  const updated = await q(`SELECT ${SHAPE} ${FROM} WHERE u.id = $1`, [target.id]);
  res.json({ user: updated.rows[0] });
}));

// -------------------------------------------------------- reset a password
// No email delivery yet, so an admin sets one and hands it over. The person
// changes it themselves from Account.
r.post('/:id/password', requireAuth, requireRole('admin'), wrap(async (req, res) => {
  const { rows } = await q(`SELECT id, app_role FROM users WHERE id = $1`, [req.params.id]);
  const target = rows[0];
  if (!target) throw notFound('No such login.');
  if (RANK[target.app_role] > RANK[req.user.role]) {
    throw forbidden(`Only ${target.app_role} or higher can reset that password.`);
  }
  checkPassword(req.body?.new_password);

  await q(`UPDATE users SET password_hash = $1 WHERE id = $2`, [await hash(req.body.new_password), target.id]);
  await audit(req, target.id, 'password_reset', null);
  res.json({ ok: true });
}));

export default r;
