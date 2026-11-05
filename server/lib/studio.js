// Studio: photo + video jobs. Quotes from packages, contracts with e-signature,
// payment plans that become scheduled invoices, workflows relative to the shoot date,
// questionnaires, deliveries via external providers, and a token-based client page.
import { randomBytes, createHash } from 'node:crypto';
import { getSettings } from '../db.js';
import { HttpError, bad, notFound } from './http.js';
import { j, logActivity, notify, nextInvoiceNumber, addDays, loadInvoice, invoiceTotals, gstRate, money } from './services.js';
import { sendMail, senderFor, appUrl } from './mail.js';
import { xeroSoon } from './xero.js';

export const JOB_STATUSES = ['enquiry', 'quoted', 'booked', 'shot', 'editing', 'delivered', 'complete', 'lost'];
export const CATEGORIES = ['photo', 'video', 'photo_video'];
export const newToken = () => randomBytes(24).toString('base64url');
export const today = () => new Date().toISOString().slice(0, 10);
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const ddmmyyyy = (d) => (d ? d.split('-').reverse().join('/') : 'TBC');

export function jobEvent(db, jobId, who, action, detail = '') {
  db.run('INSERT INTO job_events (job_id, who, action, detail) VALUES (?, ?, ?, ?)', jobId, who || 'System', action, detail);
}

export function getJob(db, id) {
  const job = db.get('SELECT * FROM jobs WHERE id = ?', id);
  if (!job) throw notFound('Job not found');
  return job;
}

export function jobLines(db, jobId) {
  return db.all('SELECT * FROM job_lines WHERE job_id = ? ORDER BY sort, id', jobId).map((l) => ({ ...l, optional: !!l.optional, selected: !!l.selected }));
}

export function jobTotals(db, jobId) {
  const lines = jobLines(db, jobId).filter((l) => !l.optional || l.selected);
  const t = invoiceTotals(lines, gstRate(db));
  return { ...t, lines: lines.length };
}

export function jobContext(db, job) {
  const s = getSettings(db);
  const client = db.get('SELECT * FROM clients WHERE id = ?', job.client_id) || {};
  const owner = job.owner_id ? db.get('SELECT * FROM users WHERE id = ?', job.owner_id) : null;
  const t = jobTotals(db, job.id);
  const plan = job.payment_plan_id ? db.get('SELECT * FROM payment_plans WHERE id = ?', job.payment_plan_id) : null;
  const first = plan ? j(plan.steps, [])[0] : null;
  const deposit = first ? Math.round((first.percent ? t.subtotal_cents * first.percent / 100 : first.amount_cents || 0) * (1 + gstRate(db))) : 0;
  const pkgs = jobLines(db, job.id).filter((l) => !l.optional || l.selected).map((l) => l.description).join(', ');
  const contact = client.contact_name || client.name || '';
  return {
    client_name: client.name || '', contact_name: contact, first_name: contact.split(' ')[0] || 'there',
    job_title: job.title, shoot_date: ddmmyyyy(job.shoot_date), shoot_time: job.start_time ? `${job.start_time}${job.end_time ? `–${job.end_time}` : ''}` : 'TBC',
    location: job.location || 'TBC', total: money(t.total_cents), total_ex_gst: money(t.subtotal_cents), deposit: money(deposit),
    package: pkgs || job.title, business_name: s.agency_name, business_abn: s.agency_abn || '', business_email: s.agency_email,
    owner_name: owner?.send_as_name || owner?.name || s.agency_name, today: ddmmyyyy(today()),
    portal_link: `${appUrl(db)}/j/${job.token}`,
  };
}

// {{field}} merge; unknown fields are left untouched so mistakes are visible.
export const merge = (text, ctx) => String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in ctx ? String(ctx[k]) : m));

