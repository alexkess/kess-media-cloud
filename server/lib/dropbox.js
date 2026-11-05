// Dropbox: per-shoot folders, client upload links (file requests) and delivery links.
// Works with team spaces (e.g. "Kess Media Team Folder") by sending the team root namespace.
//   DROPBOX_APP_KEY, DROPBOX_APP_SECRET  from dropbox.com/developers (Scoped access, Full Dropbox,
//   redirect <PUBLIC_URL>/oauth/dropbox/callback; permissions: account_info.read, files.metadata.read,
//   files.content.write, sharing.read, sharing.write, file_requests.read, file_requests.write)
import { getIntegration, saveIntegration, updateSecrets, setIntegrationStatus, fetchJson } from './integrations.js';
import { notify } from './services.js';

const RPC = 'https://api.dropboxapi.com';
export const DROPBOX_DEFAULTS = { folder_template: '/0 - Clients/{client}/{year}-{month}-{day} {job}', subfolders: 'Raw, Selects, Final, Client uploads', request_folder: 'Client uploads' };
export const dropboxConfigured = () => !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET);

export function dropboxAuthUrl({ redirectUri, state }) {
  const q = new URLSearchParams({ client_id: process.env.DROPBOX_APP_KEY, response_type: 'code', token_access_type: 'offline', redirect_uri: redirectUri, state });
  return `https://www.dropbox.com/oauth2/authorize?${q}`;
}

const tokenRequest = (params) => fetchJson(`${RPC}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ...params, client_id: process.env.DROPBOX_APP_KEY, client_secret: process.env.DROPBOX_APP_SECRET }) });

export async function dropboxConnect(db, { code, redirectUri, user, dataDir }) {
  const tok = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
  const acct = await fetchJson(`${RPC}/2/users/get_current_account`, { method: 'POST', headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' }, body: 'null' });
  const team = acct.root_info?.['.tag'] === 'team';
  const prev = getIntegration(db, 'dropbox', dataDir);
  saveIntegration(db, 'dropbox', {
    account_name: `${acct.name?.display_name || acct.email}${team ? ` (${acct.team?.name || 'team'})` : ''}`, user, dataDir,
    secrets: { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + ((tok.expires_in || 14400) - 60) * 1000, root_namespace_id: team ? acct.root_info.root_namespace_id : null },
    settings: { ...DROPBOX_DEFAULTS, ...(prev?.settings || {}) },
  });
  return acct.email;
}

async function token(db, dataDir) {
  const integ = getIntegration(db, 'dropbox', dataDir);
  if (!integ?.secrets) throw new Error('Dropbox is not connected');
  const s = integ.secrets;
  if (s.expires_at > Date.now()) return { s, integ };
  try {
    const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh_token });
    const next = { ...s, access_token: tok.access_token, expires_at: Date.now() + ((tok.expires_in || 14400) - 60) * 1000 };
    updateSecrets(db, 'dropbox', next, dataDir);
    return { s: next, integ };
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      setIntegrationStatus(db, 'dropbox', { error: 'Dropbox access was revoked or expired. Reconnect it in Settings.' });
      notify(db, { audience: 'agency', title: 'Dropbox needs reconnecting', link: '#/settings' });
    }
    throw e;
  }
}

export async function dbx(db, dataDir, endpoint, args) {
  const { s } = await token(db, dataDir);
  const headers = { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' };
  if (s.root_namespace_id) headers['Dropbox-API-Path-Root'] = JSON.stringify({ '.tag': 'root', root: s.root_namespace_id });
  return fetchJson(`${RPC}/2/${endpoint}`, { method: 'POST', headers, body: JSON.stringify(args ?? null) });
}

// Dropbox paths: no characters Windows/macOS sync clients choke on.
export const cleanName = (s) => String(s || '').replace(/[\\/:?*"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'Untitled';
export function folderFor(template, { client, job, date }) {
  const d = date || new Date().toISOString().slice(0, 10);
  const [year, month, day] = d.split('-');
  const path = String(template || DROPBOX_DEFAULTS.folder_template)
    .replace(/\{client\}/g, cleanName(client)).replace(/\{job\}/g, cleanName(job))
    .replace(/\{year\}/g, year).replace(/\{month\}/g, month).replace(/\{day\}/g, day);
  const parts = path.split('/').map((p) => p.trim()).filter(Boolean).map((p) => p.replace(/[\\:?*"<>|]+/g, '-'));
  return '/' + parts.join('/');
}

async function makeFolder(db, dataDir, path) {
  try { await dbx(db, dataDir, 'files/create_folder_v2', { path, autorename: false }); }
  catch (e) { if (!(e.status === 409 && /conflict/.test(JSON.stringify(e.data || '')))) throw e; }
}

export async function createJobFolders(db, dataDir, job, clientName) {
  const integ = getIntegration(db, 'dropbox', dataDir);
  const set = { ...DROPBOX_DEFAULTS, ...integ?.settings };
  const root = folderFor(set.folder_template, { client: clientName, job: job.title, date: job.shoot_date });
  await makeFolder(db, dataDir, root);
  for (const sub of String(set.subfolders || '').split(',').map((x) => cleanName(x)).filter((x) => x !== 'Untitled')) await makeFolder(db, dataDir, `${root}/${sub}`);
  db.run("UPDATE jobs SET dropbox_path = ?, updated_at = datetime('now') WHERE id = ?", root, job.id);
  return root;
}

export async function createUploadRequest(db, dataDir, job, clientName, agencyName = 'Kess Media') {
  const integ = getIntegration(db, 'dropbox', dataDir);
  const set = { ...DROPBOX_DEFAULTS, ...integ?.settings };
  const root = job.dropbox_path || await createJobFolders(db, dataDir, job, clientName);
  const dest = `${root}/${cleanName(set.request_folder || 'Client uploads')}`;
  await makeFolder(db, dataDir, dest);
  const r = await dbx(db, dataDir, 'file_requests/create', { title: `${job.title}: files for ${agencyName}`.slice(0, 140), destination: dest, open: true });
  db.run("UPDATE jobs SET dropbox_request_id = ?, dropbox_request_url = ?, updated_at = datetime('now') WHERE id = ?", r.id, r.url, job.id);
  return r.url;
}

export async function listFolder(db, dataDir, path) {
  const r = await dbx(db, dataDir, 'files/list_folder', { path: path === '/' ? '' : path, limit: 500 });
  let entries = r.entries || [];
  let cursor = r.has_more ? r.cursor : null;
  while (cursor && entries.length < 2000) {
    const more = await dbx(db, dataDir, 'files/list_folder/continue', { cursor });
    entries = entries.concat(more.entries || []);
    cursor = more.has_more ? more.cursor : null;
  }
  return entries.filter((e) => e['.tag'] !== 'deleted').map((e) => ({ type: e['.tag'], name: e.name, path: e.path_display, size: e.size || null, modified: e.server_modified || null }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1));
}

export async function sharedLink(db, dataDir, path) {
  try {
    const r = await dbx(db, dataDir, 'sharing/create_shared_link_with_settings', { path, settings: { audience: { '.tag': 'public' }, access: { '.tag': 'viewer' } } });
    return r.url;
  } catch (e) {
    if (e.status !== 409) throw e;
    const existing = e.data?.error?.shared_link_already_exists?.metadata?.url;
    if (existing) return existing;
    const l = await dbx(db, dataDir, 'sharing/list_shared_links', { path, direct_only: true });
    if (l.links?.[0]?.url) return l.links[0].url;
    throw e;
  }
}
