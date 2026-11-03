import { getSettings } from '../db.js';
import { HttpError, notFound } from './http.js';
import { sendMail, appUrl } from './mail.js';

export const j = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

export function logActivity(db, { user, client_id = null, site_id = null, action, detail = '' }) {
  db.run('INSERT INTO activity (user_id, client_id, site_id, action, detail) VALUES (?, ?, ?, ?, ?)', user?.id ?? null, client_id, site_id, action, detail);
}

// Notify: audience 'agency' (all owner/staff) or 'client' (all users of a client).
export function notify(db, { audience, client_id = null, title, body = '', link = '', email = true }) {
  const users = audience === 'agency'
    ? db.all("SELECT id, email, name, email_notify, password_hash IS NOT NULL active FROM users WHERE role IN ('owner','staff')")
    : db.all("SELECT id, email, name, email_notify, password_hash IS NOT NULL active FROM users WHERE role = 'client' AND client_id = ?", client_id);
  const url = link ? `${appUrl(db)}/${link.startsWith('#') ? link : '#' + link}` : appUrl(db);
  for (const u of users) {
    db.run('INSERT INTO notifications (user_id, audience, client_id, title, body, link) VALUES (?, ?, ?, ?, ?, ?)', u.id, audience, client_id, title, body, link);
    if (email && u.email_notify && u.active) sendMail(db, { to: u.email, subject: title, heading: title, lines: [`Hi ${u.name.split(' ')[0]},`, body], button: { label: 'Open in Kess Cloud', url } });
  }
  const hook = getSettings(db).webhook_url;
  if (hook && audience === 'agency' && /^https:\/\//.test(hook)) {
    // Slack-compatible payload; also fine for Make/Zapier/n8n.
    fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${title}*${body ? `\n${body}` : ''}`, title, body, link }), signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
}

export function getSite(db, id) {
  const s = db.get('SELECT * FROM sites WHERE id = ?', id);
  if (!s) throw notFound('Site not found');
  return hydrateSite(s);
}
export function hydrateSite(s) {
  return { ...s, theme: j(s.theme, {}), settings: j(s.settings, {}), client_can_edit: !!s.client_can_edit };
}
export function hydratePage(p) {
  return { ...p, sections: j(p.sections, []), in_nav: !!p.in_nav };
}

export function buildSnapshot(db, siteId) {
  const site = getSite(db, siteId);
  const pages = db.all('SELECT * FROM pages WHERE site_id = ? ORDER BY sort, id', siteId).map(hydratePage);
  return {
    site: { name: site.name, slug: site.slug, domain: site.domain, settings: site.settings },
    theme: site.theme,
    pages: pages.map((p) => ({ slug: p.slug, title: p.title, navLabel: p.nav_label, description: p.description, inNav: p.in_nav, sections: p.sections })),
  };
}

export function createVersion(db, { siteId, user, note, status }) {
  const snap = buildSnapshot(db, siteId);
  if (!snap.pages.some((p) => p.slug === '')) throw new HttpError(400, 'The site needs a home page (empty slug) before it can be versioned');
  const n = (db.get('SELECT MAX(number) n FROM versions WHERE site_id = ?', siteId)?.n || 0) + 1;
  const { id } = db.run('INSERT INTO versions (site_id, number, snapshot, note, status, created_by) VALUES (?, ?, ?, ?, ?, ?)', siteId, n, JSON.stringify(snap), note || '', status, user?.id ?? null);
  return { id, number: n };
}

export function publishVersion(db, { siteId, versionId, user, target = 'kess-hosting' }) {
  const v = db.get('SELECT * FROM versions WHERE id = ? AND site_id = ?', versionId, siteId);
  if (!v) throw notFound('Version not found');
  return db.tx(() => {
    db.run("UPDATE versions SET status = 'superseded' WHERE site_id = ? AND status = 'published' AND id != ?", siteId, versionId);
    db.run("UPDATE versions SET status = 'published', published_at = datetime('now') WHERE id = ?", versionId);
    db.run("UPDATE sites SET published_version_id = ?, updated_at = datetime('now') WHERE id = ?", versionId, siteId);
    const site = db.get('SELECT stage FROM sites WHERE id = ?', siteId);
    if (['design', 'build', 'review'].includes(site.stage)) db.run("UPDATE sites SET stage = 'live', launch_date = COALESCE(launch_date, date('now')) WHERE id = ?", siteId);
    const snap = j(v.snapshot, { pages: [] });
    const log = [`Version v${v.number} published to ${target}`, `${snap.pages.length} page(s): ${snap.pages.map((p) => '/' + p.slug).join(', ')}`].join('\n');
    db.run("INSERT INTO deploys (site_id, version_id, target, status, log, created_by) VALUES (?, ?, ?, 'success', ?, ?)", siteId, versionId, target, log, user?.id ?? null);
    return { ok: true, version: v.number };
  });
}

// ---------- money ----------
export const gstRate = (db) => Number(getSettings(db).gst_rate || 0.1);

export function invoiceTotals(items, rate) {
  const subtotal = items.reduce((n, i) => n + Math.round(Number(i.qty) * Number(i.unit_cents)), 0);
  const gst = Math.round(subtotal * rate);
  return { subtotal_cents: subtotal, gst_cents: gst, total_cents: subtotal + gst };
}

export function nextInvoiceNumber(db) {
  const prefix = getSettings(db).invoice_prefix || 'INV-';
  const rows = db.all('SELECT number FROM invoices WHERE number LIKE ?', prefix + '%');
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 1000);
  return `${prefix}${max + 1}`;
}

export function loadInvoice(db, id) {
  const inv = db.get('SELECT i.*, c.name client_name, c.email client_email, c.abn client_abn, c.address client_address, c.contact_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = ?', id);
  if (!inv) throw notFound('Invoice not found');
  const items = db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', id);
  const rate = gstRate(db);
  const totals = invoiceTotals(items, rate);
  const overdue = inv.status === 'sent' && inv.due_date < new Date().toISOString().slice(0, 10);
  return { ...inv, items, ...totals, gst_rate: rate, overdue };
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// Create monthly care-plan invoices for every live site with a plan, one per client per period.
export function generateCareInvoices(db, { period, user }) {
  if (!/^\d{4}-\d{2}$/.test(period || '')) throw new HttpError(400, 'Period must be YYYY-MM');
  const terms = Number(getSettings(db).payment_terms_days || 14);
  const sites = db.all(`SELECT s.id, s.name, s.client_id, p.name plan_name, p.price_cents FROM sites s JOIN plans p ON p.id = s.plan_id
    WHERE s.stage IN ('live','care') ORDER BY s.client_id`);
  const byClient = new Map();
  for (const s of sites) { if (!byClient.has(s.client_id)) byClient.set(s.client_id, []); byClient.get(s.client_id).push(s); }
  const created = [];
  const today = new Date().toISOString().slice(0, 10);
  db.tx(() => {
    for (const [clientId, list] of byClient) {
      const exists = db.get("SELECT id FROM invoices WHERE client_id = ? AND period = ? AND status != 'void'", clientId, period);
      if (exists) continue;
      const number = nextInvoiceNumber(db);
      const { id } = db.run("INSERT INTO invoices (client_id, number, issue_date, due_date, status, period, notes) VALUES (?, ?, ?, ?, 'draft', ?, ?)", clientId, number, today, addDays(today, terms), period, `Hosting and care, ${period}`);
      for (const s of list) db.run('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, site_id) VALUES (?, ?, 1, ?, ?)', id, `${s.plan_name} care plan: ${s.name} (${period})`, s.price_cents, s.id);
      // Approved billable request quotes completed in that month
      const reqs = db.all("SELECT id, title, quote_cents FROM requests WHERE client_id = ? AND billable = 1 AND status = 'done' AND quote_cents > 0 AND quote_status = 'approved' AND substr(updated_at, 1, 7) = ? AND id NOT IN (SELECT request_id FROM invoice_items WHERE request_id IS NOT NULL)", clientId, period);
      for (const r of reqs) db.run('INSERT INTO invoice_items (invoice_id, description, qty, unit_cents, request_id) VALUES (?, ?, 1, ?, ?)', id, `Change request #${r.id}: ${r.title}`, r.quote_cents, r.id);
      created.push({ id, number, client_id: clientId });
      logActivity(db, { user, client_id: clientId, action: 'invoice.generated', detail: `${number} for ${period}` });
    }
  });
  return created;
}

