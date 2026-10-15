// Usage: docker exec -it streamhub-backend node create-user.js <username> <password>
// Creates a new account, or resets the password if the username already exists.
import { db, getUserByUsername, createUser, ensureDefaultProfile } from './db.js';
import { hashPassword } from './auth.js';

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node create-user.js <username> <password>');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const hash = hashPassword(password);
const existing = getUserByUsername(username);

if (existing) {
  db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`Password updated for existing user "${username}".`);
} else {
  createUser(username, hash);
  ensureDefaultProfile(getUserByUsername(username));
  console.log(`User "${username}" created.`);
}
