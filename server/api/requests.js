import { bad, notFound, forbidden } from '../lib/http.js';
import { requireAgency, assertClientAccess, isAgency, requireUser } from '../lib/auth.js';
import { logActivity, notify } from '../lib/services.js';

export const REQUEST_STATUSES = ['new', 'quoted', 'in_progress', 'waiting', 'done', 'closed'];
const KINDS = ['change', 'bug', 'content', 'feedback', 'new_feature', 'question'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// Fields a client is allowed to see.
function forClient(r) {
  const { estimate_hours, assignee_id, assignee_name, hours_logged, ...rest } = r;
  return rest;
}

function loadRequest(db, id) {
  const r = db.get(`SELECT q.*, c.name client_name, s.name site_name, u.name created_by_name, a.name assignee_name,
    (SELECT COALESCE(SUM(hours),0) FROM time_entries t WHERE t.request_id = q.id) hours_logged
    FROM requests q JOIN clients c ON c.id = q.client_id LEFT JOIN sites s ON s.id = q.site_id LEFT JOIN users u ON u.id = q.created_by LEFT JOIN users a ON a.id = q.assignee_id WHERE q.id = ?`, id);
  if (!r) throw notFound('Request not found');
  return r;
}

export default function register(r) {
  r.get('/api/requests', async (ctx) => {
    requireUser(ctx);
    const agency = isAgency(ctx.user);
    const status = ctx.query.get('status');
    const conds = [], args = [];
    if (!agency) { conds.push('q.client_id = ?'); args.push(ctx.user.client_id); }
    else if (ctx.query.get('client_id')) { conds.push('q.client_id = ?'); args.push(Number(ctx.query.get('client_id'))); }
    if (ctx.query.get('site_id')) { conds.push('q.site_id = ?'); args.push(Number(ctx.query.get('site_id'))); }
    if (status === 'open') conds.push("q.status NOT IN ('done','closed')");
    else if (REQUEST_STATUSES.includes(status)) { conds.push('q.status = ?'); args.push(status); }
    const rows = ctx.db.all(`SELECT q.*, c.name client_name, s.name site_name, a.name assignee_name,
      (SELECT COUNT(*) FROM request_comments rc WHERE rc.request_id = q.id ${agency ? '' : 'AND rc.internal = 0'}) comments,
      (SELECT COALESCE(SUM(hours),0) FROM time_entries t WHERE t.request_id = q.id) hours_logged
      FROM requests q JOIN clients c ON c.id = q.client_id LEFT JOIN sites s ON s.id = q.site_id LEFT JOIN users a ON a.id = q.assignee_id
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY CASE q.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, q.updated_at DESC LIMIT 500`, ...args);
    return agency ? rows : rows.map(forClient);
  });

  r.post('/api/requests', async (ctx) => {
    requireUser(ctx);
    const b = await ctx.body();
    const agency = isAgency(ctx.user);
    const clientId = agency ? Number(b.client_id) : ctx.user.client_id;
    if (!clientId || !ctx.db.get('SELECT 1 FROM clients WHERE id = ?', clientId)) throw bad('Choose a client');
    if (!String(b.title || '').trim()) throw bad('Give the request a short title');
    if (b.site_id && !ctx.db.get('SELECT 1 FROM sites WHERE id = ? AND client_id = ?', Number(b.site_id), clientId)) throw bad('Site does not belong to this client');
    const kind = KINDS.includes(b.kind) ? b.kind : 'change';
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'normal';
    const { id } = ctx.db.run('INSERT INTO requests (client_id, site_id, title, body, kind, priority, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      clientId, b.site_id ? Number(b.site_id) : null, String(b.title).trim().slice(0, 200), String(b.body || '').slice(0, 20000), kind, priority, b.due_date || null, ctx.user.id);
    logActivity(ctx.db, { user: ctx.user, client_id: clientId, site_id: b.site_id || null, action: 'request.created', detail: `#${id} ${b.title}` });
    if (!agency) notify(ctx.db, { audience: 'agency', client_id: clientId, title: `New ${kind.replace('_', ' ')} request: ${b.title}`, body: String(b.body || '').slice(0, 300), link: `#/requests/${id}` });
    else notify(ctx.db, { audience: 'client', client_id: clientId, title: `Kess Media opened request #${id}: ${b.title}`, link: `#/requests/${id}` });
    return loadRequest(ctx.db, id);
  });

  r.get('/api/requests/:id', async (ctx) => {
    const q = loadRequest(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, q.client_id);
    const agency = isAgency(ctx.user);
    const comments = ctx.db.all(`SELECT rc.*, u.name user_name, u.role user_role FROM request_comments rc LEFT JOIN users u ON u.id = rc.user_id WHERE rc.request_id = ? ${agency ? '' : 'AND rc.internal = 0'} ORDER BY rc.id`, q.id);
    const time = agency ? ctx.db.all('SELECT t.*, u.name user_name FROM time_entries t LEFT JOIN users u ON u.id = t.user_id WHERE t.request_id = ? ORDER BY t.day DESC, t.id DESC', q.id) : [];
    return { ...(agency ? q : forClient(q)), comments, time };
  });

  r.patch('/api/requests/:id', async (ctx) => {
    const q = loadRequest(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, q.client_id);
    const b = await ctx.body();
    const agency = isAgency(ctx.user);
    const next = { ...q };
    if (agency) {
      if ('status' in b) { if (!REQUEST_STATUSES.includes(b.status)) throw bad('Invalid status'); next.status = b.status; }
      if ('priority' in b) { if (!PRIORITIES.includes(b.priority)) throw bad('Invalid priority'); next.priority = b.priority; }
      if ('estimate_hours' in b) next.estimate_hours = b.estimate_hours === '' || b.estimate_hours == null ? null : Number(b.estimate_hours);
      if ('quote_cents' in b) {
        next.quote_cents = b.quote_cents === '' || b.quote_cents == null ? null : Math.round(Number(b.quote_cents));
        if (next.quote_cents && next.quote_cents !== q.quote_cents) { next.quote_status = 'pending'; next.billable = 1; if (next.status === 'new') next.status = 'quoted'; }
      }
      if ('billable' in b) next.billable = b.billable ? 1 : 0;
      if ('assignee_id' in b) next.assignee_id = b.assignee_id ? Number(b.assignee_id) : null;
      if ('due_date' in b) next.due_date = b.due_date || null;
      if ('title' in b && String(b.title).trim()) next.title = String(b.title).trim();
    } else {
      // Clients may: accept/decline a quote, close their own request, edit title/body while new.
      if ('quote_decision' in b) {
        if (q.quote_status !== 'pending') throw bad('There is no quote waiting for a decision');
        next.quote_status = b.quote_decision === 'approved' ? 'approved' : 'declined';
        next.status = next.quote_status === 'approved' ? 'in_progress' : 'waiting';
      }
      if (b.status === 'closed') next.status = 'closed';
      else if ('status' in b) throw forbidden();
      if (q.status === 'new') {
        if ('title' in b && String(b.title).trim()) next.title = String(b.title).trim();
        if ('body' in b) next.body = String(b.body);
      }
    }
    ctx.db.run("UPDATE requests SET title=?, body=?, status=?, priority=?, estimate_hours=?, quote_cents=?, quote_status=?, billable=?, assignee_id=?, due_date=?, updated_at=datetime('now') WHERE id=?",
      next.title, next.body, next.status, next.priority, next.estimate_hours, next.quote_cents, next.quote_status, next.billable, next.assignee_id, next.due_date, q.id);
    const changes = [];
    if (next.status !== q.status) changes.push(`status ${q.status} → ${next.status}`);
    if (next.quote_cents !== q.quote_cents && next.quote_cents) changes.push(`quoted $${(next.quote_cents / 100).toFixed(2)} ex GST`);
    if (next.quote_status !== q.quote_status && !agency) changes.push(`quote ${next.quote_status}`);
    if (changes.length) {
      logActivity(ctx.db, { user: ctx.user, client_id: q.client_id, site_id: q.site_id, action: 'request.updated', detail: `#${q.id}: ${changes.join(', ')}` });
      notify(ctx.db, { audience: agency ? 'client' : 'agency', client_id: q.client_id, title: `Request #${q.id} ${changes.join(', ')}`, body: q.title, link: `#/requests/${q.id}` });
    }
    return loadRequest(ctx.db, q.id);
  });

  r.post('/api/requests/:id/comments', async (ctx) => {
    const q = loadRequest(ctx.db, Number(ctx.params.id));
    assertClientAccess(ctx, q.client_id);
    const b = await ctx.body();
    const body = String(b.body || '').trim();
    if (!body) throw bad('Comment is empty');
    const agency = isAgency(ctx.user);
    const internal = agency && b.internal ? 1 : 0;
    const { id } = ctx.db.run('INSERT INTO request_comments (request_id, user_id, body, internal) VALUES (?, ?, ?, ?)', q.id, ctx.user.id, body.slice(0, 20000), internal);
    let status = q.status;
    if (!agency && q.status === 'waiting') status = 'in_progress';
    ctx.db.run("UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?", status, q.id);
    if (!internal) notify(ctx.db, { audience: agency ? 'client' : 'agency', client_id: q.client_id, title: `${ctx.user.name} replied on #${q.id}`, body: body.slice(0, 200), link: `#/requests/${q.id}` });
    return { id };
  });

  r.post('/api/requests/:id/time', async (ctx) => {
    requireAgency(ctx);
    const q = loadRequest(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const hours = Number(b.hours);
    if (!(hours > 0 && hours <= 24)) throw bad('Hours must be between 0 and 24');
    ctx.db.run('INSERT INTO time_entries (request_id, site_id, user_id, hours, note, day) VALUES (?, ?, ?, ?, ?, ?)', q.id, q.site_id, ctx.user.id, hours, b.note || '', b.day || new Date().toISOString().slice(0, 10));
    return { ok: true };
  });
}
