import { bad, notFound } from '../lib/http.js';
import { requireAgency, requireOwner, assertClientAccess, randomToken, sha256 } from '../lib/auth.js';
import { logActivity, loadInvoice } from '../lib/services.js';

const FIELDS = ['name', 'contact_name', 'email', 'phone', 'abn', 'address', 'notes', 'status'];
const STATUSES = ['lead', 'active', 'paused', 'past'];

export function inviteUser(db, { email, name, role, client_id }) {
  const existing = db.get('SELECT id FROM users WHERE email = ?', email);
  if (existing) throw bad('A user with that email already exists');
  const { id } = db.run('INSERT INTO users (email, name, role, client_id) VALUES (?, ?, ?, ?)', email, name, role, client_id ?? null);
  const token = randomToken();
  db.run('INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), id, Date.now() + 14 * 864e5);
  return { id, token };
}

export default function register(r) {
  r.get('/api/clients', async (ctx) => {
    requireAgency(ctx);
    return ctx.db.all(`SELECT c.*,
      (SELECT COUNT(*) FROM sites s WHERE s.client_id = c.id) site_count,
      (SELECT COUNT(*) FROM requests q WHERE q.client_id = c.id AND q.status NOT IN ('done','closed')) open_requests,
      (SELECT COALESCE(SUM(p.price_cents),0) FROM sites s JOIN plans p ON p.id = s.plan_id WHERE s.client_id = c.id AND s.stage IN ('live','care')) mrr_cents
      FROM clients c ORDER BY CASE c.status WHEN 'active' THEN 0 WHEN 'lead' THEN 1 ELSE 2 END, c.name`);
  });

  r.post('/api/clients', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    if (!b.name?.trim()) throw bad('Client name is required');
    const status = STATUSES.includes(b.status) ? b.status : 'active';
    const { id } = ctx.db.run('INSERT INTO clients (name, contact_name, email, phone, abn, address, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      b.name.trim(), b.contact_name, b.email, b.phone, b.abn, b.address, b.notes, status);
    logActivity(ctx.db, { user: ctx.user, client_id: id, action: 'client.created', detail: b.name });
    return ctx.db.get('SELECT * FROM clients WHERE id = ?', id);
  });

  r.get('/api/clients/:id', async (ctx) => {
    const id = Number(ctx.params.id);
    assertClientAccess(ctx, id);
    const c = ctx.db.get('SELECT * FROM clients WHERE id = ?', id);
    if (!c) throw notFound('Client not found');
    const agency = ctx.user.role !== 'client';
    if (!agency) delete c.notes;
    const sites = ctx.db.all('SELECT s.id, s.name, s.slug, s.domain, s.stage, s.plan_id, s.published_version_id, s.updated_at, p.name plan_name, p.price_cents FROM sites s LEFT JOIN plans p ON p.id = s.plan_id WHERE s.client_id = ? ORDER BY s.name', id);
    const users = ctx.db.all("SELECT id, name, email, role, last_login_at, password_hash IS NULL pending FROM users WHERE client_id = ? ORDER BY name", id);
    const invoices = ctx.db.all(`SELECT id FROM invoices WHERE client_id = ? ${agency ? '' : "AND status != 'draft'"} ORDER BY issue_date DESC LIMIT 12`, id).map((i) => {
      const inv = loadInvoice(ctx.db, i.id); delete inv.items; return inv;
    });
    const activity = agency ? ctx.db.all('SELECT a.*, u.name user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.client_id = ? ORDER BY a.id DESC LIMIT 30', id) : [];
    return { ...c, sites, users, invoices, activity };
  });

  r.patch('/api/clients/:id', async (ctx) => {
    requireAgency(ctx);
    const id = Number(ctx.params.id);
    const b = await ctx.body();
    const c = ctx.db.get('SELECT * FROM clients WHERE id = ?', id);
    if (!c) throw notFound('Client not found');
    if (b.status && !STATUSES.includes(b.status)) throw bad('Invalid status');
    const next = { ...c };
    for (const k of FIELDS) if (k in b) next[k] = b[k];
    if (!String(next.name || '').trim()) throw bad('Client name is required');
    ctx.db.run('UPDATE clients SET name=?, contact_name=?, email=?, phone=?, abn=?, address=?, notes=?, status=? WHERE id=?', ...FIELDS.map((k) => next[k]), id);
    logActivity(ctx.db, { user: ctx.user, client_id: id, action: 'client.updated' });
    return ctx.db.get('SELECT * FROM clients WHERE id = ?', id);
  });

  r.delete('/api/clients/:id', async (ctx) => {
    requireOwner(ctx);
    const { changes } = ctx.db.run('DELETE FROM clients WHERE id = ?', Number(ctx.params.id));
    if (!changes) throw notFound('Client not found');
    return { ok: true };
  });

  // Invite a client portal user. Returns the invite link once.
  r.post('/api/clients/:id/users', async (ctx) => {
    requireAgency(ctx);
    const id = Number(ctx.params.id);
    if (!ctx.db.get('SELECT id FROM clients WHERE id = ?', id)) throw notFound('Client not found');
    const { email, name } = await ctx.body();
    if (!/^\S+@\S+\.\S+$/.test(email || '')) throw bad('A valid email is required');
    const { id: userId, token } = inviteUser(ctx.db, { email: email.trim(), name: (name || email).trim(), role: 'client', client_id: id });
    logActivity(ctx.db, { user: ctx.user, client_id: id, action: 'user.invited', detail: email });
    return { id: userId, invite_url: `${ctx.baseUrl}/#/invite/${token}` };
  });

  r.post('/api/users/:id/reset', async (ctx) => {
    requireAgency(ctx);
    const u = ctx.db.get('SELECT id, role FROM users WHERE id = ?', Number(ctx.params.id));
    if (!u) throw notFound('User not found');
    if (u.role !== 'client') requireOwner(ctx);
    const token = randomToken();
    ctx.db.run('DELETE FROM invites WHERE user_id = ?', u.id);
    ctx.db.run('INSERT INTO invites (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha256(token), u.id, Date.now() + 3 * 864e5);
    return { invite_url: `${ctx.baseUrl}/#/invite/${token}` };
  });

  r.delete('/api/users/:id', async (ctx) => {
    requireAgency(ctx);
    const u = ctx.db.get('SELECT id, role FROM users WHERE id = ?', Number(ctx.params.id));
    if (!u) throw notFound('User not found');
    if (u.role !== 'client') requireOwner(ctx);
    if (u.id === ctx.user.id) throw bad('You cannot remove yourself');
    ctx.db.run('DELETE FROM users WHERE id = ?', u.id);
    return { ok: true };
  });
}
