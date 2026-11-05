// Shared plumbing for third-party integrations: encrypted token storage, OAuth state, settings.
// Tokens are encrypted with AES-256-GCM. The key comes from KESS_SECRET, or a key file created on
// first use in DATA_DIR (kept out of backups, so a leaked backup holds no usable tokens; after a
// restore onto a new server you simply reconnect the integrations).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { j } from './services.js';

let cachedKey = null;
export function secretKey(dataDir) {
  if (cachedKey) return cachedKey;
  if (process.env.KESS_SECRET) {
    cachedKey = createHmac('sha256', 'kess-cloud').update(process.env.KESS_SECRET).digest();
    return cachedKey;
  }
  const dir = dataDir || process.env.DATA_DIR || join(process.cwd(), 'data');
  const file = join(dir, 'secret.key');
  if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 }); }
  cachedKey = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return cachedKey;
}
export const _resetKeyForTests = () => { cachedKey = null; };

export function encrypt(obj, key) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}
export function decrypt(text, key) {
  if (!text) return null;
  const [v, iv, tag, data] = String(text).split('.');
  if (v !== 'v1') return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'));
  } catch { return null; }
}

export function getIntegration(db, provider, dataDir) {
  const row = db.get('SELECT * FROM integrations WHERE provider = ?', provider);
  if (!row) return null;
  return { ...row, settings: j(row.settings, {}), secrets: decrypt(row.secrets, secretKey(dataDir)) };
}

export function saveIntegration(db, provider, { account_name, secrets, settings, user, dataDir }) {
  const prev = db.get('SELECT * FROM integrations WHERE provider = ?', provider);
  const enc = secrets === undefined ? prev?.secrets ?? null : encrypt(secrets, secretKey(dataDir));
  const set = settings === undefined ? prev?.settings ?? '{}' : JSON.stringify(settings);
  db.run(`INSERT INTO integrations (provider, account_name, secrets, settings, connected_by, connected_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(provider) DO UPDATE SET account_name = COALESCE(excluded.account_name, account_name), secrets = excluded.secrets, settings = excluded.settings,
    connected_by = COALESCE(excluded.connected_by, connected_by), last_error = NULL`, provider, account_name ?? prev?.account_name ?? null, enc, set, user?.id ?? null);
}

export function updateSecrets(db, provider, secrets, dataDir) {
  db.run('UPDATE integrations SET secrets = ? WHERE provider = ?', encrypt(secrets, secretKey(dataDir)), provider);
}
export function setIntegrationStatus(db, provider, { error = null, synced = false } = {}) {
  db.run(`UPDATE integrations SET last_error = ?${synced ? ", last_sync_at = datetime('now')" : ''} WHERE provider = ?`, error ? String(error).slice(0, 500) : null, provider);
}
export function removeIntegration(db, provider) { db.run('DELETE FROM integrations WHERE provider = ?', provider); }

// OAuth state: signed, short-lived, bound to the user who started it.
export function makeState(provider, userId, dataDir) {
  const body = `${provider}.${userId}.${Date.now()}.${randomBytes(8).toString('base64url')}`;
  return `${body}.${createHmac('sha256', secretKey(dataDir)).update(body).digest('base64url')}`;
}
export function checkState(state, provider, userId, dataDir, maxAgeMs = 15 * 60_000) {
  const parts = String(state || '').split('.');
  if (parts.length !== 5) return false;
  const [p, uid, ts, , sig] = parts;
  const body = parts.slice(0, 4).join('.');
  const expect = createHmac('sha256', secretKey(dataDir)).update(body).digest('base64url');
  if (sig.length !== expect.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  return p === provider && Number(uid) === Number(userId) && Date.now() - Number(ts) < maxAgeMs;
}

// Small fetch helper with timeout and readable errors.
export async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 20000) });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!r.ok) {
    const msg = data?.error_description || data?.Message || data?.Detail || data?.error_summary || data?.error?.message || (typeof data?.error === 'string' ? data.error : '') || data?.raw || `HTTP ${r.status}`;
    const err = new Error(String(msg).slice(0, 300));
    err.status = r.status; err.data = data;
    throw err;
  }
  return data;
}
