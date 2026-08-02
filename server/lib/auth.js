import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { q } from './db.js';
import { forbidden, HttpError } from './http.js';

// A deployed server with no JWT_SECRET would sign every session with a string
// that is printed in this file, so it refuses to start instead of pretending.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set. Set it before starting in production.');
}
const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const RANK = { field: 1, office: 2, admin: 3, owner: 4 };

export const signToken = (user) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.app_role, employee_id: user.employee_id },
    SECRET,
    { expiresIn: '12h' }
  );

export async function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Sign in to continue'));

  let claims;
  try {
    claims = jwt.verify(token, SECRET);
  } catch {
    return next(new HttpError(401, 'Session expired. Sign in again.'));
  }

  // The token says what the role was up to 12 hours ago. Switching someone off,
  // or moving them down a role, has to take hold on the next request rather
  // than whenever their token happens to run out.
  try {
    const { rows } = await q(
      `SELECT u.id, u.email, u.app_role, u.employee_id, u.active, e.full_name
         FROM users u LEFT JOIN employees e ON e.id = u.employee_id
        WHERE u.id = $1`,
      [claims.id]
    );
    const user = rows[0];
    if (!user || !user.active) return next(new HttpError(401, 'This login is no longer active.'));
    req.user = {
      id: user.id,
      email: user.email,
      role: user.app_role,
      employee_id: user.employee_id,
      name: user.full_name || user.email,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (min) => (req, _res, next) =>
  (RANK[req.user?.role] || 0) >= RANK[min]
    ? next()
    : next(forbidden(`This needs ${min} access or higher.`));

export async function verifyLogin(email, password) {
  const { rows } = await q(
    `SELECT u.*, e.full_name FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
      WHERE lower(u.email) = lower($1) AND u.active`,
    [email]
  );
  const user = rows[0];
  if (!user) return null;
  if (!(await bcrypt.compare(password, user.password_hash))) return null;
  await q(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
  return user;
}

export const hash = (pw) => bcrypt.hash(pw, 11);
