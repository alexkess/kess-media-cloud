// Xero: send invoices to Xero when they are issued, record card payments, and pull "paid" back
// so reconciling a bank transfer in Xero stops Kess Cloud's reminders.
//   XERO_CLIENT_ID, XERO_CLIENT_SECRET  from developer.xero.com (Web app, redirect <PUBLIC_URL>/oauth/xero/callback)
//   XERO_SCOPES (optional)              apps created after 2 March 2026 need granular scopes (the default).
//                                       Older apps can use: "openid profile email offline_access accounting.transactions accounting.contacts accounting.settings.read"
import { getIntegration, saveIntegration, updateSecrets, setIntegrationStatus, fetchJson } from './integrations.js';
import { loadInvoice, logActivity, notify, money } from './services.js';

const AUTH = 'https://login.xero.com/identity/connect/authorize';
const TOKEN = 'https://identity.xero.com/connect/token';
const API = 'https://api.xero.com/api.xro/2.0';
export const DEFAULT_SCOPES = 'openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read';
export const XERO_DEFAULTS = { sales_account_code: '200', tax_type: 'OUTPUT', payment_account_id: '', auto_push: true, push_from: '' };

export const xeroConfigured = () => !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
const basic = () => 'Basic ' + Buffer.from(`${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`).toString('base64');

export function xeroAuthUrl({ redirectUri, state }) {
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env.XERO_CLIENT_ID, redirect_uri: redirectUri, scope: process.env.XERO_SCOPES || DEFAULT_SCOPES, state });
  return `${AUTH}?${q}`;
}

export async function xeroConnect(db, { code, redirectUri, user, dataDir }) {
  const tok = await fetchJson(TOKEN, { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }) });
  const conns = await fetchJson('https://api.xero.com/connections', { headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' } });
  const org = (conns || []).find((c) => c.tenantType === 'ORGANISATION') || (conns || [])[0];
  if (!org) throw new Error('No Xero organisation was connected. Try again and choose your organisation.');
  const prev = getIntegration(db, 'xero', dataDir);
  saveIntegration(db, 'xero', {
    account_name: org.tenantName, user, dataDir,
    secrets: { access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000, tenant_id: org.tenantId },
    settings: { ...XERO_DEFAULTS, push_from: new Date().toISOString().slice(0, 10), ...(prev?.settings || {}) },
  });
  return org.tenantName;
}

async function accessToken(db, dataDir) {
  const integ = getIntegration(db, 'xero', dataDir);
  if (!integ?.secrets) throw new Error('Xero is not connected');
  const s = integ.secrets;
  if (s.expires_at > Date.now()) return { token: s.access_token, tenant: s.tenant_id, integ };
  try {
    const tok = await fetchJson(TOKEN, { method: 'POST', headers: { Authorization: basic(), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refresh_token }) });
    const next = { ...s, access_token: tok.access_token, refresh_token: tok.refresh_token || s.refresh_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000 };
    updateSecrets(db, 'xero', next, dataDir);
    return { token: next.access_token, tenant: next.tenant_id, integ };
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      setIntegrationStatus(db, 'xero', { error: 'Xero sign-in expired. Reconnect Xero in Settings.' });
      notify(db, { audience: 'agency', title: 'Xero needs reconnecting', body: 'Invoices are not being sent to Xero until you reconnect it in Settings.', link: '#/settings' });
    }
    throw e;
  }
}

async function xero(db, dataDir, path, { method = 'GET', body, idempotencyKey } = {}) {
  const { token, tenant } = await accessToken(db, dataDir);
  return fetchJson(`${API}${path}`, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: `Bearer ${token}`, 'xero-tenant-id': tenant, Accept: 'application/json', 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
  });
}

const firstLast = (name = '') => { const p = name.trim().split(/\s+/); return { FirstName: p[0] || '', LastName: p.slice(1).join(' ') }; };
const xeroDate = (d) => d; // Xero accepts YYYY-MM-DD

