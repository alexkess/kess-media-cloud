import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';
import { computeEstimate, clientFacingEstimate, roundOut } from '../server/lib/services.js';
import { renderPage, richText } from '../shared/sections.js';

let server, base, dir;
// fetch() cannot override Host, so use node:http for custom-domain requests.
const getHost = (path, host) => new Promise((resolve, reject) => {
  http.get({ host: 'localhost', port: server.address().port, path, headers: { Host: host } }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  }).on('error', reject);
});
const OWNER = ['alex@kess.media', 'kessmedia-demo-2026'];
const CLIENT = ['sam@harbourphysio.example', 'client-demo-2026'];

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-test-'));
  const db = openDb(':memory:');
  seedDemo(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

async function login([email, password]) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, 'login should succeed');
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-Kess': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
  };
}

test('bad password is rejected and API needs a session', async () => {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email: OWNER[0], password: 'nope' }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(`${base}/api/clients`)).status, 401);
});

test('mutations without the X-Kess header are refused (CSRF guard)', async () => {
  const a = await login(OWNER);
  const cookieless = await fetch(`${base}/api/clients`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(cookieless.status, 403);
  assert.equal((await a('/api/clients')).status, 200);
});

test('client users only see their own data and never internal fields', async () => {
  const c = await login(CLIENT);
  assert.equal((await c('/api/clients')).status, 403, 'client list is agency only');
  assert.equal((await c('/api/clients/2')).status, 403, 'other client is forbidden');
  const sites = (await c('/api/sites')).data;
  assert.ok(sites.length >= 1 && sites.every((s) => s.client_name === 'Harbour Physio (demo)'));
  const reqs = (await c('/api/requests')).data;
  assert.ok(reqs.length >= 1);
  for (const r of reqs) { assert.equal(r.estimate_hours, undefined); assert.equal(r.hours_logged, undefined); }
  const detail = (await c(`/api/requests/${reqs.find((r) => r.quote_cents).id}`)).data;
  assert.ok(detail.comments.every((x) => !x.internal), 'internal notes hidden');
  assert.deepEqual(detail.time, []);
  const invoices = (await c('/api/invoices')).data;
  assert.ok(invoices.every((i) => i.status !== 'draft'));
  assert.equal((await c('/api/estimates')).status, 403);
  assert.equal((await c('/api/settings')).status, 403);
  const westside = (await (await login(OWNER))('/api/sites')).data.find((s) => s.name === 'Westside Community Care');
  assert.equal((await c(`/api/sites/${westside.id}`)).status, 403);
  const pv = await fetch(`${base}/preview/${westside.id}/`, { headers: { Cookie: '' }, redirect: 'manual' });
  assert.equal(pv.status, 302, 'preview needs sign-in');
});

test('client content edits keep section structure', async () => {
  const c = await login(CLIENT);
  const site = (await c('/api/sites/1')).data;
  const home = site.pages.find((p) => p.slug === '');
  const edited = structuredClone(home.sections);
  edited[0].heading = 'Move better today,';
  edited[0].style = 'light'; // style is locked for clients
  const ok = await c(`/api/sites/1/pages/${home.id}`, { method: 'PATCH', body: { sections: edited } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.sections[0].heading, 'Move better today,');
  assert.equal(ok.data.sections[0].style, 'dark');
  const removed = await c(`/api/sites/1/pages/${home.id}`, { method: 'PATCH', body: { sections: edited.slice(1) } });
  assert.equal(removed.status, 403);
  assert.equal((await c('/api/sites/1/pages', { method: 'POST', body: { title: 'Hack' } })).status, 403);
});

test('approval flow: agency sends, client approves, site goes live', async () => {
  const a = await login(OWNER);
  const c = await login(CLIENT);
  const sent = await a('/api/sites/1/versions', { method: 'POST', body: { mode: 'review', note: 'Test round' } });
  assert.equal(sent.status, 200);
  const notes = (await c('/api/notifications')).data;
  assert.ok(notes.items.some((n) => n.title.includes(`v${sent.data.number}`)), 'client notified');
  const ap = await c(`/api/sites/1/versions/${sent.data.id}/approve`, { method: 'POST', body: { note: 'Looks great' } });
  assert.equal(ap.status, 200);
  assert.equal(ap.data.published, true);
  const site = (await a('/api/sites/1')).data;
  assert.equal(site.versions.find((v) => v.id === sent.data.id).status, 'published');
  assert.equal(site.versions.filter((v) => v.status === 'published').length, 1);
  const live = await (await fetch(`${base}/s/${site.slug}/`)).text();
  assert.match(live, /Move better today,/);
  // client cannot approve their own submitted edits
  const own = await c('/api/sites/1/versions', { method: 'POST', body: { mode: 'review', note: 'mine' } });
  assert.equal((await c(`/api/sites/1/versions/${own.data.id}/approve`, { method: 'POST', body: {} })).status, 403);
  assert.equal((await c('/api/sites/1/versions', { method: 'POST', body: { mode: 'publish' } })).status, 403);
});

test('request changes creates a feedback ticket', async () => {
  const a = await login(OWNER);
  const c = await login(CLIENT);
  const v = (await a('/api/sites/1/versions', { method: 'POST', body: { mode: 'review' } })).data;
  assert.equal((await c(`/api/sites/1/versions/${v.id}/request-changes`, { method: 'POST', body: {} })).status, 400);
  const r = await c(`/api/sites/1/versions/${v.id}/request-changes`, { method: 'POST', body: { note: 'Swap the hero photo' } });
  assert.ok(r.data.request_id);
  const req = (await a(`/api/requests/${r.data.request_id}`)).data;
  assert.equal(req.kind, 'feedback');
  assert.equal(req.body, 'Swap the hero photo');
});

test('quote approval by client', async () => {
  const a = await login(OWNER);
  const c = await login(CLIENT);
  const q = (await c('/api/requests')).data.find((r) => r.quote_status === 'pending');
  const r = await c(`/api/requests/${q.id}`, { method: 'PATCH', body: { quote_decision: 'approved' } });
  assert.equal(r.data.quote_status, 'approved');
  assert.equal(r.data.status, 'in_progress');
  assert.equal((await c(`/api/requests/${q.id}`, { method: 'PATCH', body: { status: 'done' } })).status, 403);
  await a(`/api/requests/${q.id}`, { method: 'PATCH', body: { status: 'done' } });
});

test('public contact form and analytics beacon', async () => {
  const post = (body) => fetch(`${base}/api/public/forms/harbour-physio`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ name: 'X', email: 'bad', message: 'hi' })).status, 400);
  const ok = await post({ name: 'Test Lead', email: 'lead@example.com', message: 'Hello there', _page: 'contact' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
  const hp = await post({ name: 'Bot', email: 'b@b.co', message: 'spam', _hp: 'filled' });
  assert.equal(hp.status, 200);
  const c = await login(CLIENT);
  const subs = (await c('/api/sites/1/submissions')).data;
  assert.ok(subs.some((s) => s.data.email === 'lead@example.com'));
  assert.ok(!subs.some((s) => s.data.email === 'b@b.co'), 'honeypot not stored');
  const before = (await c('/api/sites/1/analytics?days=7')).data.total;
  await fetch(`${base}/api/public/hit/harbour-physio`, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': 'Mozilla/5.0' }, body: JSON.stringify({ p: '/s/harbour-physio/services', r: 'https://www.google.com/search' }) });
  const after = (await c('/api/sites/1/analytics?days=7')).data;
  assert.equal(after.total, before + 1);
  assert.ok(after.pages.some((p) => p.path === '/services'));
});

test('new site from template, edit, publish, host on custom domain', async () => {
  const a = await login(OWNER);
  const site = (await a('/api/sites', { method: 'POST', body: { client_id: 3, name: 'Lumen Studio Two', template: 'landing', domain: 'lumen-two.example' } })).data;
  assert.equal(site.slug, 'lumen-studio-two');
  const full = (await a(`/api/sites/${site.id}`)).data;
  const home = full.pages[0];
  const bad = await a(`/api/sites/${site.id}/pages/${home.id}`, { method: 'PATCH', body: { sections: [{ type: 'script' }] } });
  assert.equal(bad.status, 400);
  const xss = structuredClone(home.sections);
  xss[0].heading = '<script>alert(1)</script>';
  xss[0].ctaHref = 'javascript:alert(1)';
  await a(`/api/sites/${site.id}/pages/${home.id}`, { method: 'PATCH', body: { sections: xss } });
  await a(`/api/sites/${site.id}/versions`, { method: 'POST', body: { mode: 'publish', note: 'launch' } });
  const res = await getHost('/', 'lumen-two.example');
  const page = res.body;
  assert.equal(res.status, 200);
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'content escaped');
  assert.ok(!page.includes('javascript:alert'), 'unsafe link stripped');
  assert.match(page, /rel="canonical" href="https:\/\/lumen-two\.example\/"/);
  const sm = (await getHost('/sitemap.xml', 'lumen-two.example')).body;
  assert.match(sm, /<loc>https:\/\/lumen-two\.example\/<\/loc>/);
  assert.equal((await a('/api/sites', { method: 'POST', body: { client_id: 3, name: 'Dupe', domain: 'lumen-two.example' } })).status, 400);
});

test('Astro + Sanity export is a valid tarball with the expected files', async () => {
  const a = await login(OWNER);
  const r = await a('/api/sites/1/export');
  assert.equal(r.status, 200);
  const tar = gunzipSync(r.data);
  const names = [];
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0.*$/, '');
    const prefix = h.subarray(345, 500).toString().replace(/\0.*$/, '');
    const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    assert.equal(sum, parseInt(h.subarray(148, 156).toString(), 8), `checksum ${name}`);
    names.push(prefix ? `${prefix}/${name}` : name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  for (const f of ['package.json', 'src/pages/[...slug].astro', 'src/lib/sections.js', 'src/content/site.json', 'studio/schemaTypes/index.js', 'scripts/import-to-sanity.mjs', 'README.md']) {
    assert.ok(names.includes(`harbour-physio-website/${f}`), `missing ${f}`);
  }
  const schema = await import('data:text/javascript,' + encodeURIComponent((await import('../server/lib/astro-export.js')).sanitySchemaJs()));
  assert.ok(schema.schemaTypes.find((t) => t.name === 'section_hero'));
  assert.equal(typeof schema.page.fields[0].validation, 'function');
});

test('estimates: ranges round outward and the rate never leaks', async () => {
  assert.equal(roundOut(1234_00, 'down'), 1200_00);
  assert.equal(roundOut(1234_00, 'up'), 1300_00);
  assert.equal(roundOut(12_345_00, 'up'), 13_000_00);
  const est = computeEstimate({ groups: [{ name: 'Build', items: [{ name: 'A', hours_low: 10, hours_high: 12 }, { name: 'B', hours_low: 2, hours_high: 3, kind: 'addon' }] }] }, 17000);
  assert.equal(est.low_cents, 1700_00);
  assert.equal(est.high_cents, 2500_00); // 12h x $170 = $2,040, rounded up to the next $500
  const cf = JSON.stringify(clientFacingEstimate(est));
  assert.ok(!/"rate|hours|internal|discount/.test(cf), 'no internal keys in client output');
  const a = await login(OWNER);
  const s = (await a('/api/estimates/1/summary')).data;
  assert.ok(!/\/h|hour|170/.test(s.text), 'summary has no rate or hours');
  assert.match(s.text, /negotiable/);
  assert.ok(!s.text.includes('—'), 'no em dashes in client copy');
});

test('care invoices are generated once per client per month', async () => {
  const a = await login(OWNER);
  const period = '2031-02';
  const first = (await a('/api/invoices/generate-care', { method: 'POST', body: { period } })).data.created;
  assert.ok(first.length >= 1);
  const second = (await a('/api/invoices/generate-care', { method: 'POST', body: { period } })).data.created;
  assert.equal(second.length, 0);
  const inv = (await a(`/api/invoices/${first[0].id}`)).data;
  assert.equal(inv.gst_cents, Math.round(inv.subtotal_cents * 0.1));
  assert.equal(inv.total_cents, inv.subtotal_cents + inv.gst_cents);
  const sent = await a(`/api/invoices/${inv.id}`, { method: 'PATCH', body: { status: 'sent' } });
  assert.equal(sent.data.status, 'sent');
  assert.equal((await a(`/api/invoices/${inv.id}`, { method: 'PATCH', body: { items: [] } })).status, 400, 'sent invoices are locked');
  const print = await a(`/invoices/${inv.id}/print`);
  assert.equal(print.status, 200);
});

test('assets upload, serve with safe headers, and type allowlist', async () => {
  const a = await login(OWNER);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = await a('/api/assets', { method: 'POST', body: { client_id: 1, filename: 'dot.png', mime: 'image/png', data: png.toString('base64') } });
  assert.equal(up.status, 200);
  const res = await fetch(base + up.data.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await a('/api/assets', { method: 'POST', body: { client_id: 1, filename: 'x.html', mime: 'text/html', data: 'PGI+' } })).status, 400);
});

test('renderer escapes and formats rich text safely', () => {
  assert.equal(richText('Hi **there** [x](javascript:alert)'), '<p>Hi <strong>there</strong> x</p>');
  assert.equal(richText('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  const snap = { site: { name: 'T', settings: {} }, theme: { colors: { bg: '#fff', soft: '#eee', text: '#000', muted: '#666', primary: '#000', accent: '#0f0', dark: '#000', onDark: '#fff' }, fonts: { body: 'Inter', accent: 'none' }, radius: 0 }, pages: [{ slug: '', title: 'Home', sections: [{ type: 'hero', heading: 'Hi', ctaLabel: 'Go', ctaHref: 'about' }] }] };
  const out = renderPage(snap, '', { base: '/s/t' });
  assert.match(out, /href="\/s\/t\/about"/);
  assert.equal(renderPage(snap, 'missing'), null);
});
