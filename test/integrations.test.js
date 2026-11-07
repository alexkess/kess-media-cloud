import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KESS_SECRET = 'test-secret-for-integrations';
process.env.XERO_CLIENT_ID = 'xero-client';
process.env.XERO_CLIENT_SECRET = 'xero-secret';
process.env.DROPBOX_APP_KEY = 'dbx-key';
process.env.DROPBOX_APP_SECRET = 'dbx-secret';
process.env.VIMEO_TOKEN = 'vimeo-token';

const { createApp } = await import('../server/app.js');
const { openDb } = await import('../server/db.js');
const { seedDemo } = await import('../server/seed.js');
const { encrypt, decrypt, makeState, checkState, secretKey, _resetKeyForTests } = await import('../server/lib/integrations.js');
const { folderFor, cleanName } = await import('../server/lib/dropbox.js');
const { xeroSync } = await import('../server/lib/xero.js');
const { markInvoicePaid } = await import('../server/api/billing.js');

let server, base, dir, db;
const realFetch = globalThis.fetch;
const calls = [];

// ---------- fake Xero / Dropbox / Vimeo ----------
const X = { contacts: [], invoices: [], payments: [], refreshes: 0, failRefresh: false, tokenN: 0 };
const D = { folders: new Set(), links: new Map(), requests: [], headers: [] };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
async function fake(url, opts = {}) {
  const u = new URL(url);
  const body = opts.body ? (typeof opts.body === 'string' ? opts.body : opts.body.toString()) : '';
  calls.push({ url: u.href, method: opts.method || 'GET', headers: opts.headers || {}, body });
  // Xero
  if (u.host === 'identity.xero.com') {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') === 'refresh_token') { X.refreshes++; if (X.failRefresh) return json(400, { error: 'invalid_grant' }); }
    X.tokenN++;
    return json(200, { access_token: `xat-${X.tokenN}`, refresh_token: `xrt-${X.tokenN}`, expires_in: 1800 });
  }
  if (u.host === 'api.xero.com' && u.pathname === '/connections') return json(200, [{ tenantId: 'tenant-1', tenantName: 'Kess Media Pty Ltd', tenantType: 'ORGANISATION' }]);
  if (u.host === 'api.xero.com') {
    assert.equal(opts.headers['xero-tenant-id'], 'tenant-1');
    const path = u.pathname.replace('/api.xro/2.0', '');
    const b = body ? JSON.parse(body) : null;
    if (path === '/Contacts' && (opts.method || 'GET') === 'GET') {
      const term = (u.searchParams.get('searchTerm') || '').toLowerCase();
      return json(200, { Contacts: X.contacts.filter((c) => term && (c.Name.toLowerCase().includes(term) || (c.EmailAddress || '').toLowerCase() === term)) });
    }
    if (path === '/Contacts') { const c = { ...b.Contacts[0], ContactID: `c-${X.contacts.length + 1}` }; X.contacts.push(c); return json(200, { Contacts: [c] }); }
    if (path === '/Invoices' && opts.method === 'POST') {
      const inv = b.Invoices[0];
      const sub = inv.LineItems.reduce((n, l) => n + Math.round(l.Quantity * l.UnitAmount * 100), 0);
      const tax = inv.LineItems.reduce((n, l) => n + Math.round(Math.round(l.Quantity * l.UnitAmount * 100) * 0.1), 0);
      const x = { ...inv, InvoiceID: `i-${X.invoices.length + 1}`, Total: (sub + tax) / 100, AmountDue: (sub + tax) / 100 };
      X.invoices.push(x);
      return json(200, { Invoices: [x] });
    }
    if (path.startsWith('/Invoices/') && opts.method === 'POST') { const x = X.invoices.find((i) => i.InvoiceID === path.split('/')[2]); x.Status = b.Invoices[0].Status; return json(200, { Invoices: [x] }); }
    if (path === '/Invoices') { const ids = (u.searchParams.get('IDs') || '').split(','); return json(200, { Invoices: X.invoices.filter((i) => ids.includes(i.InvoiceID)) }); }
    if (path === '/Payments') { const p = { ...b.Payments[0], PaymentID: `p-${X.payments.length + 1}` }; X.payments.push(p); return json(200, { Payments: [p] }); }
    if (path === '/Accounts') return json(200, { Accounts: [{ AccountID: '11111111-2222-3333-4444-555555555555', Code: '090', Name: 'Business Account', Type: 'BANK', Status: 'ACTIVE' }, { AccountID: 'aaaa', Code: '200', Name: 'Sales', Type: 'REVENUE', Status: 'ACTIVE' }] });
    return json(404, { Message: `no fake for ${path}` });
  }
  // Dropbox
  if (u.host === 'api.dropboxapi.com') {
    if (u.pathname === '/oauth2/token') return json(200, { access_token: 'dat-1', refresh_token: 'drt-1', expires_in: 14400 });
    D.headers.push(opts.headers || {});
    const b = body && body !== 'null' ? JSON.parse(body) : null;
    switch (u.pathname) {
      case '/2/users/get_current_account': return json(200, { email: 'alex@kess.media', name: { display_name: 'Alex Kess' }, root_info: { '.tag': 'team', root_namespace_id: '999', home_namespace_id: '111' }, team: { name: 'Kess Media' } });
      case '/2/files/create_folder_v2':
        if (D.folders.has(b.path)) return json(409, { error_summary: 'path/conflict/folder/..', error: { '.tag': 'path', path: { '.tag': 'conflict', conflict: { '.tag': 'folder' } } } });
        D.folders.add(b.path); return json(200, { metadata: { path_display: b.path } });
      case '/2/file_requests/create': D.requests.push(b); return json(200, { id: 'fr-1', url: 'https://www.dropbox.com/request/abc123' });
      case '/2/files/list_folder': return json(200, { entries: [{ '.tag': 'file', name: 'b.jpg', path_display: `${b.path}/b.jpg`, size: 10 }, { '.tag': 'folder', name: 'Final', path_display: `${b.path}/Final` }], has_more: false });
      case '/2/sharing/create_shared_link_with_settings':
        if (D.links.has(b.path)) return json(409, { error_summary: 'shared_link_already_exists/..', error: { '.tag': 'shared_link_already_exists', shared_link_already_exists: { metadata: { url: D.links.get(b.path) } } } });
        D.links.set(b.path, `https://www.dropbox.com/scl/fo/${D.links.size + 1}`); return json(200, { url: D.links.get(b.path) });
      case '/2/auth/token/revoke': return json(200, null);
      default: return json(404, { error_summary: 'not faked' });
    }
  }
  // Vimeo
  if (u.host === 'api.vimeo.com') {
    assert.equal(opts.headers.Authorization, 'bearer vimeo-token');
    const v = { uri: '/videos/76979871', name: 'Clinic film v2', link: 'https://vimeo.com/76979871/abc123', duration: 95, pictures: { sizes: [{ width: 640, link: 'https://i.vimeocdn.com/x.jpg' }] }, privacy: { view: 'unlisted' }, review_page: { active: true, link: 'https://vimeo.com/user/review/76979871/xyz' } };
    if (u.pathname === '/me/videos') return json(200, { total: 1, page: 1, per_page: 24, data: [v] });
    if (u.pathname === '/videos/76979871') return json(200, v);
    if (u.pathname === '/me') return json(200, { name: 'Kess Media', link: 'https://vimeo.com/kessmedia', account: 'pro' });
    return json(404, { error: 'not faked' });
  }
  return realFetch(url, opts);
}

