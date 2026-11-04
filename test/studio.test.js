import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';
import { planSchedule, merge, detectProvider, embedUrl } from '../server/lib/studio.js';
import { studioDaily } from '../server/lib/jobs.js';
import { senderFor } from '../server/lib/mail.js';

let server, base, dir, db;
const addDays = (n, from = new Date()) => new Date(from.getTime() + n * 864e5).toISOString().slice(0, 10);
const SIG = 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'.repeat(6);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kc-studio-'));
  db = openDb(':memory:');
  seedDemo(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); delete process.env.MAIL_VERIFIED_DOMAINS; });

async function login(email, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `login ${email}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(base + path, { method, headers: { Cookie: cookie, 'X-Kess': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text(), headers: res.headers };
  };
}
const georgia = () => login('georgia@kess.media', 'georgia-demo-2026');
const pub = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: (r.headers.get('content-type') || '').includes('json') ? await r.json() : await r.text() }; };

test('payment plan maths: exact totals, dates relative to the shoot, never in the past', () => {
  const today = '2026-11-04';
  const steps = [{ label: 'Deposit', percent: 33, when: 'accept', due_days: 3 }, { label: 'Middle', percent: 33, when: 'before_shoot', days: 14, due_days: 7 }, { label: 'Balance', percent: 34, when: 'after_shoot', days: 2, due_days: 14 }];
  const s = planSchedule(steps, { shoot_date: '2026-12-20' }, 100001, today);
  assert.equal(s.reduce((n, x) => n + x.cents, 0), 100001, 'sums exactly');
  assert.deepEqual(s.map((x) => x.send_on), ['2026-11-04', '2026-12-06', '2026-12-22']);
  assert.deepEqual(s.map((x) => x.due_date), ['2026-11-07', '2026-12-13', '2027-01-05']);
  // shoot soon: "14 days before" would be in the past, so it sends today and is due by the shoot
  const soon = planSchedule([{ percent: 50, when: 'accept' }, { percent: 50, when: 'before_shoot', days: 14, due_days: 7 }], { shoot_date: '2026-11-08' }, 2000, today);
  assert.equal(soon[1].send_on, today);
  assert.equal(soon[1].due_date, '2026-11-08');
  // no shoot date: falls back to today
  assert.equal(planSchedule([{ percent: 100, when: 'before_shoot', days: 7 }], { shoot_date: null }, 500, today)[0].send_on, today);
});

test('merge fields, providers and embeds', () => {
  assert.equal(merge('Hi {{first_name}}, see {{ unknown }} on {{shoot_date}}', { first_name: 'Maya', shoot_date: '20/12/2026' }), 'Hi Maya, see {{ unknown }} on 20/12/2026');
  assert.equal(detectProvider('https://www.dropbox.com/scl/fo/abc'), 'dropbox');
  assert.equal(detectProvider('https://drive.google.com/drive/folders/x'), 'google_drive');
  assert.equal(detectProvider('https://kess.picflow.com/gallery/x'), 'picflow');
  assert.equal(detectProvider('https://f.io/abc'), 'frameio');
  assert.equal(detectProvider('https://vimeo.com/123'), 'vimeo');
  assert.equal(detectProvider('https://example.com/x'), 'link');
  assert.throws(() => detectProvider('http://dropbox.com/x'), /https/);
  assert.throws(() => detectProvider('javascript:alert(1)'), /https/);
  assert.equal(embedUrl('https://vimeo.com/76979871/abc123'), 'https://player.vimeo.com/video/76979871?h=abc123');
  assert.equal(embedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://www.dropbox.com/x'), null);
});

test('emails are sent as the staff member: verified domain uses her address, otherwise her name + reply-to', () => {
  const g = db.get("SELECT * FROM users WHERE email = 'georgia@kess.media'");
  delete process.env.MAIL_VERIFIED_DOMAINS;
  const a = senderFor(db, g);
  assert.equal(a.from, 'Georgia at Kess Media <hello@kess.media>');
  assert.equal(a.replyTo, 'georgia@kess.media');
  process.env.MAIL_VERIFIED_DOMAINS = 'kess.media';
  const b = senderFor(db, g);
  assert.equal(b.from, 'Georgia <georgia@kess.media>');
  assert.equal(b.verified, true);
  delete process.env.MAIL_VERIFIED_DOMAINS;
});

test('Georgia: new client + shoot, send quote, client signs and books online, invoices and workflow follow', async () => {
  const g = await georgia();
  const shoot = addDays(30);
  const pkgs = (await g('/api/studio/packages')).data;
  const plan = (await g('/api/studio/payment-plans')).data.find((p) => p.name.startsWith('50%'));
  const tpl = (await g('/api/studio/contract-templates')).data[0];
  const wf = (await g('/api/studio/workflows')).data[0];
  const qn = (await g('/api/studio/questionnaires')).data[0];
  const created = await g('/api/studio/jobs', { method: 'POST', body: { title: 'Conference photos', client_name: 'Acme Events', contact_name: 'Jess Lee', client_email: 'jess@acme.example', shoot_date: shoot, start_time: '08:30', end_time: '16:00', location: 'ICC Sydney',
    package_ids: [pkgs[0].id], payment_plan_id: plan.id, contract_template_id: tpl.id, workflow_id: wf.id, questionnaire_id: qn.id } });
  assert.equal(created.status, 200);
  const job = created.data;
  assert.equal(job.owner.name, 'Georgia (demo)', 'creator owns the job');
  assert.equal(job.lines.length, 1);
  // add an optional drone add-on
  const drone = pkgs.find((p) => p.name.startsWith('Drone'));
  let j = (await g(`/api/studio/jobs/${job.id}/lines`, { method: 'POST', body: { package_id: drone.id } })).data;
  const droneLine = j.lines.find((l) => l.description.startsWith('Drone'));
  j = (await g(`/api/studio/jobs/${job.id}/lines/${droneLine.id}`, { method: 'PATCH', body: { optional: true, selected: false } })).data;
  assert.equal(j.totals.subtotal_cents, pkgs[0].price_cents, 'unselected optional not counted');

  const sent = await g(`/api/studio/jobs/${job.id}/send-quote`, { method: 'POST', body: {} });
  assert.equal(sent.status, 200);
  assert.equal(sent.data.status, 'quoted');
  assert.ok(sent.data.contract && sent.data.contract.status === 'sent');
  assert.match(sent.data.contract.body, /Acme Events/);
  assert.doesNotMatch(sent.data.contract.body, /\{\{[a-z_]+\}\}/, 'all merge fields filled');
  const mail = db.get("SELECT * FROM outbox WHERE to_addr = 'jess@acme.example' ORDER BY id DESC LIMIT 1");
  assert.match(mail.subject, /Your quote for Conference photos/);
  assert.equal(mail.reply_to, 'georgia@kess.media');
  assert.match(mail.from_addr, /^Georgia at Kess Media/);
  assert.match(mail.body, new RegExp(`/j/${job.token}`));

  // client page (no login)
  const page = await pub(`/j/${job.token}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /here's your quote/);
  assert.match(page.data, /Conference photos/);
  assert.match(page.data, /optional/);

  // accept without signing fails; with signature succeeds, choosing the add-on
  assert.equal((await pub(`/api/public/jobs/${job.token}/accept`, { selected: [] })).status, 400);
  assert.equal((await pub(`/api/public/jobs/${job.token}/accept`, { signed_name: 'Jess Lee', signature: SIG })).status, 400, 'must tick agree');
  const acc = await pub(`/api/public/jobs/${job.token}/accept`, { selected: [droneLine.id], signed_name: 'Jess Lee', signature: SIG, agree: true });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  assert.match(acc.data.pay_url, /^\/i\//);
  assert.equal((await pub(`/api/public/jobs/${job.token}/accept`, { signed_name: 'Jess Lee', signature: SIG, agree: true })).status, 400, 'cannot accept twice');

  const after = (await g(`/api/studio/jobs/${job.id}`)).data;
  assert.equal(after.status, 'booked');
  assert.equal(after.contract.status, 'signed');
  assert.equal(after.contract.signed_name, 'Jess Lee');
  assert.equal(after.totals.subtotal_cents, pkgs[0].price_cents + drone.price_cents, 'add-on included');
  assert.equal(after.invoices.length, 2);
  const [dep, bal] = after.invoices;
  assert.equal(dep.status, 'sent');
  assert.equal(bal.status, 'draft');
  assert.equal(bal.send_on, addDays(-14, new Date(shoot + 'T00:00:00Z')), 'balance scheduled 14 days before the shoot');
  assert.equal(dep.subtotal_cents + bal.subtotal_cents, after.totals.subtotal_cents, 'plan adds up to the quote');
  assert.ok(after.steps.length >= 5);
  assert.equal(after.steps.find((s) => s.name === 'Thank you for booking').status, 'done', 'booking email ran');
  assert.ok(after.questionnaire, 'questionnaire attached');

  // invoice page and its rules
  const invPage = await pub(acc.data.pay_url);
  assert.equal(invPage.status, 200);
  assert.match(invPage.data, new RegExp(dep.number));
  const draftTok = db.get('SELECT public_token FROM invoices WHERE id = ?', bal.id).public_token;
  assert.equal((await pub(`/i/${draftTok}`)).status, 404, 'scheduled invoices are not public yet');
  assert.equal((await pub(`/api/public/invoices/${draftTok}/pay`, {})).status, 404);
  const pay = await pub(`/api/public/invoices/${acc.data.pay_url.split('/i/')[1]}/pay`, {});
  assert.equal(pay.status, 400, 'Stripe not configured in tests');

  // questionnaire
  const q = after.questionnaire.questions.questions;
  assert.equal((await pub(`/api/public/jobs/${job.token}/questionnaire`, { answers: {}, submit: true })).status, 400, 'required answers');
  assert.equal((await pub(`/api/public/jobs/${job.token}/questionnaire`, { answers: { contact: 'Sam 0400 000 000' }, submit: false })).status, 200, 'draft save');
  const answers = Object.fromEntries(q.map((x) => [x.id, x.type === 'checkbox' ? true : 'Answer']));
  assert.equal((await pub(`/api/public/jobs/${job.token}/questionnaire`, { answers, submit: true })).status, 200);
  assert.ok((await g(`/api/studio/jobs/${job.id}`)).data.questionnaire.submitted_at);
  const booked = await pub(`/j/${job.token}`);
  assert.match(booked.data, /you're booked/);
  assert.match(booked.data, /Agreement <em>signed<\/em>/);

  // moving the shoot moves pending steps
  const pending = after.steps.find((s) => s.status === 'pending' && s.due_date);
  const moved = (await g(`/api/studio/jobs/${job.id}`, { method: 'PATCH', body: { shoot_date: addDays(7, new Date(shoot + 'T00:00:00Z')) } })).data;
  assert.equal(moved.steps.find((s) => s.id === pending.id).due_date, addDays(7, new Date(pending.due_date + 'T00:00:00Z')));
  assert.equal(moved.invoices.find((i) => i.id === bal.id).send_on, addDays(7, new Date(bal.send_on + 'T00:00:00Z')), 'scheduled balance moves with the shoot');

  // deliveries
  assert.equal((await g(`/api/studio/jobs/${job.id}/deliveries`, { method: 'POST', body: { url: 'http://dropbox.com/x' } })).status, 400);
  const d = (await g(`/api/studio/jobs/${job.id}/deliveries`, { method: 'POST', body: { url: 'https://vimeo.com/76979871', label: 'Highlight film', notify: true } })).data;
  assert.equal(d.deliveries[0].provider, 'vimeo');
  assert.equal(d.status, 'delivered');
  assert.match((await pub(`/j/${job.token}`)).data, /player\.vimeo\.com\/video\/76979871/);
});

test('daily studio jobs: scheduled invoices go out, due reminders once, workflow emails run, lost jobs are skipped', () => {
  // a lost job's scheduled invoice never sends
  const lost = db.get("SELECT * FROM jobs WHERE title = 'Team headshots + clinic video'");
  const lostDraft = db.get("SELECT * FROM invoices WHERE job_id = ? AND status = 'draft'", lost.id);
  db.run("UPDATE jobs SET status = 'lost' WHERE id = ?", lost.id);
  assert.ok(!studioDaily(db, lostDraft.send_on).invoices_sent.includes(lostDraft.number));
  assert.equal(db.get('SELECT status FROM invoices WHERE id = ?', lostDraft.id).status, 'draft');
  db.run("UPDATE jobs SET status = 'booked' WHERE id = ?", lost.id);

  const job = db.get("SELECT * FROM jobs WHERE title = 'Conference photos'");
  const draft = db.get("SELECT * FROM invoices WHERE job_id = ? AND status = 'draft'", job.id);
  const before = studioDaily(db, addDays(-1, new Date(draft.send_on + 'T00:00:00Z')));
  assert.ok(!before.invoices_sent.includes(draft.number), 'not before its date');
  const on = studioDaily(db, draft.send_on);
  assert.ok(on.invoices_sent.includes(draft.number));
  assert.equal(db.get('SELECT status FROM invoices WHERE id = ?', draft.id).status, 'sent');
  const dueDay = db.get('SELECT due_date FROM invoices WHERE id = ?', draft.id).due_date;
  const r1 = studioDaily(db, addDays(-2, new Date(dueDay + 'T00:00:00Z')));
  assert.ok(r1.due_reminders.includes(draft.number));
  assert.ok(!studioDaily(db, addDays(-1, new Date(dueDay + 'T00:00:00Z'))).due_reminders.includes(draft.number), 'only once');
  assert.ok(on.emails.length + r1.emails.length >= 1 || db.get("SELECT COUNT(*) n FROM job_steps WHERE job_id = ? AND action = 'email' AND status = 'done'", job.id).n >= 2);

});

test('calendar feed, access control and job deletion guard', async () => {
  const g = await georgia();
  const links = (await g('/api/studio/calendar-link')).data;
  const ics = await fetch(links.mine).then((r) => r.text());
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART;TZID=Australia\/Sydney:\d{8}T083000/);
  assert.match(ics, /SUMMARY:Conference photos · Acme Events/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75), 'lines folded');
  assert.equal((await fetch(`${base}/cal/not-a-real-calendar-token-000.ics`)).status, 404);
  const reset = (await g('/api/studio/calendar-link?reset=1')).data;
  assert.equal((await fetch(links.mine)).status, 404, 'old link stops working after reset');
  assert.equal((await fetch(reset.mine)).status, 200);

  const client = await login('sam@harbourphysio.example', 'client-demo-2026');
  assert.equal((await client('/api/studio/jobs')).status, 403);
  assert.equal((await client('/api/studio/packages')).status, 403);
  const job = db.get("SELECT id FROM jobs WHERE title = 'Conference photos'");
  assert.equal((await g(`/api/studio/jobs/${job.id}`, { method: 'DELETE' })).status, 403, 'staff cannot delete');
  const owner = await login('alex@kess.media', 'kessmedia-demo-2026');
  assert.equal((await owner(`/api/studio/jobs/${job.id}`, { method: 'DELETE' })).status, 400, 'jobs with sent invoices are kept');
  assert.equal((await pub('/j/not-a-real-token-but-long-enough-xx')).status, 404);
});

