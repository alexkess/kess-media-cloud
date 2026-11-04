import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';
import { cleanAnchor, cleanShape } from '../server/api/feedback.js';

let server, base, dir, db;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-fb-'));
  db = openDb(':memory:');
  seedDemo(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

async function login(email, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email, password }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-Kess': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const owner = () => login('alex@kess.media', 'kessmedia-demo-2026');
const client = () => login('sam@harbourphysio.example', 'client-demo-2026');
const pub = (path, body) => fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));

const pin = { kind: 'pin', page_slug: '', version: 'draft', body: 'Make the heading bigger', anchor: { selector: 'body > main > section:nth-of-type(1) > div > div > h1', section: 0, fx: 0.4, fy: 0.5, tag: 'h1', docX: 0.3, docY: 220 }, viewport_w: 1440 };

test('anchor and shape input is sanitised', () => {
  const a = cleanAnchor({ selector: 'body > main"><script>', section: 9999, fx: 7, fy: -3, quote: 'x'.repeat(900), tag: 'h1<', docY: -5 });
  assert.equal(a.selector, '', 'unsafe selector dropped');
  assert.equal(a.section, -1);
  assert.deepEqual([a.fx, a.fy, a.docY], [1, 0, 0]);
  assert.equal(a.quote.length, 500);
  assert.equal(a.tag, 'h1');
  const s = cleanShape({ points: Array.from({ length: 900 }, (_, i) => [i / 900, 9]) }, 'draw');
  assert.equal(s.points.length, 600);
  assert.ok(s.points.every(([, y]) => y === 1.5));
  assert.throws(() => cleanShape({ points: [[0, 0]] }, 'draw'), /empty/);
  assert.deepEqual(cleanShape({ points: [[0, 0], [1, 1]] }, 'pin'), {});
});

test('client leaves feedback, agency is notified, replies and resolves', async () => {
  const c = await client();
  const a = await owner();
  const before = db.get("SELECT COUNT(*) n FROM notifications WHERE title LIKE '%left feedback%'").n;
  const made = await c('/api/sites/1/feedback', { method: 'POST', body: pin });
  assert.equal(made.status, 200);
  assert.equal(made.data.author, 'Sam Lee');
  assert.equal(made.data.mine, true);
  assert.equal(made.data.anchor.section, 0);
  assert.ok(db.get("SELECT COUNT(*) n FROM notifications WHERE title LIKE '%left feedback%'").n > before, 'agency notified');
  // second comment within 10 minutes does not notify again
  const mid = db.get("SELECT COUNT(*) n FROM notifications WHERE title LIKE '%left feedback%'").n;
  await c('/api/sites/1/feedback', { method: 'POST', body: { ...pin, kind: 'draw', body: 'This photo', shape: { points: [[0.1, 0.1], [0.3, 0.2], [0.2, 0.4]] } } });
  assert.equal(db.get("SELECT COUNT(*) n FROM notifications WHERE title LIKE '%left feedback%'").n, mid, 'burst is not re-notified');

  assert.equal((await a(`/api/sites/1/feedback/${made.data.id}/replies`, { method: 'POST', body: { body: 'On it' } })).status, 200);
  const list = (await c('/api/sites/1/feedback')).data;
  const mine = list.find((f) => f.id === made.data.id);
  assert.equal(mine.replies[0].author_kind, 'agency');
  assert.equal((await a(`/api/sites/1/feedback/${made.data.id}`, { method: 'PATCH', body: { status: 'resolved' } })).status, 200);
  assert.equal((await c('/api/sites/1/feedback?status=open')).data.some((f) => f.id === made.data.id), false);
  // client reply reopens it
  await c(`/api/sites/1/feedback/${made.data.id}/replies`, { method: 'POST', body: { body: 'Still too small on mobile' } });
  assert.equal((await c('/api/sites/1/feedback')).data.find((f) => f.id === made.data.id).status, 'open');
});

test('feedback permissions: other clients, other people\'s comments, empty bodies', async () => {
  const c = await client();
  const a = await owner();
  const sites = (await a('/api/sites')).data;
  const other = sites.find((s) => s.client_name !== 'Harbour Physio (demo)');
  assert.equal((await c(`/api/sites/${other.id}/feedback`)).status, 403);
  assert.equal((await c(`/api/sites/${other.id}/feedback`, { method: 'POST', body: pin })).status, 403);
  assert.equal((await c('/api/sites/1/feedback', { method: 'POST', body: { ...pin, body: '  ' } })).status, 400);
  const agencyNote = (await a('/api/sites/1/feedback', { method: 'POST', body: { ...pin, body: 'Internal check' } })).data;
  assert.equal((await c(`/api/sites/1/feedback/${agencyNote.id}`, { method: 'PATCH', body: { status: 'resolved' } })).status, 403);
  assert.equal((await c(`/api/sites/1/feedback/${agencyNote.id}`, { method: 'DELETE' })).status, 403);
  assert.equal((await c(`/api/sites/1/feedback/${agencyNote.id}`, { method: 'PATCH', body: { body: 'edited' } })).status, 403);
  assert.equal((await c(`/api/sites/1/feedback/${agencyNote.id}/request`, { method: 'POST', body: {} })).status, 403);
});

