import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';
import { hotp, totp, verifyTotp, base32Encode, base32Decode } from '../server/lib/totp.js';
import { verifyStripeSignature } from '../server/lib/stripe.js';
import { signS3 } from '../server/lib/backup.js';
import { overdueReminders, monthlyReports } from '../server/lib/jobs.js';

let server, base, dir, db;
const WH_SECRET = 'whsec_test_123';

before(async () => {
  process.env.STRIPE_WEBHOOK_SECRET = WH_SECRET;
  dir = mkdtempSync(join(tmpdir(), 'kc-feat-'));
  db = openDb(':memory:');
  seedDemo(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.STRIPE_WEBHOOK_SECRET; });

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1', ...headers }, body: JSON.stringify(body) });
async function login(email, password, code) {
  const r = await post('/api/auth/login', { email, password, code });
  const data = await r.json();
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  const call = async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-Kess': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  return { status: r.status, data, call };
}
const owner = () => login('alex@kess.media', 'kessmedia-demo-2026').then((l) => l.call);

test('TOTP matches RFC 4226 / 6238 test vectors', () => {
  const key = Buffer.from('12345678901234567890');
  assert.deepEqual(['755224', '287082', '359152', '969429', '338314'], [0, 1, 2, 3, 4].map((c) => hotp(key, c)));
  assert.equal(totp(key, 59_000, 30, 8), '94287082');
  assert.equal(totp(key, 1111111109_000, 30, 8), '07081804');
  assert.equal(totp(key, 1234567890_000, 30, 8), '89005924');
  assert.deepEqual(base32Decode(base32Encode(key)), key);
});

test('two-factor sign-in: setup, enforce, reset link cannot skip it, disable', async () => {
  const c = (await login('sam@harbourphysio.example', 'client-demo-2026')).call;
  const setup = (await c('/api/auth/2fa/setup', { method: 'POST', body: {} })).data;
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.equal((await c('/api/auth/2fa/enable', { method: 'POST', body: { code: '000000' } })).status, 400);
  assert.equal((await c('/api/auth/2fa/enable', { method: 'POST', body: { code: totp(setup.secret) } })).status, 200);

  const noCode = await login('sam@harbourphysio.example', 'client-demo-2026');
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.need_code, true);
  assert.equal((await login('sam@harbourphysio.example', 'client-demo-2026', '123456')).status, 401);
  const withCode = await login('sam@harbourphysio.example', 'client-demo-2026', totp(setup.secret));
  assert.equal(withCode.status, 200);

  // A reset link must not sign the user in when 2FA is on.
  const a = await owner();
  const users = (await a('/api/clients/1')).data.users;
  const link = (await a(`/api/users/${users[0].id}/reset`, { method: 'POST', body: {} })).data.invite_url;
  const token = link.split('/invite/')[1];
  const r = await post(`/api/auth/invite/${token}`, { password: 'client-demo-2026' });
  const body = await r.json();
  assert.equal(body.need_login, true);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal((await withCode.call('/api/auth/me')).data.user, null, 'old sessions are signed out after a reset');

  const again = (await login('sam@harbourphysio.example', 'client-demo-2026', totp(setup.secret))).call;
  assert.equal((await again('/api/auth/2fa/disable', { method: 'POST', body: { password: 'wrong' } })).status, 400);
  assert.equal((await again('/api/auth/2fa/disable', { method: 'POST', body: { password: 'client-demo-2026' } })).status, 200);
  assert.equal((await login('sam@harbourphysio.example', 'client-demo-2026')).status, 200);
});

