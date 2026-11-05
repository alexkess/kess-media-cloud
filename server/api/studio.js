import { bad, notFound, HttpError } from '../lib/http.js';
import { requireAgency, requireOwner, randomToken } from '../lib/auth.js';
import { j, logActivity, slugify } from '../lib/services.js';
import { getSettings } from '../db.js';
import {
  JOB_STATUSES, CATEGORIES, newToken, today, sha256, getJob, loadJob, jobContext, merge, jobEvent, sendJobEmail,
  createPlanInvoices, sendInvoiceEmail, bookJob, detectProvider, runEmailStep, planSchedule, jobTotals, assertSendable, addDelivery,
} from '../lib/studio.js';

const str = (v, max = 500) => String(v ?? '').slice(0, max);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isTime = (v) => /^\d{2}:\d{2}$/.test(v || '');

// Studio setup resources share one CRUD shape. JSON fields are stored as text.
const RESOURCES = {
  packages: { table: 'packages', fields: { name: 'text', category: 'category', description: 'longtext', price_cents: 'int', items: 'json', sort: 'int' } },
  'contract-templates': { table: 'contract_templates', fields: { name: 'text', body: 'longtext' } },
  'payment-plans': { table: 'payment_plans', fields: { name: 'text', steps: 'json' } },
  workflows: { table: 'workflows', fields: { name: 'text', steps: 'json' } },
  questionnaires: { table: 'questionnaires', fields: { name: 'text', intro: 'longtext', questions: 'json' } },
};
function cleanField(type, v) {
  if (type === 'int') return Math.round(Number(v) || 0);
  if (type === 'json') { if (!Array.isArray(v)) throw bad('Expected a list'); const s = JSON.stringify(v); if (s.length > 100_000) throw bad('Too long'); return s; }
  if (type === 'category') return CATEGORIES.includes(v) ? v : 'photo';
  return str(v, type === 'longtext' ? 50_000 : 200);
}

const JOB_FIELDS = ['title', 'category', 'status', 'shoot_date', 'start_time', 'end_time', 'location', 'notes', 'owner_id', 'contract_template_id', 'payment_plan_id', 'workflow_id', 'questionnaire_id', 'source'];
function cleanJob(b, prev = {}) {
  const out = { ...prev };
  for (const k of JOB_FIELDS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (k === 'category') { if (!CATEGORIES.includes(v)) throw bad('Invalid category'); out[k] = v; }
    else if (k === 'status') { if (!JOB_STATUSES.includes(v)) throw bad('Invalid status'); out[k] = v; }
    else if (k === 'shoot_date') { if (v && !isDate(v)) throw bad('Date must be YYYY-MM-DD'); out[k] = v || null; }
    else if (k === 'start_time' || k === 'end_time') { if (v && !isTime(v)) throw bad('Time must be HH:MM'); out[k] = v || null; }
    else if (k.endsWith('_id')) out[k] = v ? Number(v) : null;
    else out[k] = str(v, k === 'notes' ? 20_000 : 300);
  }
  if (!String(out.title || '').trim()) throw bad('Give the job a title');
  return out;
}

export function findOrCreateClient(db, { name, contact_name, email, phone }) {
  const e = String(email || '').trim().toLowerCase();
  if (e) { const c = db.get('SELECT * FROM clients WHERE lower(email) = ?', e); if (c) return c.id; }
  const n = String(name || contact_name || e || 'New client').trim();
  return db.run("INSERT INTO clients (name, contact_name, email, phone, status) VALUES (?, ?, ?, ?, 'lead')", n, contact_name || n, e || null, phone || null).id;
}