// Send an email to the job's client, from the job owner (e.g. Georgia), replies to the owner.
export function sendJobEmail(db, job, { subject, heading, lines = [], button, includeSignature = true }) {
  const client = db.get('SELECT * FROM clients WHERE id = ?', job.client_id);
  if (!client?.email) throw bad(`${client?.name || 'This client'} has no email address. Add one on the client first.`);
  const owner = job.owner_id ? db.get('SELECT * FROM users WHERE id = ?', job.owner_id) : null;
  const sender = senderFor(db, owner);
  const s = getSettings(db);
  return sendMail(db, {
    to: client.email, subject, heading: heading || subject,
    lines: [...lines, includeSignature ? sender.signature : null].filter(Boolean), button,
    from: sender.from, replyTo: sender.replyTo,
    footer: `${s.agency_name}${s.agency_abn ? ` · ABN ${s.agency_abn}` : ''} · ${s.agency_email}`,
  });
}

// ---------- payment plans ----------
// step: { label, percent | amount_cents, when: 'accept'|'before_shoot'|'after_shoot'|'date', days, date, due_days }
export function planSchedule(steps, job, subtotalCents, todayStr = today()) {
  if (!steps?.length) return [];
  let remaining = subtotalCents;
  return steps.map((st, i) => {
    const last = i === steps.length - 1;
    let cents = last ? remaining : st.percent ? Math.round(subtotalCents * Number(st.percent) / 100) : Math.round(Number(st.amount_cents) || 0);
    cents = Math.max(0, Math.min(cents, remaining));
    remaining -= cents;
    let sendOn = todayStr;
    const days = Number(st.days) || 0;
    if (st.when === 'before_shoot' && job.shoot_date) sendOn = addDays(job.shoot_date, -days);
    else if (st.when === 'after_shoot' && job.shoot_date) sendOn = addDays(job.shoot_date, days);
    else if (st.when === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(st.date || '')) sendOn = st.date;
    if (sendOn < todayStr) sendOn = todayStr;
    const dueDays = st.due_days === undefined || st.due_days === '' ? 7 : Number(st.due_days);
    let due = addDays(sendOn, dueDays);
    if (st.when === 'before_shoot' && job.shoot_date && due > job.shoot_date) due = job.shoot_date > sendOn ? job.shoot_date : sendOn;
    return { label: st.label || `Payment ${i + 1}`, cents, send_on: sendOn, due_date: due };
  }).filter((x) => x.cents > 0);
}

export function createPlanInvoices(db, job, user) {
  if (db.get("SELECT 1 FROM invoices WHERE job_id = ? AND status != 'void'", job.id)) return [];
  const t = jobTotals(db, job.id);
  if (!t.subtotal_cents) throw bad('The quote is empty, so there is nothing to invoice');
  const plan = job.payment_plan_id ? db.get('SELECT * FROM payment_plans WHERE id = ?', job.payment_plan_id) : null;
  const steps = plan ? j(plan.steps, []) : [{ label: 'Full payment', percent: 100, when: 'accept', due_days: Number(getSettings(db).studio_terms_days || 7) }];
  const schedule = planSchedule(steps, job, t.subtotal_cents);
  const created = [];
  db.tx(() => {
    for (const p of schedule) {
      const number = nextInvoiceNumber(db);
      const { id } = db.run(`INSERT INTO invoices (client_id, number, issue_date, due_date, status, notes, job_id, owner_id, send_on, public_token, plan_label)
        VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`, job.client_id, number, p.send_on, p.due_date, `${job.title} · ${p.label}`, job.id, job.owner_id, p.send_on, newToken(), p.label);
      db.run('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents) VALUES (?, ?, 1, ?)', id, `${p.label}: ${job.title}${job.shoot_date ? ` (${ddmmyyyy(job.shoot_date)})` : ''}`, p.cents);
      created.push({ id, number, ...p });
    }
  });
  jobEvent(db, job.id, user?.name, 'invoices.scheduled', created.map((c) => `${c.number} ${money(Math.round(c.cents * (1 + gstRate(db))))} on ${ddmmyyyy(c.send_on)}`).join('; '));
  return created;
}

