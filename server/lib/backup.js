// Backups: a consistent SQLite snapshot (VACUUM INTO) plus uploaded files, as .tar.gz.
// Kept in DATA_DIR/backups (newest BACKUP_KEEP, default 14). Optionally copied off-site to any
// S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2):
//   BACKUP_S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com  BACKUP_S3_BUCKET=kess-backups
//   BACKUP_S3_KEY_ID=...  BACKUP_S3_SECRET=...  BACKUP_S3_REGION=auto
import { mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { tarGz } from './tar.js';

const hex = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();

// AWS Signature V4 for a single S3 request. Returns headers to send.
export function signS3({ method, url, headers = {}, payloadHash, region, keyId, secret, service = 's3', now = new Date() }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(h).sort();
  const canonPath = u.pathname.split('/').map((p) => encodeURIComponent(decodeURIComponent(p))).join('/');
  const canonQuery = [...u.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const canonical = [method, canonPath, canonQuery, names.map((n) => `${n}:${h[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, hex(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), 'aws4_request');
  const sig = createHmac('sha256', key).update(toSign).digest('hex');
  return { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
}

export const offsiteEnabled = () => !!(process.env.BACKUP_S3_ENDPOINT && process.env.BACKUP_S3_BUCKET && process.env.BACKUP_S3_KEY_ID && process.env.BACKUP_S3_SECRET);

async function uploadOffsite(name, buf) {
  const url = `${process.env.BACKUP_S3_ENDPOINT.replace(/\/$/, '')}/${process.env.BACKUP_S3_BUCKET}/${name}`;
  const headers = signS3({ method: 'PUT', url, headers: { 'content-type': 'application/gzip' }, payloadHash: hex(buf), region: process.env.BACKUP_S3_REGION || 'auto', keyId: process.env.BACKUP_S3_KEY_ID, secret: process.env.BACKUP_S3_SECRET });
  delete headers.host;
  const r = await fetch(url, { method: 'PUT', headers, body: buf, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Off-site upload failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
}

export const backupDir = (dataDir) => join(dataDir, 'backups');

export async function createBackup(db, dataDir, { keep = Number(process.env.BACKUP_KEEP || 14) } = {}) {
  const dir = backupDir(dataDir);
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  const snap = join(dir, `.snapshot-${stamp}.db`);
  rmSync(snap, { force: true });
  db.exec(`VACUUM INTO '${snap.replace(/'/g, "''")}'`);
  const files = [{ path: 'kess-cloud.db', content: readFileSync(snap) }];
  rmSync(snap, { force: true });
  const assets = join(dataDir, 'assets');
  if (existsSync(assets)) for (const f of readdirSync(assets)) files.push({ path: `assets/${f}`, content: readFileSync(join(assets, f)) });
  files.push({ path: 'RESTORE.txt', content: 'Stop Kess Cloud, copy kess-cloud.db to DB_FILE and the assets folder to DATA_DIR/assets, then start it again.\n' });
  const buf = tarGz(files, `kess-cloud-backup-${stamp}`);
  const name = `kess-cloud-${stamp}.tar.gz`;
  writeFileSync(join(dir, name), buf);
  let offsite = null;
  if (offsiteEnabled()) {
    try { await uploadOffsite(name, buf); offsite = 'uploaded'; } catch (e) { offsite = `failed: ${e.message}`; }
  }
  const all = listBackups(dataDir);
  for (const b of all.slice(keep)) rmSync(join(dir, b.name), { force: true });
  return { name, size: buf.length, files: files.length, offsite };
}

export function listBackups(dataDir) {
  const dir = backupDir(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^kess-cloud-[\d-]+\.tar\.gz$/.test(f)).map((name) => {
    const st = statSync(join(dir, name));
    return { name, size: st.size, created_at: st.mtime.toISOString() };
  }).sort((a, b) => (a.name < b.name ? 1 : -1));
}
