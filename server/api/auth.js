import { HttpError, bad, rateLimiter, clientIp } from '../lib/http.js';
import { createSession, sessionCookie, clearCookie, verifyPassword, hashPassword, sha256, requireUser, isAgency } from '../lib/auth.js';

const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20 });

export default function register(r) {
  r.post('/api/auth/login', async (ctx) => {
    if (!loginLimit(clientIp(ctx.req))) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const { email, password } = await ctx.body();
    const u = ctx.db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Email or password is incorrect');
    const token = createSession(ctx.db, u.id);
    ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
    return { user: { id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id } };
  });

  r.post('/api/auth/logout', async (ctx) => {
    if (ctx.user) ctx.db.run('DELETE FROM sessions WHERE token_hash = ?', ctx.user.sessionHash);
    ctx.setHeader('Set-Cookie', clearCookie());
    return { ok: true };
  });

  r.get('/api/auth/me', async (ctx) => {
    if (!ctx.user) return { user: null };
    const { sessionHash, ...user } = ctx.user;
    const client = user.client_id ? ctx.db.get('SELECT id, name FROM clients WHERE id = ?', user.client_id) : null;
    return { user: { ...user, agency: isAgency(user) }, client, agency_name: ctx.settings().agency_name };
  });

  r.post('/api/auth/password', async (ctx) => {
    requireUser(ctx);
    const { current, next } = await ctx.body();
    const u = ctx.db.get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    if (!verifyPassword(String(current || ''), u.password_hash)) throw bad('Current password is incorrect');
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), ctx.user.id);
    ctx.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', ctx.user.id, ctx.user.sessionHash);
    return { ok: true };
  });

  // Accept an invite: set a password, sign in.
  r.get('/api/auth/invite/:token', async (ctx) => {
    const row = ctx.db.get('SELECT u.name, u.email, i.expires_at FROM invites i JOIN users u ON u.id = i.user_id WHERE i.token_hash = ?', sha256(ctx.params.token));
    if (!row || row.expires_at < Date.now()) throw new HttpError(404, 'This invite link has expired or was already used');
    return { name: row.name, email: row.email };
  });
  r.post('/api/auth/invite/:token', async (ctx) => {
    const { password } = await ctx.body();
    const row = ctx.db.get('SELECT * FROM invites WHERE token_hash = ?', sha256(ctx.params.token));
    if (!row || row.expires_at < Date.now()) throw new HttpError(404, 'This invite link has expired or was already used');
    ctx.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), row.user_id);
    ctx.db.run('DELETE FROM invites WHERE user_id = ?', row.user_id);
    const token = createSession(ctx.db, row.user_id);
    ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
    return { ok: true };
  });
}