// Email an invoice with a no-login payment link. Drafts become "sent".
export function sendInvoiceEmail(db, invoiceId, { kind = 'new', user = null } = {}) {
  let inv = loadInvoice(db, invoiceId);
  if (inv.status === 'void' || inv.status === 'paid') throw bad(`This invoice is ${inv.status}`);
  if (!inv.public_token) { db.run('UPDATE invoices SET public_token = ? WHERE id = ?', newToken(), inv.id); inv = loadInvoice(db, invoiceId); }
  if (!inv.client_email) throw bad(`${inv.client_name} has no email address. Add one on the client first.`);
  if (inv.status === 'draft') {
    const t = today();
    db.run("UPDATE invoices SET status = 'sent', sent_at = datetime('now'), issue_date = ?, due_date = CASE WHEN due_date < ? THEN ? ELSE due_date END WHERE id = ?", t, t, t, inv.id);
    inv = loadInvoice(db, invoiceId);
  }
  const owner = db.get('SELECT * FROM users WHERE id = ?', inv.owner_id || user?.id || 0) || user;
  const sender = senderFor(db, owner);
  const s = getSettings(db);
  const first = (inv.contact_name || inv.client_name).split(' ')[0];
  const amount = money(inv.total_cents);
  const subject = kind === 'overdue' ? `Reminder: invoice ${inv.number} is overdue` : kind === 'due' ? `Invoice ${inv.number} is due ${ddmmyyyy(inv.due_date)}` : `Invoice ${inv.number} from ${s.agency_name}`;
  const lines = kind === 'overdue'
    ? [`Hi ${first},`, `Just a friendly reminder that invoice ${inv.number} for ${amount} (inc GST) was due on ${ddmmyyyy(inv.due_date)}. If you've already paid, thank you, and please ignore this.`]
    : kind === 'due'
      ? [`Hi ${first},`, `A quick heads-up that invoice ${inv.number} for ${amount} (inc GST) is due on ${ddmmyyyy(inv.due_date)}.`]
      : [`Hi ${first},`, `Here's invoice ${inv.number} for ${amount} (inc GST)${inv.notes ? `: ${inv.notes}` : ''}. It's due on ${ddmmyyyy(inv.due_date)}.`, 'You can pay online or by bank transfer from the link below.'];
  sendMail(db, { to: inv.client_email, subject, heading: subject, lines: [...lines, sender.signature], button: { label: 'View and pay invoice', url: `${appUrl(db)}/i/${inv.public_token}` },
    from: sender.from, replyTo: sender.replyTo, footer: `${s.agency_name}${s.agency_abn ? ` · ABN ${s.agency_abn}` : ''} · ${s.agency_email}` });
  if (kind === 'new') xeroSoon(db, inv.id);
  if (kind === 'overdue') db.run('UPDATE invoices SET reminded_at = ? WHERE id = ?', today(), inv.id);
  if (kind === 'due') db.run('UPDATE invoices SET due_reminded_at = ? WHERE id = ?', today(), inv.id);
  if (inv.job_id) jobEvent(db, inv.job_id, owner?.name, `invoice.${kind === 'new' ? 'sent' : kind + '_reminder'}`, `${inv.number} ${amount} to ${inv.client_email}`);
  logActivity(db, { user, client_id: inv.client_id, action: kind === 'new' ? 'invoice.emailed' : 'invoice.reminded', detail: `${inv.number} to ${inv.client_email}` });
  return loadInvoice(db, invoiceId);
}

