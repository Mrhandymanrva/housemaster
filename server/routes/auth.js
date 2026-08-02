import { Router } from 'express';
import { verifyLogin, signToken, requireAuth } from '../lib/auth.js';
import { wrap, HttpError } from '../lib/http.js';

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

export default r;
