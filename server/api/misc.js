import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bad, notFound, HttpError } from '../lib/http.js';
import { requireAgency, requireOwner, requireUser, assertClientAccess, isAgency } from '../lib/auth.js';
import { setSetting, DEFAULT_SETTINGS } from '../db.js';
import { loadInvoice, j } from '../lib/services.js';
import { inviteUser } from './clients.js';
import { createBackup, listBackups, backupDir, offsiteEnabled } from '../lib/backup.js';
import { mailConfig, sendMail } from '../lib/mail.js';
import { stripeEnabled } from '../lib/stripe.js';
import { runDaily } from '../lib/jobs.js';

const ASSET_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf', 'video/mp4', 'image/svg+xml', 'text/plain', 'application/zip']);

export default function register(r, { dataDir }) {
  const assetDir = join(dataDir, 'assets');

  r.get('/api/dashboard', async (ctx) => {
    requireUser(ctx);
    const db = ctx.db;
    if (isAgency(ctx.user)) {
      const mrr = db.get("SELECT COALESCE(SUM(p.price_cents),0) c, COUNT(*) n FROM sites s JOIN plans p ON p.id = s.plan_id WHERE s.stage IN ('live','care')");
      const pipeline = db.all("SELECT stage, COUNT(*) n FROM sites GROUP BY stage");
      const openReq = db.get("SELECT COUNT(*) n, SUM(priority IN ('high','urgent')) hot FROM requests WHERE status NOT IN ('done','closed')");
      const invs = db.all("SELECT id FROM invoices WHERE status = 'sent'").map((i) => loadInvoice(db, i.id));
      const outstanding = invs.reduce((n, i) => n + i.total_cents, 0);
      const overdue = invs.filter((i) => i.overdue);
      const paid30 = db.all("SELECT id FROM invoices WHERE status = 'paid' AND paid_at >= date('now','-30 days')").map((i) => loadInvoice(db, i.id)).reduce((n, i) => n + i.total_cents, 0);
      const pending = db.all("SELECT v.id, v.number, v.created_at, s.id site_id, s.name site_name, u.role creator_role FROM versions v JOIN sites s ON s.id = v.site_id LEFT JOIN users u ON u.id = v.created_by WHERE v.status = 'pending' ORDER BY v.id DESC LIMIT 10");
      const down = db.all(`SELECT s.id, s.name, s.domain, c.error, c.created_at FROM sites s JOIN checks c ON c.id = (SELECT MAX(id) FROM checks WHERE site_id = s.id) WHERE c.ok = 0`);
      const leads = db.get("SELECT COUNT(*) n FROM submissions WHERE created_at >= datetime('now','-7 days')").n;
      const views = db.get("SELECT COALESCE(SUM(views),0) n FROM pageviews WHERE day >= date('now','-30 days')").n;
      const requests = db.all("SELECT q.id, q.title, q.status, q.priority, q.updated_at, c.name client_name FROM requests q JOIN clients c ON c.id = q.client_id WHERE q.status NOT IN ('done','closed') ORDER BY CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, q.updated_at DESC LIMIT 8");
      const activity = db.all('SELECT a.*, u.name user_name, c.name client_name FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN clients c ON c.id = a.client_id ORDER BY a.id DESC LIMIT 15');
      return { kind: 'agency', mrr_cents: mrr.c, care_sites: mrr.n, pipeline, open_requests: openReq.n, hot_requests: openReq.hot || 0, outstanding_cents: outstanding, overdue: overdue.map((i) => ({ id: i.id, number: i.number, client_name: i.client_name, total_cents: i.total_cents, due_date: i.due_date })), paid_30d_cents: paid30, pending, down, leads_7d: leads, views_30d: views, requests, activity };
    }
    const cid = ctx.user.client_id;
    const sites = db.all("SELECT id, name, slug, domain, stage, published_version_id, updated_at FROM sites WHERE client_id = ? AND stage != 'archived' ORDER BY name", cid);
    const pending = db.all("SELECT v.id, v.number, v.note, v.created_at, s.id site_id, s.name site_name FROM versions v JOIN sites s ON s.id = v.site_id JOIN users u ON u.id = v.created_by WHERE s.client_id = ? AND v.status = 'pending' AND u.role != 'client' ORDER BY v.id DESC", cid);
    const openReq = db.all("SELECT id, title, status, quote_cents, quote_status, updated_at FROM requests WHERE client_id = ? AND status NOT IN ('done','closed') ORDER BY updated_at DESC LIMIT 8", cid);
    const unpaid = db.all("SELECT id FROM invoices WHERE client_id = ? AND status = 'sent'", cid).map((i) => { const x = loadInvoice(db, i.id); delete x.items; return x; });
    const leads = db.get("SELECT COUNT(*) n FROM submissions m JOIN sites s ON s.id = m.site_id WHERE s.client_id = ? AND m.status = 'new'", cid).n;
    const views = db.get("SELECT COALESCE(SUM(views),0) n FROM pageviews pv JOIN sites s ON s.id = pv.site_id WHERE s.client_id = ? AND pv.day >= date('now','-30 days')", cid).n;
    const activity = db.all("SELECT a.action, a.detail, a.created_at, u.name user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.client_id = ? AND a.action NOT LIKE 'client.%' AND a.action NOT LIKE 'invoice.generated' ORDER BY a.id DESC LIMIT 12", cid);
    return { kind: 'client', sites, pending, requests: openReq, unpaid, new_leads: leads, views_30d: views, activity };
  });

  // ----- notifications -----
  r.get('/api/notifications', async (ctx) => {
    requireUser(ctx);
    const items = ctx.db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 40', ctx.user.id);
    const unread = ctx.db.get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read = 0', ctx.user.id).n;
    return { unread, items };
  });
  r.post('/api/notifications/read', async (ctx) => {
    requireUser(ctx);
    const { id } = await ctx.body();
    if (id) ctx.db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', Number(id), ctx.user.id);
    else ctx.db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', ctx.user.id);
    return { ok: true };
  });

  r.get('/api/activity', async (ctx) => {
    requireAgency(ctx);
    return ctx.db.all('SELECT a.*, u.name user_name, c.name client_name, s.name site_name FROM activity a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN clients c ON c.id = a.client_id LEFT JOIN sites s ON s.id = a.site_id ORDER BY a.id DESC LIMIT 200');
  });

  // ----- agency settings & team -----
  r.get('/api/settings', async (ctx) => {
    requireAgency(ctx);
    const s = ctx.settings();
    if (ctx.user.role !== 'owner') delete s.internal_rate_cents;
    return s;
  });
  r.patch('/api/settings', async (ctx) => {
    requireOwner(ctx);
    const b = await ctx.body();
    for (const [k, v] of Object.entries(b)) {
      if (!(k in DEFAULT_SETTINGS)) continue;
      if (k === 'webhook_url' && v && !/^https:\/\//.test(v)) throw bad('Webhook URL must start with https://');
      setSetting(ctx.db, k, v ?? '');
    }
    return ctx.settings();
  });
  r.get('/api/team', async (ctx) => {
    requireAgency(ctx);
    return ctx.db.all("SELECT id, name, email, role, last_login_at, password_hash IS NULL pending FROM users WHERE role IN ('owner','staff') ORDER BY role, name");
  });
  r.post('/api/team', async (ctx) => {
    requireOwner(ctx);
    const { email, name, role } = await ctx.body();
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw bad('A valid email is required');
    const { id, token } = inviteUser(ctx.db, { email: email.trim(), name: (name || email).trim(), role: role === 'owner' ? 'owner' : 'staff' });
    return { id, invite_url: `${ctx.baseUrl}/#/invite/${token}` };
  });

  // ----- integrations, email outbox, backups (owner) -----
  r.get('/api/integrations', async (ctx) => {
    requireOwner(ctx);
    const m = mailConfig();
    return {
      email: { provider: m.provider, from: m.from },
      stripe: { enabled: stripeEnabled(), webhook: !!process.env.STRIPE_WEBHOOK_SECRET, webhook_url: `${ctx.baseUrl}/api/public/stripe/webhook` },
      backups: { offsite: offsiteEnabled(), local_dir: backupDir(dataDir), keep: Number(process.env.BACKUP_KEEP || 14), enabled: process.env.BACKUPS !== '0' },
      monitor: process.env.MONITOR !== '0',
    };
  });
  r.get('/api/outbox', async (ctx) => {
    requireOwner(ctx);
    return ctx.db.all('SELECT id, to_addr, subject, body, provider, status, error, created_at FROM outbox ORDER BY id DESC LIMIT 100');
  });
  r.post('/api/outbox/test', async (ctx) => {
    requireOwner(ctx);
    const out = await sendMail(ctx.db, { to: ctx.user.email, subject: 'Kess Cloud test email', heading: 'Email is working', lines: ['This is a test from Kess Cloud. If you can read this, client notifications, invites and reminders will arrive too.'] });
    return out;
  });
  r.get('/api/backups', async (ctx) => { requireOwner(ctx); return listBackups(dataDir); });
  r.post('/api/backups', async (ctx) => { requireOwner(ctx); return createBackup(ctx.db, dataDir); });
  r.get('/api/backups/:name', async (ctx) => {
    requireOwner(ctx);
    const name = ctx.params.name;
    if (!listBackups(dataDir).some((b) => b.name === name)) throw notFound('Backup not found');
    const buf = await readFile(join(backupDir(dataDir), name));
    ctx.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': buf.length });
    ctx.res.end(buf);
  });
  r.post('/api/jobs/run', async (ctx) => { requireOwner(ctx); return runDaily(ctx.db, dataDir); });

  // ----- assets (client files + site images) -----
  r.get('/api/assets', async (ctx) => {
    requireUser(ctx);
    const agency = isAgency(ctx.user);
    const clientId = agency ? Number(ctx.query.get('client_id')) || null : ctx.user.client_id;
    const rows = clientId
      ? ctx.db.all('SELECT a.*, u.name uploaded_by_name FROM assets a LEFT JOIN users u ON u.id = a.uploaded_by WHERE a.client_id = ? ORDER BY a.created_at DESC', clientId)
      : ctx.db.all('SELECT a.*, u.name uploaded_by_name, c.name client_name FROM assets a LEFT JOIN users u ON u.id = a.uploaded_by LEFT JOIN clients c ON c.id = a.client_id ORDER BY a.created_at DESC LIMIT 300');
    return rows.map((a) => ({ ...a, url: `/assets/${a.id}/${encodeURIComponent(a.filename)}` }));
  });
  r.post('/api/assets', async (ctx) => {
    requireUser(ctx);
    const b = await ctx.body(20_000_000);
    const clientId = isAgency(ctx.user) ? Number(b.client_id) : ctx.user.client_id;
    if (!clientId || !ctx.db.get('SELECT 1 FROM clients WHERE id = ?', clientId)) throw bad('Choose a client');
    if (!ASSET_TYPES.has(b.mime)) throw bad(`File type ${b.mime || 'unknown'} is not allowed`);
    const buf = Buffer.from(String(b.data || ''), 'base64');
    if (!buf.length) throw bad('Empty file');
    if (buf.length > 14_000_000) throw new HttpError(413, 'Files must be under 14 MB');
    const filename = String(b.filename || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    const id = randomUUID();
    await mkdir(assetDir, { recursive: true });
    await writeFile(join(assetDir, id), buf);
    ctx.db.run('INSERT INTO assets (id, client_id, site_id, filename, mime, size, alt, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, clientId, b.site_id || null, filename, b.mime, buf.length, b.alt || '', ctx.user.id);
    return { id, url: `/assets/${id}/${encodeURIComponent(filename)}`, filename };
  });
  r.patch('/api/assets/:id', async (ctx) => {
    const a = ctx.db.get('SELECT * FROM assets WHERE id = ?', ctx.params.id);
    if (!a) throw notFound();
    assertClientAccess(ctx, a.client_id);
    const { alt } = await ctx.body();
    ctx.db.run('UPDATE assets SET alt = ? WHERE id = ?', String(alt || ''), a.id);
    return { ok: true };
  });
  r.delete('/api/assets/:id', async (ctx) => {
    const a = ctx.db.get('SELECT * FROM assets WHERE id = ?', ctx.params.id);
    if (!a) throw notFound();
    assertClientAccess(ctx, a.client_id);
    ctx.db.run('DELETE FROM assets WHERE id = ?', a.id);
    await unlink(join(assetDir, a.id)).catch(() => {});
    return { ok: true };
  });
  // Public, unguessable URL so hosted sites can embed images.
  r.get('/assets/:id/:name', async (ctx) => {
    const a = /^[0-9a-f-]{36}$/.test(ctx.params.id) && ctx.db.get('SELECT * FROM assets WHERE id = ?', ctx.params.id);
    if (!a) throw notFound();
    const body = await readFile(join(assetDir, a.id)).catch(() => null);
    if (!body) throw notFound();
    ctx.res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    ctx.res.end(body);
  });
}
