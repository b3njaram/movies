// Administrative queries are isolated here so routes never expose password hashes.
import { db, ensureDefaultProfile, getUserByUsername } from './db.js';
import { hashPassword } from './auth.js';

export function listAccounts() {
  return db.prepare(`
    SELECT u.id, u.username, u.is_admin AS isAdmin, u.disabled, u.created_at AS createdAt,
      (SELECT COUNT(*) FROM profiles p WHERE p.user_id = u.id) AS profiles,
      (SELECT COUNT(*) FROM progress w JOIN profiles p ON p.id = w.profile_id WHERE p.user_id = u.id) AS historyItems
    FROM users u ORDER BY u.id ASC
  `).all().map(u => ({ ...u, isAdmin: Boolean(u.isAdmin), disabled: Boolean(u.disabled) }));
}

export function createAccount(username, password) {
  const normalized = String(username || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(normalized)) throw Object.assign(new Error('Username must be 3–40 letters, digits, dots, underscores or hyphens.'), {status:400});
  if (String(password || '').length < 8 || String(password).length > 200) throw Object.assign(new Error('Password must have 8–200 characters.'), {status:400});
  if (getUserByUsername(normalized)) throw Object.assign(new Error('Username already exists.'), {status:409});
  const result = db.prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 0)').run(normalized, hashPassword(password));
  ensureDefaultProfile({ id: Number(result.lastInsertRowid), username: normalized });
  return result.lastInsertRowid;
}

export function updateAccount(actorId, userId, action, password) {
  const user = db.prepare('SELECT id, is_admin AS isAdmin, disabled FROM users WHERE id = ?').get(userId);
  if (!user) throw Object.assign(new Error('Account not found.'), {status:404});
  if (action === 'reset-password') {
    if (String(password || '').length < 8 || String(password).length > 200) throw Object.assign(new Error('Password must have 8–200 characters.'), {status:400});
    db.prepare('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(hashPassword(password), userId);
  } else if (action === 'disable') {
    if (user.id === actorId) throw Object.assign(new Error('You cannot disable your own account.'), {status:400});
    if (user.isAdmin) throw Object.assign(new Error('Administrator accounts cannot be disabled here.'), {status:400});
    db.prepare('UPDATE users SET disabled = 1, session_version = session_version + 1 WHERE id = ?').run(userId);
  } else if (action === 'enable') {
    db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(userId);
  } else throw Object.assign(new Error('Unknown account action.'), {status:400});
}

export function adminSummary() {
  const count = (table) => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  return { users: count('users'), profiles: count('profiles'), progressItems: count('progress'), myListItems: count('my_list') };
}
