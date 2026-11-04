// Public Studio endpoints: client booking page, invoice page, enquiry form. Token-based, no login.
import { HttpError, bad, notFound, html, rateLimiter, clientIp } from '../lib/http.js';
import { j, notify, logActivity, loadInvoice } from '../lib/services.js';
import { getSettings } from '../db.js';
import { getJob, bookJob, jobEvent, jobTotals, sha256, newToken, sendJobEmail, jobContext, merge } from '../lib/studio.js';
import { jobPage, invoicePage, enquiryPage } from '../lib/studio-pages.js';
import { stripeEnabled, createCheckout } from '../lib/stripe.js';
import { findOrCreateClient } from './studio.js';

const limit = rateLimiter({ windowMs: 10 * 60_000, max: 30 });
const enquiryLimit = rateLimiter({ windowMs: 60 * 60_000, max: 6 });
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;
const PAGE_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };

function jobByToken(db, token) {
  const job = TOKEN.test(token || '') && db.get('SELECT * FROM jobs WHERE token = ?', token);
  if (!job) throw notFound('This link is not valid. Check the latest email from us.');
  return job;
}
function invoiceByToken(db, token) {
  const row = TOKEN.test(token || '') && db.get('SELECT id FROM invoices WHERE public_token = ?', token);
  if (!row) throw notFound('This invoice link is not valid.');
  const inv = loadInvoice(db, row.id);
  if (inv.status === 'draft') throw notFound('This invoice has not been issued yet.');
  return inv;
}
const throttle = (ctx) => { if (!limit(clientIp(ctx.req))) throw new HttpError(429, 'Too many requests. Please wait a few minutes.'); };