test('forgot password emails a link and does not reveal unknown accounts', async () => {
  const before = db.get('SELECT COUNT(*) n FROM outbox').n;
  const known = await post('/api/auth/forgot', { email: 'alex@kess.media' });
  const unknown = await post('/api/auth/forgot', { email: 'nobody@example.com' });
  assert.equal(known.status, 200);
  assert.deepEqual(await known.json(), await unknown.json());
  const mails = db.all('SELECT * FROM outbox ORDER BY id DESC LIMIT 5');
  assert.equal(db.get('SELECT COUNT(*) n FROM outbox').n, before + 1);
  assert.equal(mails[0].to_addr, 'alex@kess.media');
  assert.match(mails[0].body, /#\/invite\/[\w-]+/);
  assert.equal(mails[0].status, 'logged', 'no provider configured in tests');
});

test('notifications are emailed to users who opted in, not to others', async () => {
  const c = (await login('sam@harbourphysio.example', 'client-demo-2026')).call;
  await c('/api/auth/prefs', { method: 'PATCH', body: { email_notify: false } });
  const a = await owner();
  const n0 = db.get("SELECT COUNT(*) n FROM outbox WHERE to_addr = 'sam@harbourphysio.example'").n;
  await a('/api/requests', { method: 'POST', body: { client_id: 1, title: 'Opt-out check' } });
  assert.equal(db.get("SELECT COUNT(*) n FROM outbox WHERE to_addr = 'sam@harbourphysio.example'").n, n0, 'opted out: no email');
  await c('/api/auth/prefs', { method: 'PATCH', body: { email_notify: true } });
  await a('/api/requests', { method: 'POST', body: { client_id: 1, title: 'Opt-in check' } });
  const last = db.get("SELECT * FROM outbox WHERE to_addr = 'sam@harbourphysio.example' ORDER BY id DESC LIMIT 1");
  assert.match(last.subject, /Opt-in check/);
  assert.match(last.body, /Open in Kess Cloud: http/);
});

test('Stripe: pay is refused without keys; signed webhook marks invoice paid once', async () => {
  const a = await owner();
  const inv = (await a('/api/invoices?status=sent')).data[0];
  const c = (await login('sam@harbourphysio.example', 'client-demo-2026')).call;
  const mine = (await c('/api/invoices')).data.find((i) => i.status === 'sent');
  const pay = await c(`/api/invoices/${mine.id}/pay`, { method: 'POST', body: {} });
  assert.equal(pay.status, 400);
  assert.match(pay.data.error, /not set up/);

  const event = (amount) => JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', amount_total: amount, client_reference_id: String(inv.id), metadata: { invoice_id: String(inv.id) } } } });
  const sign = (raw, t = Math.floor(Date.now() / 1000), secret = WH_SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
  const hook = (raw, sig) => fetch(`${base}/api/public/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: raw });

  const good = event(inv.total_cents);
  assert.equal((await hook(good, sign(good, undefined, 'whsec_wrong'))).status, 400, 'wrong secret');
  assert.equal((await hook(good, sign(good, Math.floor(Date.now() / 1000) - 3600))).status, 400, 'replayed/old timestamp');
  const wrongAmount = event(inv.total_cents - 100);
  assert.equal((await hook(wrongAmount, sign(wrongAmount))).status, 200);
  assert.equal((await a(`/api/invoices/${inv.id}`)).data.status, 'sent', 'amount mismatch does not mark paid');
  assert.equal((await hook(good, sign(good))).status, 200);
  const paid = (await a(`/api/invoices/${inv.id}`)).data;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paid_via, 'stripe');
  assert.equal((await hook(good, sign(good))).status, 200, 'duplicate delivery is harmless');
  assert.equal(db.get("SELECT COUNT(*) n FROM activity WHERE action = 'invoice.paid' AND detail LIKE ?", `${inv.number}%`).n, 1);
  assert.equal(verifyStripeSignature('x', 't=1,v1=abc', WH_SECRET), false);
});

test('backups: snapshot contains a working database and uploaded files', async () => {
  const a = await owner();
  await a('/api/assets', { method: 'POST', body: { client_id: 1, filename: 'note.txt', mime: 'text/plain', data: Buffer.from('hello').toString('base64') } });
  const r = await a('/api/backups', { method: 'POST', body: {} });
  assert.equal(r.status, 200);
  const list = (await a('/api/backups')).data;
  assert.equal(list[0].name, r.data.name);
  const dl = await a(`/api/backups/${r.data.name}`);
  const tar = gunzipSync(dl.data);
  const names = [];
  let dbBuf;
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString().replace(/\0.*$/, '');
    const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (name.endsWith('kess-cloud.db')) dbBuf = tar.subarray(off + 512, off + 512 + size);
    names.push(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(names.some((n) => n.includes('/assets/')), 'assets included');
  assert.ok(dbBuf && dbBuf.subarray(0, 15).toString() === 'SQLite format 3', 'database snapshot included');
  const restorePath = join(dir, 'restore.db');
  (await import('node:fs')).writeFileSync(restorePath, dbBuf);
  const restored = openDb(restorePath);
  assert.ok(restored.get('SELECT COUNT(*) n FROM clients').n >= 3);
  restored.close();
  assert.equal((await a('/api/backups/..%2Fkess.db')).status, 404, 'no path traversal');
  const c = (await login('sam@harbourphysio.example', 'client-demo-2026')).call;
  assert.equal((await c('/api/backups')).status, 403);
});

test('S3 signing matches the AWS documented example', () => {
  const h = signS3({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { Range: 'bytes=0-9' }, payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', region: 'us-east-1', keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') });
  assert.match(h.authorization, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('overdue reminders go out at most weekly; monthly reports once per month', () => {
  const today = new Date().toISOString().slice(0, 10);
  const inv = db.get("SELECT id FROM invoices WHERE status = 'sent' LIMIT 1");
  db.run("UPDATE invoices SET due_date = date('now', '-10 days'), reminded_at = NULL WHERE id = ?", inv.id);
  const first = overdueReminders(db, today);
  assert.ok(first.length >= 1);
  assert.deepEqual(overdueReminders(db, today), [], 'not again the same week');
  const in8 = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10);
  assert.ok(overdueReminders(db, in8).length >= 1, 'again a week later');

  const month = '2030-01';
  const sent = monthlyReports(db, month);
  assert.ok(sent.includes('Harbour Physio'));
  assert.deepEqual(monthlyReports(db, month), []);
  assert.ok(db.get("SELECT 1 FROM notifications WHERE link LIKE '%/report?month=2030-01'"));
});

test('monthly report: JSON for the portal, HTML page, access controlled', async () => {
  const c = (await login('sam@harbourphysio.example', 'client-demo-2026')).call;
  const month = new Date().toISOString().slice(0, 7);
  const r = (await c(`/api/sites/1/report?month=${month}`)).data;
  assert.ok(r.views > 0);
  assert.equal(r.series.length, Number(new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate()));
  const page = await c(`/reports/sites/1?month=${month}`);
  assert.equal(page.status, 200);
  assert.match(page.data.toString(), /monthly website report/);
  const a = await owner();
  const other = (await a('/api/sites')).data.find((s) => s.client_name !== 'Harbour Physio (demo)');
  assert.equal((await c(`/reports/sites/${other.id}`)).status, 403);
});
