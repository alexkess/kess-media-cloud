import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { HttpError, forbidden, parseCookies } from './http.js';

const COOKIE = 'kc_session';
const SESSION_DAYS = 14;

export function hashPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw new HttpError(400, 'Password must be at least 10 characters');
  const salt = randomBytes(16);
  const key = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || typeof pw !== 'string') return false;
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const key = Buffer.from(keyB64, 'base64');
  const test = scryptSync(pw, Buffer.from(saltB64, 'base64'), key.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(key, test);
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 32) => randomBytes(n).toString('base64url');

export function createSession(db, userId) {
  const token = randomToken();
  db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), userId, Date.now() + SESSION_DAYS * 864e5);
  db.run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", userId);
  return token;
}

export function sessionCookie(token, secure) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

export function loadUser(db, req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = db.get(
    `SELECT u.id, u.email, u.name, u.role, u.client_id, s.expires_at, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    sha256(token),
  );
  if (!row) return null;
  if (row.expires_at < Date.now()) { db.run('DELETE FROM sessions WHERE token_hash = ?', row.token_hash); return null; }
  return { id: row.id, email: row.email, name: row.name, role: row.role, client_id: row.client_id, sessionHash: row.token_hash };
}

export const isAgency = (u) => u && (u.role === 'owner' || u.role === 'staff');

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Please sign in');
}
export function requireAgency(ctx) {
  requireUser(ctx);
  if (!isAgency(ctx.user)) throw forbidden('Agency access only');
}
export function requireOwner(ctx) {
  requireUser(ctx);
  if (ctx.user.role !== 'owner') throw forbidden('Owner access only');
}
// Agency users can access any client; client users only their own.
export function assertClientAccess(ctx, clientId) {
  requireUser(ctx);
  if (isAgency(ctx.user)) return;
  if (Number(ctx.user.client_id) !== Number(clientId)) throw forbidden();
}