before(async () => {
  _resetKeyForTests();
  globalThis.fetch = fake;
  dir = mkdtempSync(join(tmpdir(), 'kc-int-'));
  db = openDb(':memory:');
  seedDemo(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });

async function login(email, password) {
  const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email, password }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, redirect = 'follow' } = {}) => {
    const res = await realFetch(base + path, { method, redirect, headers: { Cookie: cookie, 'X-Kess': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const owner = () => login('alex@kess.media', 'kessmedia-demo-2026');
const settle = () => new Promise((r) => setTimeout(r, 60));

async function connect(a, provider) {
  const start = await a(`/oauth/${provider}/start`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const loc = new URL(start.headers.get('location'));
  const back = await a(`/oauth/${provider}/callback?code=good-code&state=${encodeURIComponent(loc.searchParams.get('state'))}`, { redirect: 'manual' });
  return { loc, back: back.headers.get('location') };
}

test('secrets are encrypted at rest and OAuth state is bound to the user', () => {
  const key = secretKey(dir);
  const box = encrypt({ token: 'abc' }, key);
  assert.ok(!box.includes('abc'));
  assert.deepEqual(decrypt(box, key), { token: 'abc' });
  const tampered = box.slice(0, -2) + (box.endsWith('A') ? 'B' : 'A') + box.slice(-1);
  assert.equal(decrypt(tampered, key), null);
  const st = makeState('xero', 1, dir);
  assert.ok(checkState(st, 'xero', 1, dir));
  assert.ok(!checkState(st, 'xero', 2, dir), 'other user');
  assert.ok(!checkState(st, 'dropbox', 1, dir), 'other provider');
  assert.ok(!checkState(st, 'xero', 1, dir, -1), 'expired');
});

test('Xero: owner-only connect, tokens stored encrypted, invoices pushed with GST, paid comes back', async () => {
  const georgia = await login('georgia@kess.media', 'georgia-demo-2026');
  assert.equal((await georgia('/oauth/xero/start', { redirect: 'manual' })).status, 403, 'staff cannot connect');
  const a = await owner();
  const bad = await a('/oauth/xero/callback?code=x&state=forged', { redirect: 'manual' });
  assert.match(bad.headers.get('location'), /integration_error/);
  const { loc, back } = await connect(a, 'xero');
  assert.equal(loc.host, 'login.xero.com');
  assert.match(loc.searchParams.get('scope'), /accounting\.invoices/);
  assert.equal(loc.searchParams.get('redirect_uri'), `${base}/oauth/xero/callback`);
  assert.match(back, /connected=xero/);
  const row = db.get("SELECT * FROM integrations WHERE provider = 'xero'");
  assert.equal(row.account_name, 'Kess Media Pty Ltd');
  assert.ok(!row.secrets.includes('xat-') && !row.secrets.includes('xrt-'), 'tokens not stored in plain text');
  const apps = (await a('/api/integrations/apps')).data;
  assert.equal(apps.xero.connected, true);
  assert.ok(!JSON.stringify(apps).includes('xat-'), 'tokens never sent to the browser');

  // Issue a fresh invoice: it goes to Xero
  const inv = (await a('/api/invoices', { method: 'POST', body: { client_id: 1, notes: 'Website changes', items: [{ description: 'Change request', qty: 3, unit_cents: 16650 }, { description: 'Hosting', qty: 1, unit_cents: 9900 }] } })).data;
  await a(`/api/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'sent' } });
  await settle();
  const x = X.invoices.find((i) => i.InvoiceNumber === inv.number);
  assert.ok(x, 'invoice created in Xero');
  assert.equal(x.Type, 'ACCREC');
  assert.equal(x.LineAmountTypes, 'Exclusive');
  assert.equal(x.Status, 'AUTHORISED');
  assert.deepEqual(x.LineItems.map((l) => [l.Quantity, l.UnitAmount, l.AccountCode, l.TaxType]), [[3, 166.5, '200', 'OUTPUT'], [1, 99, '200', 'OUTPUT']]);
  assert.equal(X.contacts.length, 1);
  assert.equal(X.contacts[0].EmailAddress, 'sam@harbourphysio.example');
  const after1 = (await a(`/api/invoices/${inv.id}`)).data;
  assert.equal(after1.xero_id, x.InvoiceID);
  assert.equal(after1.xero_error, null);
  // pushing again never duplicates; the contact is reused for the next invoice
  await a(`/api/invoices/${inv.id}/xero`, { method: 'POST', body: {} });
  assert.equal(X.invoices.filter((i) => i.InvoiceNumber === inv.number).length, 1);
  const inv2 = (await a('/api/invoices', { method: 'POST', body: { client_id: 1, items: [{ description: 'Extra', qty: 1, unit_cents: 5000 }] } })).data;
  assert.equal((await a(`/api/invoices/${inv2.id}/xero`, { method: 'POST', body: {} })).status, 400, 'drafts stay out of Xero');
  await a(`/api/invoices/${inv2.id}`, { method: 'PATCH', body: { status: 'sent' } });
  await settle();
  assert.equal(X.contacts.length, 1, 'contact reused');

  // Reconciled in Xero -> paid in Kess Cloud on the next sync
  X.invoices.find((i) => i.InvoiceNumber === inv.number).Status = 'PAID';
  const log = await xeroSync(db, dir, (i) => markInvoicePaid(db, i, { via: 'xero' }));
  assert.equal(log.paid, 1);
  const paid = (await a(`/api/invoices/${inv.id}`)).data;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paid_via, 'xero');

  // Voiding pushes VOIDED
  await a(`/api/invoices/${inv2.id}`, { method: 'PATCH', body: { status: 'void' } });
  await settle();
  assert.equal(X.invoices.find((i) => i.InvoiceNumber === inv2.number).Status, 'VOIDED');
});

test('Xero: card payments are recorded to the chosen bank account; expired sign-in is reported', async () => {
  const a = await owner();
  const accounts = (await a('/api/integrations/xero/accounts')).data;
  const bank = accounts.find((x) => x.bank);
  assert.equal((await a('/api/integrations/xero/settings', { method: 'PATCH', body: { payment_account_id: 'nope' } })).status, 400);
  assert.equal((await a('/api/integrations/xero/settings', { method: 'PATCH', body: { payment_account_id: bank.id } })).status, 200);
  const inv = (await a('/api/invoices', { method: 'POST', body: { client_id: 2, items: [{ description: 'Deposit', qty: 1, unit_cents: 100000 }] } })).data;
  await a(`/api/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'sent' } });
  await settle();
  markInvoicePaid(db, (await a(`/api/invoices/${inv.id}`)).data, { via: 'stripe' });
  await settle(); await settle();
  const pay = X.payments.at(-1);
  assert.equal(pay.Account.AccountID, bank.id);
  assert.equal(pay.Amount, 1100);
  assert.match(pay.Reference, /Stripe/);

  // Access token expired -> refresh, new refresh token stored
  const { getIntegration, updateSecrets } = await import('../server/lib/integrations.js');
  const s = getIntegration(db, 'xero', dir).secrets;
  updateSecrets(db, 'xero', { ...s, expires_at: 0 }, dir);
  const before = X.refreshes;
  await a('/api/integrations/xero/accounts');
  assert.equal(X.refreshes, before + 1);
  assert.notEqual(getIntegration(db, 'xero', dir).secrets.refresh_token, s.refresh_token, 'rotated refresh token saved');
  // Refresh rejected -> clear error and a notification, not a crash
  updateSecrets(db, 'xero', { ...getIntegration(db, 'xero', dir).secrets, expires_at: 0 }, dir);
  X.failRefresh = true;
  assert.equal((await a('/api/integrations/xero/accounts')).status, 502);
  assert.match(db.get("SELECT last_error FROM integrations WHERE provider = 'xero'").last_error, /Reconnect Xero/);
  assert.ok(db.get("SELECT 1 FROM notifications WHERE title = 'Xero needs reconnecting'"));
  X.failRefresh = false;
});

test('Xero: invoices issued before the cutover date are never created in Xero, even when marked paid', async () => {
  // An invoice imported from Studio Ninja: issued before Xero was connected, so Studio Ninja's own sync already put it in Xero.
  const a = await owner();
  const { push_from } = JSON.parse(db.get("SELECT settings FROM integrations WHERE provider = 'xero'").settings);
  assert.ok(push_from, 'cutover date set on connect');
  const inv = (await a('/api/invoices', { method: 'POST', body: { client_id: 1, items: [{ description: 'Imported shoot deposit', qty: 1, unit_cents: 50000 }] } })).data;
  db.run("UPDATE invoices SET status = 'sent', issue_date = '2026-01-15' WHERE id = ?", inv.id);
  const before = X.invoices.length;

  markInvoicePaid(db, (await a(`/api/invoices/${inv.id}`)).data, { via: 'manual' });
  await settle(); await settle();
  assert.equal(X.invoices.length, before, 'not pushed when marked paid');
  assert.equal(db.get('SELECT xero_id FROM invoices WHERE id = ?', inv.id).xero_id, null);

  await xeroSync(db, dir, () => {});
  assert.equal(X.invoices.length, before, 'not pushed by the hourly sync either');

  const manual = await a(`/api/invoices/${inv.id}/xero`, { method: 'POST', body: {} });
  assert.equal(manual.status, 400, 'the Push to Xero button refuses too');
  assert.match(manual.data.error, /issued before \d\d\/\d\d\/\d{4}, when Xero was connected/);
  assert.equal(X.invoices.length, before);
});

test('Dropbox: team space header, shoot folders from the template, client upload link, deliver from a folder', async () => {
  assert.equal(folderFor('/0 - Clients/{client}/{year}-{month}-{day} {job}', { client: 'Acme / Co: "Events"', job: 'Gala*', date: '2026-12-14' }), '/0 - Clients/Acme - Co- -Events-/2026-12-14 Gala-');
  assert.equal(cleanName('  ..hidden  '), 'hidden');
  const a = await owner();
  const { back } = await connect(a, 'dropbox');
  assert.match(back, /connected=dropbox/);
  assert.equal(db.get("SELECT account_name FROM integrations WHERE provider = 'dropbox'").account_name, 'Alex Kess (Kess Media)');
  const job = db.get("SELECT * FROM jobs WHERE title = 'Team headshots + clinic video'");
  const f = (await a(`/api/studio/jobs/${job.id}/dropbox/folder`, { method: 'POST', body: {} })).data;
  assert.match(f.dropbox_path, /^\/0 - Clients\/Harbourside Dental \(demo\)\/\d{4}-\d{2}-\d{2} Team headshots \+ clinic video$/);
  assert.ok(D.folders.has(`${f.dropbox_path}/Final`));
  assert.equal(JSON.parse(D.headers.at(-1)['Dropbox-API-Path-Root']).root, '999', 'team root namespace used');
  // running again tolerates existing folders
  assert.equal((await a(`/api/studio/jobs/${job.id}/dropbox/folder`, { method: 'POST', body: {} })).status, 200);
  const req = (await a(`/api/studio/jobs/${job.id}/dropbox/request`, { method: 'POST', body: {} })).data;
  assert.equal(req.dropbox_request_url, 'https://www.dropbox.com/request/abc123');
  assert.equal(D.requests[0].destination, `${f.dropbox_path}/Client uploads`);
  const page = await realFetch(`${base}/j/${job.token}`).then((r) => r.text());
  assert.match(page, /Send us <em>files<\/em>/);
  assert.match(page, /dropbox\.com\/request\/abc123/);
  const list = (await a(`/api/dropbox/list?path=${encodeURIComponent(f.dropbox_path)}`)).data;
  assert.equal(list.entries[0].type, 'folder', 'folders first');
  assert.equal((await a('/api/dropbox/list?path=..%2Fetc')).status, 400);
  const d1 = (await a(`/api/studio/jobs/${job.id}/dropbox/deliver`, { method: 'POST', body: { path: `${f.dropbox_path}/Final`, label: 'Final photos' } })).data;
  const d2 = (await a(`/api/studio/jobs/${job.id}/dropbox/deliver`, { method: 'POST', body: { path: `${f.dropbox_path}/Final`, label: 'Again' } })).data;
  assert.equal(d1.deliveries[0].provider, 'dropbox');
  assert.equal(d2.deliveries[0].url, d1.deliveries[0].url, 'existing shared link reused');
  const client = await login('sam@harbourphysio.example', 'client-demo-2026');
  assert.equal((await client('/api/dropbox/list?path=/')).status, 403);
});

test('Vimeo: browse the library and deliver a video with its review page', async () => {
  const a = await owner();
  const lib = (await a('/api/vimeo/videos?query=clinic')).data;
  assert.equal(lib.videos[0].id, '76979871');
  assert.equal(lib.videos[0].thumb, 'https://i.vimeocdn.com/x.jpg');
  assert.match(calls.find((c) => c.url.includes('/me/videos')).url, /query=clinic/);
  const job = db.get("SELECT * FROM jobs WHERE title = 'Team headshots + clinic video'");
  const j = (await a(`/api/studio/jobs/${job.id}/vimeo`, { method: 'POST', body: { video_id: '76979871', include_review: true } })).data;
  const v = j.deliveries.filter((d) => d.provider === 'vimeo');
  assert.ok(v.some((d) => d.url === 'https://vimeo.com/76979871/abc123' && d.embed === 'https://player.vimeo.com/video/76979871?h=abc123'));
  assert.ok(v.some((d) => /review/.test(d.url) && /^Review and comment/.test(d.label)));
  assert.equal((await a(`/api/studio/jobs/${job.id}/vimeo`, { method: 'POST', body: { video_id: '../me' } })).status, 502);
});
