import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';

const COOKIE_NAME = 'sh_session';

const SECRET =
  process.env.JWT_SECRET ||
  (() => {
    console.warn(
      '[auth] WARNING: JWT_SECRET is not set. Using a random per-process secret — ' +
        'everyone is signed out whenever the backend restarts. Set JWT_SECRET in your .env.'
    );
    return `dev-only-${Math.random().toString(36).slice(2)}${Date.now()}`;
  })();

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

// remember=true  -> 30 day persistent cookie
// remember=false -> browser-session cookie, token valid for 12h
export function issueSession(res, user, remember = true) {
  const token = jwt.sign({ sub: user.id, username: user.username, v: user.session_version || 0 }, SECRET, {
    expiresIn: remember ? '30d' : '12h',
  });
  const options = { httpOnly: true, sameSite: 'lax', path: '/' };
  if (remember) options.maxAge = 30 * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, options);
}

export function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function getSessionUser(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, username, is_admin AS isAdmin, disabled, session_version AS sessionVersion FROM users WHERE id = ?').get(payload.sub);
    if (!user || user.disabled || (payload.v || 0) !== user.sessionVersion) return null;
    return { id: user.id, username: user.username, isAdmin: Boolean(user.isAdmin) };
  } catch {
    return null;
  }
}

// NOTE: only *our own* authentication failures use code "AUTH". The frontend
// signs the user out only for that code, so a 401 coming from an upstream
// service can never be mistaken for an expired session.
export function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Please sign in again.', code: 'AUTH' });
  req.user = user;
  next();
}