test('turn feedback into a request (once)', async () => {
  const a = await owner();
  const fb = (await a('/api/sites/1/feedback', { method: 'POST', body: { ...pin, kind: 'text', body: 'Typo here', anchor: { ...pin.anchor, quote: 'Physiotheraphy' }, shape: { box: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } } } })).data;
  const r1 = (await a(`/api/sites/1/feedback/${fb.id}/request`, { method: 'POST', body: {} })).data;
  const r2 = (await a(`/api/sites/1/feedback/${fb.id}/request`, { method: 'POST', body: {} })).data;
  assert.equal(r1.request_id, r2.request_id);
  const req = (await a(`/api/requests/${r1.request_id}`)).data;
  assert.equal(req.kind, 'feedback');
  assert.match(req.body, /Highlighted: "Physiotheraphy"/);
  assert.match(req.body, new RegExp(`fb=${fb.id}`));
});

test('review links: guests view and comment; revoked or expired links stop working', async () => {
  const a = await owner();
  const link = (await a('/api/sites/1/review-links', { method: 'POST', body: { label: 'Board', target: 'live', days: 30 } })).data;
  const token = link.url.split('/review/')[1].replace(/\/$/, '');
  const page = await fetch(`${base}/review/${token}/`);
  const htmlText = await page.text();
  assert.equal(page.status, 200);
  assert.match(htmlText, /\/feedback\/overlay\.js/);
  assert.match(htmlText, /&quot;mode&quot;:&quot;guest&quot;/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex');
  assert.match(await (await fetch(`${base}/review/${token}/services`)).text(), /Services/);

  assert.equal((await pub(`/api/public/review/${token}/feedback`, { ...pin, body: 'Love it' })).status, 400, 'guest name required');
  const g = await pub(`/api/public/review/${token}/feedback`, { ...pin, body: 'Love it', guest_name: 'Priya (board)', guest_email: 'priya@example.com' });
  assert.equal(g.status, 200);
  assert.equal(g.data.author_kind, 'guest');
  assert.equal(g.data.guest_email, undefined, 'guest emails are not shown publicly');
  const pubList = (await pub(`/api/public/review/${token}/feedback`)).data;
  assert.ok(pubList.length >= 1 && pubList.every((f) => f.guest_email === undefined && f.request_id === undefined));
  assert.equal((await pub(`/api/public/review/${token}/feedback/${g.data.id}/replies`, { body: 'Also the footer', guest_name: 'Priya (board)' })).status, 200);
  // agency sees the guest email
  assert.equal((await a('/api/sites/1/feedback')).data.find((f) => f.id === g.data.id).guest_email, 'priya@example.com');
  // guests can't reach authenticated endpoints
  assert.equal((await fetch(`${base}/api/sites/1/feedback`)).status, 401);
  // a token for one site can't touch another site's comments
  const other = (await a('/api/sites')).data.find((s) => s.client_name !== 'Harbour Physio (demo)');
  const otherFb = (await a(`/api/sites/${other.id}/feedback`, { method: 'POST', body: { ...pin, body: 'other site' } })).data;
  assert.equal((await pub(`/api/public/review/${token}/feedback/${otherFb.id}/replies`, { body: 'x', guest_name: 'P' })).status, 404);

  const links = (await a('/api/sites/1/review-links')).data;
  assert.equal(links.find((l) => l.token === token).comments, 1);
  await a(`/api/sites/1/review-links/${links.find((l) => l.token === token).id}`, { method: 'DELETE' });
  assert.equal((await fetch(`${base}/review/${token}/`)).status, 404);
  assert.equal((await pub(`/api/public/review/${token}/feedback`, { ...pin, guest_name: 'X' })).status, 404);

  const exp = (await a('/api/sites/1/review-links', { method: 'POST', body: { target: 'draft', days: 7 } })).data;
  const expToken = exp.url.split('/review/')[1].replace(/\/$/, '');
  db.run("UPDATE review_links SET expires_at = datetime('now', '-1 minute') WHERE token = ?", expToken);
  assert.equal((await fetch(`${base}/review/${expToken}/`)).status, 404);
  assert.equal((await fetch(`${base}/review/not-a-real-token-123456/`)).status, 404);
});

test('preview in feedback mode loads the overlay; normal preview does not', async () => {
  const a = await owner();
  const on = await a('/preview/1/about?feedback=1');
  assert.match(on.data, /feedback\/overlay\.js/);
  assert.match(on.data, /href="\/preview\/1\/services\?feedback=1"/, 'links stay in feedback mode');
  const off = await a('/preview/1/about');
  assert.doesNotMatch(off.data, /overlay\.js/);
  const overlay = await fetch(`${base}/feedback/overlay.js`);
  assert.equal(overlay.status, 200);
  assert.doesNotMatch(await overlay.text(), /innerHTML/, 'overlay never uses innerHTML');
});
