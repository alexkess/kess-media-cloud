import { HttpError, bad, rateLimiter, clientIp } from '../lib/http.js';
import { createSession, sessionCookie, clearCookie, verifyPassword, hashPassword, sha256, requireUser, isAgency, randomToken } from '../lib/auth.js';
import { newSecret, verifyTotp, otpauthUri } from '../lib/totp.js';
import { sendMail, appUrl } from '../lib/mail.js';

const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20 });
const forgotLimit = rateLimiter({ windowMs: 60 * 60_000, max: 5 });

export default function register(r) {
  r.post('/api/auth/login', async (ctx) => {
    if (!loginLimit(clientIp(ctx.req))) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
    const { email, password, code } = await ctx.body();
    const u = ctx.db.get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Email or password is incorrect');
    if (u.totp_enabled) {
      if (!code) throw new HttpError(401, 'Enter the 6-digit code from your authenticator app', { need_code: true });
      if (!verifyTotp(u.totp_secret, code)) throw new HttpError(401, 'That code is not right. Codes change every 30 seconds.', { need_code: true });
    }
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
    const prefs = ctx.db.get('SELECT email_notify, totp_enabled FROM users WHERE id = ?', user.id);
    return { user: { ...user, agency: isAgency(user), email_notify: !!prefs.email_notify, totp_enabled: !!prefs.totp_enabled }, client, agency_name: ctx.settings().agency_name };
  });

  r.patch('/api/auth/prefs', async (ctx) => {
    requireUser(ctx);
    const b = await ctx.body();
    if ('email_notify' in b) ctx.db.run('UPDATE users SET email_notify = ? WHERE id = ?', b.email_notify ? 1 : 0, ctx.user.id);
    if ('name' in b && String(b.name).trim()) ctx.db.run('UPDATE users SET name = ? WHERE id = ?', String(b.name).trim().slice(0, 100), ctx.user.id);
    return { ok: true };
  });

  // Forgot password: always answers ok so it can't be used to discover accounts.
  r.post('/api/auth/forgot', async (ctx) => {
    if (!forgotLimit(clientIp(ctx.req))) throw new HttpError(429, 'Too many requests. Try again later.');
    const { email } = await ctx.body();
    const u = ctx.db.get('SELECT id, name, email FROM users WHERE email = ?', String(email || '').trim());
    if (u) {
      const token = randomToken();
      ctx.db.run('DELETE FROM invites WHERE user_id = ?', u.id);
      ctx.db.run('INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), u.id, Date.now() + 60 * 60_000);
      sendMail(ctx.db, { to: u.email, subject: 'Reset your Kess Cloud password', heading: 'Reset your password', lines: [`Hi ${u.name.split(' ')[0]},`, 'Someone (hopefully you) asked to reset your password. The link works once and expires in an hour. If it was not you, ignore this email.'], button: { label: 'Choose a new password', url: `${appUrl(ctx.db)}/#/invite/${token}` } });
    }
    return { ok: true };
  });

  // Two-factor authentication (TOTP)
  r.post('/api/auth/2fa/setup', async (ctx) => {
    requireUser(ctx);
    const secret = newSecret();
    ctx.db.run('UPDATE users SET totp_pending = ? WHERE id = ?', secret, ctx.user.id);
    return { secret, uri: otpauthUri(secret, ctx.user.email, `${ctx.settings().agency_name} Cloud`) };
  });
  r.post('/api/auth/2fa/enable', async (ctx) => {
    requireUser(ctx);
    const { code } = await ctx.body();
    const u = ctx.db.get('SELECT totp_pending FROM users WHERE id = ?', ctx.user.id);
    if (!u.totp_pending) throw bad('Start setup first');
    if (!verifyTotp(u.totp_pending, code)) throw bad('That code is not right. Check the time on your phone and try the newest code.');
    ctx.db.run('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL, totp_enabled = 1 WHERE id = ?', ctx.user.id);
    return { ok: true };
  });
  r.post('/api/auth/2fa/disable', async (ctx) => {
    requireUser(ctx);
    const { password } = await ctx.body();
    const u = ctx.db.get('SELECT password_hash FROM users WHERE id = ?', ctx.user.id);
    if (!verifyPassword(String(password || ''), u.password_hash)) throw bad('Password is incorrect');
    ctx.db.run('UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0 WHERE id = ?', ctx.user.id);
    return { ok: true };
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
    ctx.db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id); // sign out everywhere after a reset
    // With 2FA on, a reset link must not skip the second factor: make them sign in.
    if (ctx.db.get('SELECT totp_enabled FROM users WHERE id = ?', row.user_id).totp_enabled) return { ok: true, need_login: true };
    const token = createSession(ctx.db, row.user_id);
    ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
    return { ok: true };
  });
}