// ---------- estimates (proposal ballparks) ----------
// Internal: hours x rate. Client-facing: rounded ranges, ex GST, never the rate.
export function roundOut(cents, dir) {
  const dollars = cents / 100;
  const step = dollars >= 10000 ? 1000 : dollars >= 2000 ? 500 : 100;
  const v = dir === 'down' ? Math.floor(dollars / step) * step : Math.ceil(dollars / step) * step;
  return v * 100;
}

export function computeEstimate(data, rateCents) {
  const rate = Number(data.rate_cents || rateCents);
  const discount = Math.min(Math.max(Number(data.discount_pct || 0), 0), 90) / 100;
  const groups = (data.groups || []).map((g) => {
    const items = (g.items || []).map((i) => {
      const lo = Math.round(Number(i.hours_low || 0) * rate * (1 - discount));
      const hi = Math.round(Number(i.hours_high || i.hours_low || 0) * rate * (1 - discount));
      const fixed = Number(i.fixed_cents || 0);
      return { name: i.name, note: i.note || '', kind: i.kind || 'core', hours_low: Number(i.hours_low || 0), hours_high: Number(i.hours_high || i.hours_low || 0), fixed_cents: fixed,
        low_cents: roundOut(lo + fixed, 'down'), high_cents: roundOut(hi + fixed, 'up') };
    });
    const core = items.filter((i) => i.kind !== 'addon');
    return { name: g.name, items,
      low_cents: core.reduce((n, i) => n + i.low_cents, 0), high_cents: core.reduce((n, i) => n + i.high_cents, 0) };
  });
  const low = groups.reduce((n, g) => n + g.low_cents, 0);
  const high = groups.reduce((n, g) => n + g.high_cents, 0);
  const hoursLow = groups.reduce((n, g) => n + g.items.filter((i) => i.kind !== 'addon').reduce((m, i) => m + i.hours_low, 0), 0);
  const hoursHigh = groups.reduce((n, g) => n + g.items.filter((i) => i.kind !== 'addon').reduce((m, i) => m + i.hours_high, 0), 0);
  return { internal: { rate_cents: rate, discount_pct: discount * 100, hours_low: hoursLow, hours_high: hoursHigh }, groups, low_cents: low, high_cents: high };
}

// Strip everything internal before showing to a client or exporting.
export function clientFacingEstimate(est) {
  return {
    groups: est.groups.map((g) => ({ name: g.name, low_cents: g.low_cents, high_cents: g.high_cents, items: g.items.map((i) => ({ name: i.name, note: i.note, kind: i.kind, low_cents: i.low_cents, high_cents: i.high_cents })) })),
    low_cents: est.low_cents, high_cents: est.high_cents,
  };
}

export const money = (c) => {
  const d = c / 100;
  return '$' + d.toLocaleString('en-AU', { minimumFractionDigits: d % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const kRange = (lo, hi) => {
  const k = (c) => { const d = c / 100; return d >= 1000 ? `$${(d / 1000).toFixed(d % 1000 ? 1 : 0).replace(/\.0$/, '')}k` : `$${d}`; };
  return lo === hi ? k(lo) : `${k(lo)}–${k(hi).replace('$', '')}`;
};