test('enquiry form creates a lead and a shoot, replies, and rejects junk', async () => {
  const page = await fetch(`${base}/enquiry`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), null, 'embeddable');
  assert.equal((await pub('/api/public/enquiry', { name: 'X', email: 'bad', message: 'hi' })).status, 400);
  assert.equal((await pub('/api/public/enquiry', { name: 'Bot', email: 'b@b.co', message: 'x', _hp: 'yes' })).status, 200);
  assert.equal(db.get("SELECT COUNT(*) n FROM clients WHERE email = 'b@b.co'").n, 0, 'honeypot ignored');
  const r = await pub('/api/public/enquiry', { name: 'Nina Park', email: 'Nina@Example.com', phone: '0400 111 222', organisation: 'Park Studio', category: 'video', package: 'Highlight film (60–90 seconds)', date: addDays(60), location: 'Bondi', message: 'Launch film please' });
  assert.equal(r.status, 200);
  const c = db.get("SELECT * FROM clients WHERE email = 'nina@example.com'");
  assert.equal(c.name, 'Park Studio');
  const job = db.get('SELECT * FROM jobs WHERE client_id = ?', c.id);
  assert.equal(job.status, 'enquiry');
  assert.equal(job.category, 'video');
  assert.match(job.notes, /Launch film please/);
  assert.ok(db.get("SELECT 1 FROM outbox WHERE to_addr = 'nina@example.com' AND subject LIKE 'Thanks for your enquiry%'"));
  // same email again reuses the client
  await pub('/api/public/enquiry', { name: 'Nina Park', email: 'nina@example.com', message: 'Also photos' });
  assert.equal(db.get("SELECT COUNT(*) n FROM clients WHERE email = 'nina@example.com'").n, 1);
});