function addPackageLines(db, jobId, packageIds = []) {
  let sort = (db.get('SELECT MAX(sort) m FROM job_lines WHERE job_id = ?', jobId)?.m ?? -1) + 1;
  for (const pid of packageIds) {
    const p = db.get('SELECT * FROM packages WHERE id = ?', Number(pid));
    if (!p) continue;
    const details = j(p.items, []).join('\n');
    db.run('INSERT INTO job_lines (job_id, package_id, description, details, qty, unit_cents, sort) VALUES (?, ?, ?, ?, 1, ?, ?)', jobId, p.id, p.name, details, p.price_cents, sort++);
  }
}

export default function register(r) {
  // ----- setup resources -----
  for (const [path, cfg] of Object.entries(RESOURCES)) {
    r.get(`/api/studio/${path}`, async (ctx) => {
      requireAgency(ctx);
      const jsonKeys = Object.entries(cfg.fields).filter(([, t]) => t === 'json').map(([k]) => k);
      return ctx.db.all(`SELECT * FROM ${cfg.table} ORDER BY active DESC, ${cfg.fields.sort ? 'sort, ' : ''}name`).map((row) => {
        for (const k of jsonKeys) row[k] = j(row[k], []);
        return { ...row, active: !!row.active };
      });
    });
    r.post(`/api/studio/${path}`, async (ctx) => {
      requireAgency(ctx);
      const b = await ctx.body(200_000);
      if (!String(b.name || '').trim()) throw bad('Name is required');
      const keys = Object.keys(cfg.fields).filter((k) => k in b || cfg.fields[k] === 'json');
      const vals = keys.map((k) => cleanField(cfg.fields[k], k in b ? b[k] : []));
      const { id } = ctx.db.run(`INSERT INTO ${cfg.table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, ...vals);
      return { id };
    });
    r.patch(`/api/studio/${path}/:id`, async (ctx) => {
      requireAgency(ctx);
      const row = ctx.db.get(`SELECT * FROM ${cfg.table} WHERE id = ?`, Number(ctx.params.id));
      if (!row) throw notFound();
      const b = await ctx.body(200_000);
      const keys = Object.keys(cfg.fields).filter((k) => k in b);
      if ('name' in b && !String(b.name).trim()) throw bad('Name is required');
      const sets = keys.map((k) => `${k} = ?`);
      const vals = keys.map((k) => cleanField(cfg.fields[k], b[k]));
      if ('active' in b) { sets.push('active = ?'); vals.push(b.active ? 1 : 0); }
      if (sets.length) ctx.db.run(`UPDATE ${cfg.table} SET ${sets.join(', ')} WHERE id = ?`, ...vals, row.id);
      return { ok: true };
    });
  }

  // Preview a payment plan against a job (or a sample).
  r.post('/api/studio/payment-plans/preview', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    return planSchedule(b.steps || [], { shoot_date: b.shoot_date || null }, Math.round(Number(b.subtotal_cents) || 100000));
  });

  // ----- overview + calendar -----
  r.get('/api/studio/overview', async (ctx) => {
    requireAgency(ctx);
    const mine = ctx.query.get('mine') === '1' ? ctx.user.id : null;
    const own = mine ? 'AND j.owner_id = ?' : '';
    const a = mine ? [mine] : [];
    const counts = Object.fromEntries(ctx.db.all(`SELECT status, COUNT(*) n FROM jobs j WHERE 1=1 ${own} GROUP BY status`, ...a).map((r) => [r.status, r.n]));
    const upcoming = ctx.db.all(`SELECT j.id, j.title, j.status, j.shoot_date, j.start_time, j.location, j.category, c.name client_name, u.name owner_name FROM jobs j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.owner_id
      WHERE j.shoot_date >= date('now') AND j.shoot_date <= date('now', '+45 days') AND j.status NOT IN ('lost','complete') ${own} ORDER BY j.shoot_date, j.start_time LIMIT 20`, ...a);
    const tasks = ctx.db.all(`SELECT s.*, j.title job_title, c.name client_name FROM job_steps s JOIN jobs j ON j.id = s.job_id JOIN clients c ON c.id = j.client_id
      WHERE s.status = 'pending' AND s.action = 'task' AND (s.due_date IS NULL OR s.due_date <= date('now', '+7 days')) AND j.status NOT IN ('lost','complete') ${own} ORDER BY s.due_date IS NULL, s.due_date LIMIT 30`, ...a);
    const enquiries = ctx.db.all(`SELECT j.id, j.title, j.created_at, j.shoot_date, c.name client_name FROM jobs j JOIN clients c ON c.id = j.client_id WHERE j.status = 'enquiry' ${own} ORDER BY j.id DESC LIMIT 10`, ...a);
    const unpaid = ctx.db.all(`SELECT i.id FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE i.status = 'sent' ${own.replace('j.owner_id', 'j.owner_id')}`, ...a).length;
    const scheduled = ctx.db.get(`SELECT COUNT(*) n FROM invoices i JOIN jobs j ON j.id = i.job_id WHERE i.status = 'draft' AND i.send_on IS NOT NULL ${own}`, ...a).n;
    return { counts, upcoming, tasks, enquiries, unpaid_invoices: unpaid, scheduled_invoices: scheduled };
  });

  r.get('/api/studio/calendar', async (ctx) => {
    requireAgency(ctx);
    const month = /^\d{4}-\d{2}$/.test(ctx.query.get('month') || '') ? ctx.query.get('month') : today().slice(0, 7);
    return ctx.db.all(`SELECT j.id, j.title, j.status, j.category, j.shoot_date, j.start_time, j.end_time, j.location, c.name client_name, u.name owner_name
      FROM jobs j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.owner_id
      WHERE substr(j.shoot_date, 1, 7) = ? AND j.status != 'lost' ORDER BY j.shoot_date, j.start_time`, month);
  });

  // Personal calendar subscription (Google/Apple/Outlook).
  r.get('/api/studio/calendar-link', async (ctx) => {
    requireAgency(ctx);
    let t = ctx.db.get('SELECT cal_token FROM users WHERE id = ?', ctx.user.id).cal_token;
    if (!t || ctx.query.get('reset') === '1') { t = randomToken(24); ctx.db.run('UPDATE users SET cal_token = ? WHERE id = ?', t, ctx.user.id); }
    return { mine: `${ctx.baseUrl}/cal/${t}.ics`, all: `${ctx.baseUrl}/cal/${t}.ics?all=1` };
  });
  r.get('/cal/:file', async (ctx) => {
    const m = /^([A-Za-z0-9_-]{20,64})\.ics$/.exec(ctx.params.file);
    const u = m && ctx.db.get("SELECT id, name FROM users WHERE cal_token = ? AND role IN ('owner','staff')", m[1]);
    if (!u) throw notFound();
    const all = ctx.query.get('all') === '1';
    const jobs = ctx.db.all(`SELECT j.*, c.name client_name, c.phone client_phone FROM jobs j JOIN clients c ON c.id = j.client_id
      WHERE j.shoot_date IS NOT NULL AND j.status NOT IN ('lost') AND j.shoot_date >= date('now', '-90 days') ${all ? '' : 'AND j.owner_id = ?'}`, ...(all ? [] : [u.id]));
    const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const fold = (line) => line.match(/.{1,73}/g).join('\r\n ');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kess Media//Kess Cloud//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(`${getSettings(ctx.db).agency_name} shoots${all ? '' : ` (${u.name})`}`)}`, 'X-WR-TIMEZONE:Australia/Sydney'];
    for (const jb of jobs) {
      const d = jb.shoot_date.replace(/-/g, '');
      lines.push('BEGIN:VEVENT', `UID:job-${jb.id}@kess-cloud`, `DTSTAMP:${stamp}`);
      if (jb.start_time) {
        lines.push(`DTSTART;TZID=Australia/Sydney:${d}T${jb.start_time.replace(':', '')}00`);
        const end = jb.end_time && jb.end_time > jb.start_time ? jb.end_time : `${String(Math.min(23, Number(jb.start_time.slice(0, 2)) + 2)).padStart(2, '0')}${jb.start_time.slice(2)}`;
        lines.push(`DTEND;TZID=Australia/Sydney:${d}T${end.replace(':', '')}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${jb.shoot_date ? (new Date(Date.parse(jb.shoot_date) + 864e5)).toISOString().slice(0, 10).replace(/-/g, '') : d}`);
      }
      lines.push(`SUMMARY:${icsEsc(`${jb.status === 'enquiry' || jb.status === 'quoted' ? '(Hold) ' : ''}${jb.title} · ${jb.client_name}`)}`);
      if (jb.location) lines.push(`LOCATION:${icsEsc(jb.location)}`);
      lines.push(`DESCRIPTION:${icsEsc(`${jb.status}${jb.client_phone ? ` · ${jb.client_phone}` : ''}\n${ctx.baseUrl}/#/studio/jobs/${jb.id}`)}`);
      lines.push(`STATUS:${jb.status === 'enquiry' || jb.status === 'quoted' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    const body = lines.map(fold).join('\r\n') + '\r\n';
    ctx.res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
    ctx.res.end(body);
  });

  // ----- jobs -----
  r.get('/api/studio/jobs', async (ctx) => {
    requireAgency(ctx);
    const conds = [], args = [];
    const st = ctx.query.get('status');
    if (st === 'active') conds.push("j.status NOT IN ('lost','complete')");
    else if (JOB_STATUSES.includes(st)) { conds.push('j.status = ?'); args.push(st); }
    if (ctx.query.get('owner')) { conds.push('j.owner_id = ?'); args.push(Number(ctx.query.get('owner'))); }
    if (ctx.query.get('client')) { conds.push('j.client_id = ?'); args.push(Number(ctx.query.get('client'))); }
    const rows = ctx.db.all(`SELECT j.id, j.title, j.category, j.status, j.shoot_date, j.start_time, j.location, j.client_id, j.owner_id, j.updated_at, c.name client_name, u.name owner_name,
      (SELECT COUNT(*) FROM invoices i WHERE i.job_id = j.id AND i.status = 'sent') unpaid,
      (SELECT status FROM contracts k WHERE k.job_id = j.id ORDER BY id DESC LIMIT 1) contract_status
      FROM jobs j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.owner_id ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY CASE WHEN j.shoot_date >= date('now') THEN 0 ELSE 1 END, j.shoot_date IS NULL, j.shoot_date LIMIT 500`, ...args);
    return rows.map((x) => ({ ...x, total_cents: jobTotals(ctx.db, x.id).total_cents }));
  });

  r.post('/api/studio/jobs', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    let clientId = Number(b.client_id) || null;
    if (!clientId) {
      if (!String(b.client_name || b.client_email || '').trim()) throw bad('Choose a client or enter their name');
      if (b.client_email && !/^\S+@\S+\.\S+$/.test(b.client_email)) throw bad('Client email looks wrong');
      clientId = findOrCreateClient(ctx.db, { name: b.client_name, contact_name: b.contact_name || b.client_name, email: b.client_email, phone: b.client_phone });
    } else if (!ctx.db.get('SELECT 1 FROM clients WHERE id = ?', clientId)) throw bad('Client not found');
    const job = cleanJob({ status: 'enquiry', category: 'photo', owner_id: ctx.user.id, ...b });
    const id = ctx.db.tx(() => {
      const { id } = ctx.db.run(`INSERT INTO jobs (client_id, ${JOB_FIELDS.join(', ')}, token) VALUES (?, ${JOB_FIELDS.map(() => '?').join(', ')}, ?)`, clientId, ...JOB_FIELDS.map((k) => job[k] ?? null), newToken());
      addPackageLines(ctx.db, id, b.package_ids || []);
      return id;
    });
    jobEvent(ctx.db, id, ctx.user.name, 'job.created', job.title);
    logActivity(ctx.db, { user: ctx.user, client_id: clientId, action: 'job.created', detail: job.title });
    return loadJob(ctx.db, id);
  });

  r.get('/api/studio/jobs/:id', async (ctx) => { requireAgency(ctx); return loadJob(ctx.db, Number(ctx.params.id)); });

  r.patch('/api/studio/jobs/:id', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const next = cleanJob(b, job);
    ctx.db.run(`UPDATE jobs SET ${JOB_FIELDS.map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...JOB_FIELDS.map((k) => next[k] ?? null), job.id);
    if (b.status && b.status !== job.status) jobEvent(ctx.db, job.id, ctx.user.name, 'status', `${job.status} → ${b.status}`);
    if (b.shoot_date && b.shoot_date !== job.shoot_date) {
      // Move pending workflow steps and unsent scheduled invoices with the new date.
      const diff = job.shoot_date ? Math.round((Date.parse(b.shoot_date) - Date.parse(job.shoot_date)) / 864e5) : 0;
      if (diff) {
        const shift = `${diff} days`;
        ctx.db.run("UPDATE job_steps SET due_date = date(due_date, ?) WHERE job_id = ? AND status = 'pending' AND due_date IS NOT NULL AND due_date >= date('now')", shift, job.id);
        // Unsent scheduled invoices (e.g. the balance before the shoot) move too, never into the past.
        ctx.db.run(`UPDATE invoices SET send_on = MAX(date(send_on, ?), date('now')), due_date = MAX(date(due_date, ?), date('now')), issue_date = MAX(date(send_on, ?), date('now'))
          WHERE job_id = ? AND status = 'draft' AND send_on IS NOT NULL`, shift, shift, shift, job.id);
        jobEvent(ctx.db, job.id, ctx.user.name, 'date.changed', `${job.shoot_date} → ${b.shoot_date}; pending steps and scheduled invoices moved ${diff} days`);
      }
    }
    return loadJob(ctx.db, job.id);
  });

  r.delete('/api/studio/jobs/:id', async (ctx) => {
    requireOwner(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    if (ctx.db.get("SELECT 1 FROM invoices WHERE job_id = ? AND status IN ('sent','paid')", job.id)) throw bad('This job has sent or paid invoices. Mark it lost or complete instead.');
    ctx.db.tx(() => { ctx.db.run("DELETE FROM invoices WHERE job_id = ? AND status = 'draft'", job.id); ctx.db.run('DELETE FROM jobs WHERE id = ?', job.id); });
    return { ok: true };
  });

  // quote lines
  r.post('/api/studio/jobs/:id/lines', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    if (b.package_id) addPackageLines(ctx.db, job.id, [b.package_id]);
    else {
      if (!String(b.description || '').trim()) throw bad('Describe the line');
      const sort = (ctx.db.get('SELECT MAX(sort) m FROM job_lines WHERE job_id = ?', job.id)?.m ?? -1) + 1;
      ctx.db.run('INSERT INTO job_lines (job_id, description, details, qty, unit_cents, optional, selected, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', job.id, str(b.description, 200), str(b.details, 2000), Number(b.qty) || 1, Math.round(Number(b.unit_cents) || 0), b.optional ? 1 : 0, b.optional ? 0 : 1, sort);
    }
    return loadJob(ctx.db, job.id);
  });
  r.patch('/api/studio/jobs/:id/lines/:lid', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const line = ctx.db.get('SELECT * FROM job_lines WHERE id = ? AND job_id = ?', Number(ctx.params.lid), job.id);
    if (!line) throw notFound();
    const b = await ctx.body();
    ctx.db.run('UPDATE job_lines SET description = ?, details = ?, qty = ?, unit_cents = ?, optional = ?, selected = ?, sort = ? WHERE id = ?',
      'description' in b ? str(b.description, 200) : line.description, 'details' in b ? str(b.details, 2000) : line.details,
      'qty' in b ? Number(b.qty) || 1 : line.qty, 'unit_cents' in b ? Math.round(Number(b.unit_cents) || 0) : line.unit_cents,
      'optional' in b ? (b.optional ? 1 : 0) : line.optional, 'selected' in b ? (b.selected ? 1 : 0) : line.selected, 'sort' in b ? Number(b.sort) : line.sort, line.id);
    return loadJob(ctx.db, job.id);
  });
  r.delete('/api/studio/jobs/:id/lines/:lid', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    ctx.db.run('DELETE FROM job_lines WHERE id = ? AND job_id = ?', Number(ctx.params.lid), job.id);
    return loadJob(ctx.db, job.id);
  });

  // Create (or refresh) the contract from the job's template. Signed contracts are never changed.
  function prepareContract(db, job, user) {
    if (!job.contract_template_id) return null;
    const signed = db.get("SELECT id FROM contracts WHERE job_id = ? AND status = 'signed'", job.id);
    if (signed) return signed.id;
    const tpl = db.get('SELECT * FROM contract_templates WHERE id = ?', job.contract_template_id);
    if (!tpl) throw bad('The contract template no longer exists');
    const body = merge(tpl.body, jobContext(db, job));
    db.run("DELETE FROM contracts WHERE job_id = ? AND status != 'signed'", job.id);
    const owner = job.owner_id ? db.get('SELECT name FROM users WHERE id = ?', job.owner_id) : user;
    return db.run("INSERT INTO contracts (job_id, title, body, body_hash, status, agency_signer) VALUES (?, ?, ?, ?, 'sent', ?)", job.id, tpl.name, body, sha256(body), `${owner?.name || ''}, for ${getSettings(db).agency_name}`).id;
  }

  r.post('/api/studio/jobs/:id/send-quote', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    assertSendable(ctx.db, job);
    if (!jobTotals(ctx.db, job.id).subtotal_cents) throw bad('Add packages or lines to the quote first');
    const b = await ctx.body();
    prepareContract(ctx.db, job, ctx.user);
    ctx.db.run("UPDATE jobs SET status = CASE WHEN status = 'enquiry' THEN 'quoted' ELSE status END, quote_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", job.id);
    const fresh = getJob(ctx.db, job.id);
    const c = jobContext(ctx.db, fresh);
    const message = String(b.message || '').trim() || `Hi {{first_name}},\n\nThanks for getting in touch. Here's your quote for {{job_title}}${fresh.shoot_date ? ' on {{shoot_date}}' : ''}.\n\nYou can review everything, ${fresh.contract_template_id ? 'sign the agreement ' : ''}and confirm your booking online.`;
    await sendJobEmail(ctx.db, fresh, { subject: merge(b.subject || 'Your quote for {{job_title}}', c), lines: merge(message, c).split(/\n{2,}/), button: { label: 'View quote and book', url: c.portal_link } });
    jobEvent(ctx.db, job.id, ctx.user.name, 'quote.sent', `to ${ctx.db.get('SELECT email FROM clients WHERE id = ?', job.client_id).email}`);
    return loadJob(ctx.db, job.id);
  });

  r.post('/api/studio/jobs/:id/contract', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    if (!job.contract_template_id) throw bad('Choose a contract template on the job first');
    if (ctx.db.get("SELECT 1 FROM contracts WHERE job_id = ? AND status = 'signed'", job.id)) throw bad('The contract is already signed');
    prepareContract(ctx.db, job, ctx.user);
    jobEvent(ctx.db, job.id, ctx.user.name, 'contract.prepared');
    return loadJob(ctx.db, job.id);
  });

  // Book without the client accepting online (phone/email booking).
  r.post('/api/studio/jobs/:id/book', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    if (!jobTotals(ctx.db, job.id).subtotal_cents) throw bad('Add packages or lines to the quote first');
    prepareContract(ctx.db, job, ctx.user);
    bookJob(ctx.db, job, { user: ctx.user });
    return loadJob(ctx.db, job.id);
  });

  r.post('/api/studio/jobs/:id/invoices', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const created = createPlanInvoices(ctx.db, job, ctx.user);
    if (!created.length) throw bad('This job already has invoices');
    return loadJob(ctx.db, job.id);
  });

  r.post('/api/studio/jobs/:id/email', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    if (!String(b.subject || '').trim() || !String(b.body || '').trim()) throw bad('Add a subject and a message');
    const c = jobContext(ctx.db, job);
    await sendJobEmail(ctx.db, job, { subject: merge(b.subject, c), lines: merge(b.body, c).split(/\n{2,}/), button: b.include_link === false ? null : { label: 'Open your booking page', url: c.portal_link } });
    jobEvent(ctx.db, job.id, ctx.user.name, 'email.sent', merge(b.subject, c));
    return { ok: true };
  });

  // workflow steps
  r.post('/api/studio/jobs/:id/steps', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    if (!String(b.name || '').trim()) throw bad('Name the task');
    if (b.due_date && !isDate(b.due_date)) throw bad('Date must be YYYY-MM-DD');
    ctx.db.run("INSERT INTO job_steps (job_id, name, action, due_date, sort) VALUES (?, ?, 'task', ?, 999)", job.id, str(b.name, 200), b.due_date || null);
    return loadJob(ctx.db, job.id);
  });
  r.patch('/api/studio/steps/:id', async (ctx) => {
    requireAgency(ctx);
    const st = ctx.db.get('SELECT * FROM job_steps WHERE id = ?', Number(ctx.params.id));
    if (!st) throw notFound();
    const b = await ctx.body();
    if (b.run && st.action === 'email' && st.status === 'pending') { runEmailStep(ctx.db, st); return loadJob(ctx.db, st.job_id); }
    if (b.status && !['pending', 'done', 'skipped'].includes(b.status)) throw bad('Invalid status');
    if (b.due_date && !isDate(b.due_date)) throw bad('Date must be YYYY-MM-DD');
    ctx.db.run('UPDATE job_steps SET status = ?, due_date = ?, done_at = ?, subject = ?, body = ? WHERE id = ?',
      b.status || st.status, 'due_date' in b ? b.due_date || null : st.due_date, b.status === 'done' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : b.status === 'pending' ? null : st.done_at,
      'subject' in b ? str(b.subject, 300) : st.subject, 'body' in b ? str(b.body, 20000) : st.body, st.id);
    if (b.status && b.status !== st.status) jobEvent(ctx.db, st.job_id, ctx.user.name, `step.${b.status}`, st.name);
    return loadJob(ctx.db, st.job_id);
  });

  // deliveries
  r.post('/api/studio/jobs/:id/deliveries', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    detectProvider(String(b.url || '').trim()); // validates the link
    await addDelivery(ctx.db, job, { url: b.url, label: str(b.label, 200), note: str(b.note, 1000), notify: !!b.notify, user: ctx.user });
    return loadJob(ctx.db, job.id);
  });
  r.delete('/api/studio/jobs/:id/deliveries/:did', async (ctx) => {
    requireAgency(ctx);
    const job = getJob(ctx.db, Number(ctx.params.id));
    ctx.db.run('DELETE FROM deliveries WHERE id = ? AND job_id = ?', Number(ctx.params.did), job.id);
    return loadJob(ctx.db, job.id);
  });

  // Email any invoice to the client with a no-login pay link (studio and web invoices).
  r.post('/api/invoices/:id/email', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    const kind = ['new', 'due', 'overdue'].includes(b.kind) ? b.kind : 'new';
    return sendInvoiceEmail(ctx.db, Number(ctx.params.id), { kind, user: ctx.user });
  });

  void HttpError; void slugify;
}