// ---------- workflows ----------
// step: { name, action: 'email'|'task', anchor: 'booking'|'shoot', offset_days, subject, body, attach: 'questionnaire'|'portal'|'' }
export function instantiateWorkflow(db, job) {
  if (!job.workflow_id || db.get('SELECT 1 FROM job_steps WHERE job_id = ?', job.id)) return 0;
  const wf = db.get('SELECT * FROM workflows WHERE id = ?', job.workflow_id);
  if (!wf) return 0;
  const steps = j(wf.steps, []);
  const booked = (job.booked_at || today()).slice(0, 10);
  steps.forEach((st, i) => {
    const base = st.anchor === 'shoot' ? job.shoot_date : booked;
    const due = base ? addDays(base, Number(st.offset_days) || 0) : null;
    db.run('INSERT INTO job_steps (job_id, name, action, due_date, subject, body, attach, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      job.id, st.name || `Step ${i + 1}`, st.action === 'email' ? 'email' : 'task', due, st.subject || '', st.body || '', st.attach || '', i);
  });
  return steps.length;
}

export function runEmailStep(db, step) {
  const job = getJob(db, step.job_id);
  const ctx = jobContext(db, job);
  const button = step.attach === 'questionnaire' ? { label: 'Fill in the questionnaire', url: `${ctx.portal_link}#questionnaire` }
    : step.attach === 'portal' || !step.attach ? { label: 'Open your booking page', url: ctx.portal_link } : null;
  sendJobEmail(db, job, { subject: merge(step.subject || step.name, ctx), lines: merge(step.body, ctx).split(/\n{2,}/), button });
  db.run("UPDATE job_steps SET status = 'done', done_at = datetime('now') WHERE id = ?", step.id);
  jobEvent(db, job.id, 'Workflow', 'email.sent', step.subject || step.name);
}

// ---------- booking ----------
export function bookJob(db, job, { user = null, by = null } = {}) {
  if (['booked', 'shot', 'editing', 'delivered', 'complete'].includes(job.status)) return { already: true };
  db.run("UPDATE jobs SET status = 'booked', booked_at = datetime('now'), accepted_at = COALESCE(accepted_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", job.id);
  const fresh = getJob(db, job.id);
  const invoices = createPlanInvoices(db, fresh, user);
  if (fresh.questionnaire_id && !db.get('SELECT 1 FROM questionnaire_responses WHERE job_id = ?', job.id)) {
    const q = db.get('SELECT * FROM questionnaires WHERE id = ?', fresh.questionnaire_id);
    if (q) db.run('INSERT INTO questionnaire_responses (job_id, questionnaire_id, questions) VALUES (?, ?, ?)', job.id, q.id, JSON.stringify({ name: q.name, intro: q.intro, questions: j(q.questions, []) }));
  }
  instantiateWorkflow(db, fresh);
  // Send anything due today: the deposit invoice and any "on booking" emails.
  for (const inv of db.all("SELECT id FROM invoices WHERE job_id = ? AND status = 'draft' AND send_on <= ?", job.id, today())) {
    try { sendInvoiceEmail(db, inv.id, { user }); } catch {}
  }
  for (const st of db.all("SELECT * FROM job_steps WHERE job_id = ? AND action = 'email' AND status = 'pending' AND due_date <= ?", job.id, today())) {
    try { runEmailStep(db, st); } catch {}
  }
  jobEvent(db, job.id, by || user?.name, 'job.booked', by ? 'Accepted online by the client' : 'Marked as booked');
  const client = db.get('SELECT name FROM clients WHERE id = ?', job.client_id);
  notify(db, { audience: 'agency', client_id: job.client_id, title: `${client.name} booked: ${job.title}`, body: `${ddmmyyyy(job.shoot_date)}${job.location ? ` · ${job.location}` : ''}`, link: `#/studio/jobs/${job.id}` });
  logActivity(db, { user, client_id: job.client_id, action: 'job.booked', detail: job.title });
  return { invoices };
}

// ---------- deliveries (external providers) ----------
const PROVIDERS = [
  ['dropbox', /(^|\.)dropbox\.com$/], ['google_drive', /(^|\.)(drive|docs)\.google\.com$/], ['picflow', /(^|\.)picflow\.(com|io)$/],
  ['vimeo', /(^|\.)vimeo\.com$/], ['frameio', /(^|\.)(frame\.io|f\.io)$/], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['pictime', /(^|\.)pic-time\.com$/], ['pixieset', /(^|\.)pixieset\.com$/], ['wetransfer', /(^|\.)(wetransfer\.com|we\.tl)$/],
  ['onedrive', /(^|\.)(onedrive\.live\.com|1drv\.ms|sharepoint\.com)$/], ['smugmug', /(^|\.)smugmug\.com$/],
];
export const PROVIDER_LABELS = { dropbox: 'Dropbox', google_drive: 'Google Drive', picflow: 'Picflow', vimeo: 'Vimeo', frameio: 'Frame.io', youtube: 'YouTube', pictime: 'Pic-Time', pixieset: 'Pixieset', wetransfer: 'WeTransfer', onedrive: 'OneDrive', smugmug: 'SmugMug', link: 'Link' };

export function detectProvider(url) {
  let u;
  try { u = new URL(url); } catch { throw bad('That does not look like a web link'); }
  if (u.protocol !== 'https:') throw bad('Use an https:// link');
  const host = u.hostname.toLowerCase();
  const hit = PROVIDERS.find(([, re]) => re.test(host));
  return hit ? hit[0] : 'link';
}

// Safe embed URL for video providers, else null.
export function embedUrl(url) {
  let u; try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'vimeo.com') { const m = u.pathname.match(/^\/(\d+)(?:\/([a-f0-9]+))?/); if (m) return `https://player.vimeo.com/video/${m[1]}${m[2] ? `?h=${m[2]}` : ''}`; }
  if (host === 'player.vimeo.com') return url;
  if (host === 'youtu.be') { const id = u.pathname.slice(1).split('/')[0]; if (/^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`; }
  if (host === 'youtube.com' || host === 'm.youtube.com') { const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/) || [])[1]; if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}`; }
  return null;
}

// Add a delivery link to a job; optionally email the client and mark the job delivered.
export async function addDelivery(db, job, { url, label = '', note = '', notify: tell = false, user = null, provider }) {
  const clean = String(url || '').trim();
  const prov = provider || detectProvider(clean);
  db.run('INSERT INTO deliveries (job_id, provider, url, label, note, created_by) VALUES (?, ?, ?, ?, ?, ?)', job.id, prov, clean.slice(0, 2000), String(label || '').slice(0, 200), String(note || '').slice(0, 1000), user?.id ?? null);
  jobEvent(db, job.id, user?.name, 'delivery.added', `${label || prov}`);
  if (tell) {
    const c = jobContext(db, job);
    await sendJobEmail(db, job, { subject: merge('Your {{job_title}} files are ready', c), lines: [`Hi ${c.first_name},`, `${label || 'Your files'} ${label ? 'is' : 'are'} ready.${note ? ` ${note}` : ''}`, 'Everything is on your booking page.'], button: { label: 'View your files', url: `${c.portal_link}#files` } });
    if (['booked', 'shot', 'editing'].includes(job.status)) db.run("UPDATE jobs SET status = 'delivered', updated_at = datetime('now') WHERE id = ?", job.id);
  }
}

// ---------- full job for the console ----------
export function loadJob(db, id) {
  const job = getJob(db, id);
  const client = db.get('SELECT id, name, contact_name, email, phone, address FROM clients WHERE id = ?', job.client_id);
  const owner = job.owner_id ? db.get('SELECT id, name, email, send_as_email FROM users WHERE id = ?', job.owner_id) : null;
  const invoices = db.all('SELECT id FROM invoices WHERE job_id = ? ORDER BY COALESCE(send_on, issue_date), id', id).map((r) => { const inv = loadInvoice(db, r.id); delete inv.items; return inv; });
  const contract = db.get('SELECT id, title, body, status, agency_signer, signed_name, signed_at, signed_ip, created_at, signature IS NOT NULL has_signature FROM contracts WHERE job_id = ? ORDER BY id DESC LIMIT 1', id);
  const response = db.get('SELECT * FROM questionnaire_responses WHERE job_id = ? ORDER BY id DESC LIMIT 1', id);
  return {
    ...job, client, owner, lines: jobLines(db, id), totals: jobTotals(db, id), invoices, contract: contract || null,
    steps: db.all('SELECT * FROM job_steps WHERE job_id = ? ORDER BY due_date IS NULL, due_date, sort', id),
    questionnaire: response ? { ...response, questions: j(response.questions, {}), answers: j(response.answers, {}) } : null,
    deliveries: db.all('SELECT * FROM deliveries WHERE job_id = ? ORDER BY id DESC', id).map((d) => ({ ...d, provider_label: PROVIDER_LABELS[d.provider] || 'Link', embed: embedUrl(d.url) })),
    events: db.all('SELECT * FROM job_events WHERE job_id = ? ORDER BY id DESC LIMIT 100', id),
    portal_url: `${appUrl(db)}/j/${job.token}`,
  };
}

export function assertSendable(db, job) {
  const client = db.get('SELECT email FROM clients WHERE id = ?', job.client_id);
  if (!client?.email) throw new HttpError(400, 'Add the client’s email address before sending');
}