export default function register(r) {
  // ----- pages -----
  r.get('/j/:token', async (ctx) => {
    const job = jobByToken(ctx.db, ctx.params.token);
    html(ctx.res, 200, jobPage(ctx.db, job, { baseUrl: ctx.baseUrl }), PAGE_HEADERS);
  });
  r.get('/i/:token', async (ctx) => {
    const inv = invoiceByToken(ctx.db, ctx.params.token);
    html(ctx.res, 200, invoicePage(ctx.db, inv, { paid: ctx.query.get('paid') === '1' }), PAGE_HEADERS);
  });
  r.get('/enquiry', async (ctx) => {
    ctx.res.removeHeader('X-Frame-Options'); // allowed to be embedded on kess.media in an iframe
    html(ctx.res, 200, enquiryPage(ctx.db, { embed: ctx.query.get('embed') === '1' }), { 'Cache-Control': 'no-store' });
  });

  // ----- booking page actions -----
  r.post('/api/public/jobs/:token/accept', async (ctx) => {
    throttle(ctx);
    const job = jobByToken(ctx.db, ctx.params.token);
    if (!['enquiry', 'quoted'].includes(job.status)) throw bad(job.status === 'lost' ? 'This quote has closed. Please get in touch.' : 'This booking is already confirmed.');
    const b = await ctx.body(600_000);
    const lines = ctx.db.all('SELECT id, optional FROM job_lines WHERE job_id = ?', job.id);
    const selected = new Set((Array.isArray(b.selected) ? b.selected : []).map(Number));
    const contract = ctx.db.get("SELECT * FROM contracts WHERE job_id = ? AND status != 'void' ORDER BY id DESC LIMIT 1", job.id);
    if (contract && contract.status !== 'signed') {
      const name = String(b.signed_name || '').trim();
      if (name.length < 2) throw bad('Add your full name to sign the agreement');
      if (!b.agree) throw bad('Please tick the box to agree to the agreement');
      const sig = String(b.signature || '');
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length < 200) throw bad('Please sign in the box');
      if (sig.length > 500_000) throw bad('Signature image is too large');
      if (sha256(contract.body) !== contract.body_hash) throw new HttpError(409, 'The agreement changed. Please reload the page.');
    }
    ctx.db.tx(() => {
      for (const l of lines) if (l.optional) ctx.db.run('UPDATE job_lines SET selected = ? WHERE id = ?', selected.has(l.id) ? 1 : 0, l.id);
      if (!jobTotals(ctx.db, job.id).subtotal_cents) throw bad('The quote is empty. Please get in touch.');
      if (contract && contract.status !== 'signed') {
        ctx.db.run("UPDATE contracts SET status = 'signed', signed_name = ?, signature = ?, signed_at = datetime('now'), signed_ip = ?, signed_ua = ? WHERE id = ?",
          String(b.signed_name).trim().slice(0, 120), String(b.signature), clientIp(ctx.req), String(ctx.req.headers['user-agent'] || '').slice(0, 300), contract.id);
        jobEvent(ctx.db, job.id, String(b.signed_name).trim(), 'contract.signed', `IP ${clientIp(ctx.req)} · document ${contract.body_hash.slice(0, 12)}`);
      }
    });
    const client = ctx.db.get('SELECT name FROM clients WHERE id = ?', job.client_id);
    bookJob(ctx.db, getJob(ctx.db, job.id), { by: String(b.signed_name || client.name) });
    const first = ctx.db.get("SELECT public_token FROM invoices WHERE job_id = ? AND status = 'sent' ORDER BY id LIMIT 1", job.id);
    return { ok: true, pay_url: first ? `/i/${first.public_token}` : `/j/${job.token}` };
  });

  r.post('/api/public/jobs/:token/questionnaire', async (ctx) => {
    throttle(ctx);
    const job = jobByToken(ctx.db, ctx.params.token);
    const resp = ctx.db.get('SELECT * FROM questionnaire_responses WHERE job_id = ? ORDER BY id DESC LIMIT 1', job.id);
    if (!resp) throw notFound('There is no questionnaire for this booking');
    const b = await ctx.body(100_000);
    const qs = j(resp.questions, {}).questions || [];
    const answers = {};
    for (const q of qs) {
      const v = b.answers?.[q.id];
      answers[q.id] = q.type === 'checkbox' ? v === true || v === 'true' : String(v ?? '').slice(0, 5000);
      if (b.submit && q.required && !answers[q.id]) throw bad(`Please answer: ${q.label}`);
    }
    const firstSubmit = b.submit && !resp.submitted_at;
    ctx.db.run(`UPDATE questionnaire_responses SET answers = ?, updated_at = datetime('now')${b.submit ? ", submitted_at = COALESCE(submitted_at, datetime('now'))" : ''} WHERE id = ?`, JSON.stringify(answers), resp.id);
    if (firstSubmit) {
      jobEvent(ctx.db, job.id, 'Client', 'questionnaire.submitted');
      notify(ctx.db, { audience: 'agency', client_id: job.client_id, title: `Questionnaire answered: ${job.title}`, link: `#/studio/jobs/${job.id}` });
    }
    return { ok: true };
  });

  r.post('/api/public/invoices/:token/pay', async (ctx) => {
    throttle(ctx);
    const inv = invoiceByToken(ctx.db, ctx.params.token);
    if (!stripeEnabled()) throw bad('Card payments are not set up. Please pay by bank transfer.');
    if (inv.status !== 'sent') throw bad(inv.status === 'paid' ? 'This invoice is already paid' : 'This invoice cannot be paid');
    const session = await createCheckout(inv, { successUrl: `${ctx.baseUrl}/i/${inv.public_token}?paid=1`, cancelUrl: `${ctx.baseUrl}/i/${inv.public_token}`, agencyName: getSettings(ctx.db).agency_name })
      .catch((e) => { throw new HttpError(502, `Could not start payment: ${e.message}`); });
    ctx.db.run('UPDATE invoices SET stripe_session_id = ? WHERE id = ?', session.id, inv.id);
    return { url: session.url };
  });

  // ----- enquiry form -----
  r.post('/api/public/enquiry', async (ctx) => {
    for (const [k, v] of Object.entries({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' })) ctx.setHeader(k, v);
    if (!enquiryLimit(clientIp(ctx.req))) throw new HttpError(429, 'Too many enquiries from here. Please email us instead.');
    const b = await ctx.body(30_000);
    if (b._hp) return { ok: true };
    const name = String(b.name || '').trim().slice(0, 100);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    if (!name) throw bad('Please add your name');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw bad('Please check your email address');
    if (!String(b.message || '').trim()) throw bad('Tell us a little about the shoot');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : null;
    const category = ['photo', 'video', 'photo_video'].includes(b.category) ? b.category : 'photo';
    const org = String(b.organisation || '').trim().slice(0, 120);
    const s = getSettings(ctx.db);
    const owner = ctx.db.get('SELECT id FROM users WHERE id = ?', Number(s.studio_owner_id) || 0) || ctx.db.get("SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1");
    const clientId = findOrCreateClient(ctx.db, { name: org || name, contact_name: name, email, phone: String(b.phone || '').slice(0, 40) });
    const pkg = String(b.package || '').slice(0, 120);
    const title = `${category === 'video' ? 'Video' : category === 'photo_video' ? 'Photo + video' : 'Photography'}${pkg ? `: ${pkg}` : ''} for ${org || name}`;
    const notes = `Enquiry from the website\n\n${String(b.message).slice(0, 5000)}${pkg ? `\n\nInterested in: ${pkg}` : ''}${b.phone ? `\nPhone: ${String(b.phone).slice(0, 40)}` : ''}`;
    const { id } = ctx.db.run("INSERT INTO jobs (client_id, title, category, status, shoot_date, location, notes, source, owner_id, token) VALUES (?, ?, ?, 'enquiry', ?, ?, ?, 'website', ?, ?)",
      clientId, title.slice(0, 200), category, date, String(b.location || '').slice(0, 200), notes, owner?.id ?? null, newToken());
    jobEvent(ctx.db, id, name, 'enquiry.received', 'Website form');
    notify(ctx.db, { audience: 'agency', client_id: clientId, title: `New shoot enquiry from ${name}`, body: `${title}${date ? ` · ${date}` : ''}`, link: `#/studio/jobs/${id}` });
    logActivity(ctx.db, { client_id: clientId, action: 'enquiry.received', detail: title });
    // Friendly auto-reply from the job owner.
    try {
      const job = getJob(ctx.db, id);
      const c = jobContext(ctx.db, job);
      sendJobEmail(ctx.db, job, { subject: merge('Thanks for your enquiry, {{first_name}}', c), lines: [`Hi ${c.first_name},`, `Thanks for getting in touch about ${pkg || 'your shoot'}${date ? ` on ${c.shoot_date}` : ''}. We'll reply within one business day with availability and a quote.`] });
    } catch {}
    return { ok: true };
  });
}