export async function ensureContact(db, dataDir, clientId) {
  const c = db.get('SELECT * FROM clients WHERE id = ?', clientId);
  if (c.xero_contact_id) return c.xero_contact_id;
  const found = await xero(db, dataDir, `/Contacts?searchTerm=${encodeURIComponent(c.email || c.name)}&summaryOnly=true`);
  const lc = (s) => String(s || '').trim().toLowerCase();
  let hit = (found?.Contacts || []).find((x) => (c.email && lc(x.EmailAddress) === lc(c.email)) || lc(x.Name) === lc(c.name));
  if (!hit) {
    const body = { Contacts: [{ Name: c.name, EmailAddress: c.email || undefined, ...(c.contact_name ? firstLast(c.contact_name) : {}), ...(c.abn ? { TaxNumber: c.abn.replace(/\s/g, '') } : {}),
      ...(c.phone ? { Phones: [{ PhoneType: 'DEFAULT', PhoneNumber: c.phone }] } : {}) }] };
    try { hit = (await xero(db, dataDir, '/Contacts', { method: 'POST', body, idempotencyKey: `kc-contact-${c.id}` })).Contacts[0]; }
    catch (e) {
      // Same name already in Xero under a different email: use that contact.
      const byName = await xero(db, dataDir, `/Contacts?where=${encodeURIComponent(`Name=="${c.name.replace(/"/g, '')}"`)}&summaryOnly=true`).catch(() => null);
      hit = byName?.Contacts?.[0];
      if (!hit) throw e;
    }
  }
  db.run('UPDATE clients SET xero_contact_id = ? WHERE id = ?', hit.ContactID, c.id);
  return hit.ContactID;
}

// Create or update the invoice in Xero to match Kess Cloud. Drafts are never sent.
export async function pushInvoice(db, dataDir, invoiceId) {
  const integ = getIntegration(db, 'xero', dataDir);
  if (!integ?.secrets) return { skipped: 'not connected' };
  const set = { ...XERO_DEFAULTS, ...integ.settings };
  const inv = loadInvoice(db, invoiceId);
  if (inv.status === 'draft') return { skipped: 'draft' };
  try {
    if (inv.status === 'void') {
      if (inv.xero_id && inv.xero_status !== 'VOIDED') {
        const r = await xero(db, dataDir, `/Invoices/${inv.xero_id}`, { method: 'POST', body: { Invoices: [{ InvoiceID: inv.xero_id, Status: 'VOIDED' }] } });
        db.run("UPDATE invoices SET xero_status = ?, xero_synced_at = datetime('now'), xero_error = NULL WHERE id = ?", r.Invoices?.[0]?.Status || 'VOIDED', inv.id);
      }
      return { ok: true };
    }
    if (!inv.xero_id) {
      const contactId = await ensureContact(db, dataDir, inv.client_id);
      const body = { Invoices: [{
        Type: 'ACCREC', Contact: { ContactID: contactId }, InvoiceNumber: inv.number, Reference: (inv.notes || '').slice(0, 255),
        Date: xeroDate(inv.issue_date), DueDate: xeroDate(inv.due_date), LineAmountTypes: 'Exclusive', Status: 'AUTHORISED', CurrencyCode: 'AUD',
        LineItems: inv.items.map((i) => ({ Description: i.description, Quantity: i.qty, UnitAmount: Math.round(i.unit_cents) / 100, AccountCode: set.sales_account_code, TaxType: set.tax_type })),
      }] };
      const r = await xero(db, dataDir, '/Invoices', { method: 'POST', body, idempotencyKey: `kc-invoice-${inv.id}-${inv.number}` });
      const x = r.Invoices[0];
      const diff = Math.round(Number(x.Total) * 100) - inv.total_cents;
      db.run("UPDATE invoices SET xero_id = ?, xero_status = ?, xero_synced_at = datetime('now'), xero_error = ? WHERE id = ?", x.InvoiceID, x.Status, diff ? `Xero total differs by ${money(Math.abs(diff), { cents: true })} (GST rounding per line)` : null, inv.id);
      logActivity(db, { client_id: inv.client_id, action: 'invoice.xero', detail: `${inv.number} sent to Xero` });
    }
    const fresh = loadInvoice(db, invoiceId);
    if (fresh.status === 'paid' && set.payment_account_id && !fresh.xero_payment_id && fresh.xero_status !== 'PAID') await recordPayment(db, dataDir, fresh, set);
    return { ok: true };
  } catch (e) {
    db.run('UPDATE invoices SET xero_error = ? WHERE id = ?', String(e.message).slice(0, 300), inv.id);
    setIntegrationStatus(db, 'xero', { error: `${inv.number}: ${e.message}` });
    return { error: e.message };
  }
}

async function recordPayment(db, dataDir, inv, set) {
  const r = await xero(db, dataDir, '/Payments', { method: 'PUT', idempotencyKey: `kc-payment-${inv.id}`, body: { Payments: [{
    Invoice: { InvoiceID: inv.xero_id }, Account: { AccountID: set.payment_account_id }, Date: inv.paid_at || new Date().toISOString().slice(0, 10),
    Amount: inv.total_cents / 100, Reference: inv.paid_via === 'stripe' ? 'Card (Stripe) via Kess Cloud' : 'Recorded in Kess Cloud' }] } });
  db.run("UPDATE invoices SET xero_payment_id = ?, xero_status = 'PAID', xero_synced_at = datetime('now') WHERE id = ?", r.Payments?.[0]?.PaymentID || 'recorded', inv.id);
}

// Pull Xero status for open invoices; mark paid in Kess Cloud when Xero says PAID.
export async function pullStatuses(db, dataDir, markPaid) {
  const open = db.all("SELECT id, xero_id FROM invoices WHERE xero_id IS NOT NULL AND status = 'sent'");
  let paid = 0;
  for (let i = 0; i < open.length; i += 40) {
    const chunk = open.slice(i, i + 40);
    const r = await xero(db, dataDir, `/Invoices?IDs=${chunk.map((x) => x.xero_id).join(',')}&summaryOnly=true`);
    for (const x of r.Invoices || []) {
      const row = chunk.find((c) => c.xero_id === x.InvoiceID);
      if (!row) continue;
      db.run("UPDATE invoices SET xero_status = ?, xero_synced_at = datetime('now') WHERE id = ?", x.Status, row.id);
      if (x.Status === 'PAID') { markPaid(loadInvoice(db, row.id)); paid++; }
    }
  }
  return paid;
}

// Hourly: push issued invoices that are not in Xero yet (from the connect date on), then pull statuses.
export async function xeroSync(db, dataDir, markPaid) {
  const integ = getIntegration(db, 'xero', dataDir);
  if (!integ?.secrets) return { skipped: true };
  const set = { ...XERO_DEFAULTS, ...integ.settings };
  const log = { pushed: 0, errors: 0, paid: 0 };
  if (set.auto_push) {
    const todo = db.all(`SELECT id FROM invoices WHERE status IN ('sent','paid') AND xero_id IS NULL AND issue_date >= ? ORDER BY id LIMIT 50`, set.push_from || '1900-01-01');
    for (const { id } of todo) { const r = await pushInvoice(db, dataDir, id); if (r.ok) log.pushed++; if (r.error) log.errors++; }
    for (const { id } of db.all("SELECT id FROM invoices WHERE status = 'void' AND xero_id IS NOT NULL AND COALESCE(xero_status, '') NOT IN ('VOIDED','DELETED') LIMIT 50")) await pushInvoice(db, dataDir, id);
    for (const { id } of db.all("SELECT id FROM invoices WHERE status = 'paid' AND xero_id IS NOT NULL AND xero_payment_id IS NULL AND COALESCE(xero_status, '') != 'PAID' LIMIT 50")) await pushInvoice(db, dataDir, id);
  }
  try { log.paid = await pullStatuses(db, dataDir, markPaid); setIntegrationStatus(db, 'xero', { synced: true, error: log.errors ? `${log.errors} invoice(s) could not be sent to Xero. See Invoices.` : null }); }
  catch (e) { setIntegrationStatus(db, 'xero', { error: e.message }); }
  return log;
}

// Account list for the settings dropdowns (revenue and bank accounts).
export async function xeroAccounts(db, dataDir) {
  const r = await xero(db, dataDir, '/Accounts');
  return (r.Accounts || []).filter((a) => a.Status === 'ACTIVE').map((a) => ({ id: a.AccountID, code: a.Code, name: a.Name, type: a.Type, class: a.Class, tax: a.TaxType, bank: a.Type === 'BANK' || !!a.EnablePaymentsToAccount }));
}

// Push an invoice to Xero shortly after it changes, without blocking the request.
export function xeroSoon(db, invoiceId) {
  try { if (!db.get("SELECT 1 FROM integrations WHERE provider = 'xero' AND secrets IS NOT NULL")) return; } catch { return; }
  setImmediate(() => { pushInvoice(db, undefined, invoiceId).catch(() => {}); });
}
