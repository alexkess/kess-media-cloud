// Socials end to end: the API on a real server with demo data, with Anthropic, Publer, Shopify, Sanity and Supabase
// faked by replacing globalThis.fetch. Proves nothing reaches Publer without SOCIALS_SEND=1.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { seedDemo } from '../server/seed.js';
import { makeStore } from '../server/lib/socials/store.js';
import { sydneyDate, sydneyLocalToIso, shiftDate } from '../server/lib/socials/dates.js';
import { accountTimes } from '../server/lib/socials/slots.js';
import { anthropicCaptionClient } from '../server/lib/socials/captions.js';
import { runSuggest } from '../server/lib/socials/suggest.js';
import { socialsTick } from '../server/lib/socials/jobs.js';
import { fetchSupabaseTables, importSocials } from '../server/lib/socials/importer.js';
import { seedSocialsDemo } from '../server/lib/socials/seed.js';
import { like, json } from './socials-helpers.js';

const SWITCHES = ['SOCIALS_SEND', 'SOCIALS_JOBS', 'PUBLER_API_KEY', 'PUBLER_WORKSPACE_ID', 'ANTHROPIC_API_KEY', 'SOCIALS_CAPTION_MODEL', 'SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'];
const saved = Object.fromEntries(SWITCHES.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;
let server, base, dir, db, store;
const calls = [];
const hostCalls = (h) => calls.filter((c) => new URL(c.url).host.endsWith(h));

// ---------- fakes ----------
const P = { jobs: new Map(), n: 0, failJob: false };
const A = { reply: null, statuses: [] };
function anthropicReply(body) {
  const accounts = [...body.messages[0].content.matchAll?.(/account_id (\S+):/g) ?? String(typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.at(-1).text).matchAll(/account_id (\S+):/g)].map((m) => m[1]);
  return A.reply ?? { base: 'Fresh caption.', variants: accounts.map((id) => ({ account_id: id, caption: `Fresh caption for ${id}.` })) };
}
async function fake(url, init = {}) {
  const u = new URL(url);
  const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ url: u.href, method: init.method || 'GET', headers: init.headers || {}, body });
  if (u.host === 'app.publer.com') {
    if (u.pathname.endsWith('/media/from-url')) { const id = `job${++P.n}`; P.jobs.set(id, { status: 'complete', payload: [{ id: `media-${P.n}` }] }); return json({ job_id: id }); }
    if (u.pathname.includes('/posts/schedule')) { const id = `job${++P.n}`; P.jobs.set(id, P.failJob ? { status: 'failed' } : { status: 'complete', payload: { failures: {} } }); return json({ job_id: id }); }
    if (u.pathname.includes('/job_status/')) return json(P.jobs.get(u.pathname.split('/').pop()) ?? { status: 'failed' });
    return json({ error: 'no fake' }, 404);
  }
  if (u.host === 'api.anthropic.com') {
    const status = A.statuses.shift();
    if (status) return json({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, status);
    if (A.refuse) return json({ stop_reason: 'refusal', content: [] });
    return json({ id: 'msg', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(anthropicReply(body)) }] });
  }
  if (u.host === 'kess-test.myshopify.com') {
    if (u.pathname === '/admin/oauth/access_token') return json({ access_token: 'shop-token' });
    const product = { id: 'gid://shopify/Product/77', handle: 'turquoise-pool', title: 'Turquoise Pool', options: [{ name: 'Print Style', values: ['Acrylic'] }], priceRangeV2: { minVariantPrice: { amount: '300.0' } },
      media: { nodes: [{ id: 'gid://shopify/MediaImage/1', image: { url: 'https://cdn.shopify.com/s/files/1/0054/8477/3427/products/tp-1.jpg', width: 2000, height: 2000 } }, { id: 'gid://shopify/MediaImage/2', image: { url: 'https://cdn.shopify.com/s/files/1/0054/8477/3427/products/tp-2.jpg', width: 2000, height: 2000 } }] } };
    return json({ data: { products: { nodes: [product], pageInfo: { hasNextPage: false, endCursor: null } } } });
  }
  if (u.host === 'cdn.shopify.com') return new Response(null, { status: u.pathname.includes('turquoise-pool-map-poster') ? 200 : 404, headers: { 'content-type': u.pathname.includes('turquoise') ? 'image/jpeg' : 'text/html' } });
  if (u.host === 'sdgel12z.api.sanity.io') return json({ result: { projects: [{ _id: 'kmp1', title: 'DAFF Meat Exports', client: 'DAFF', slug: 'daff', imgs: [{ key: 'hero', ref: 'image-aaa-3840x2160-jpg' }] }], services: [], posts: [] } });
  if (u.host === 'gwwzy02m.api.sanity.io') return json({ result: { projects: [{ _id: 'akp1', _type: 'project', title: 'Aerials', slug: 'aerials', cover: { ref: 'image-bbb-2500x1667-jpg' }, gallery: [] }], commissions: [], essays: [] } });
  if (u.host === 'supabase.test') return supabase(u);
  return realFetch(url, init);
}

before(async () => {
  globalThis.fetch = fake;
  for (const k of SWITCHES) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), 'kc-socials-'));
  db = openDb(':memory:');
  seedDemo(db);
  store = makeStore(db);
  ({ server } = createApp({ db, dataDir: dir }));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => {
  server.close();
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => { delete process.env.SOCIALS_SEND; delete process.env.SOCIALS_JOBS; });

async function login(email, password) {
  const r = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Kess': '1' }, body: JSON.stringify({ email, password }) });
  assert.equal(r.status, 200, `login ${email}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, kess = true } = {}) => {
    const res = await realFetch(base + path, { method, headers: { Cookie: cookie, ...(kess ? { 'X-Kess': '1' } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
}
const owner = () => login('alex@kess.media', 'kessmedia-demo-2026');
const brandOf = (roster, b) => roster.brands.find((x) => x.brand === b);

test('socials API is agency only and keeps the CSRF guard', async () => {
  const anon = await realFetch(`${base}/api/socials/roster`);
  assert.equal(anon.status, 401);
  const sam = await login('sam@harbourphysio.example', 'client-demo-2026');
  assert.equal((await sam('/api/socials/roster')).status, 403);
  assert.equal((await sam('/api/socials/ledger')).status, 403);
  const georgia = await login('georgia@kess.media', 'georgia-demo-2026');
  assert.equal((await georgia('/api/socials/roster')).status, 200);
  assert.equal((await georgia('/api/socials/run/sync', { method: 'POST', body: {} })).status, 403, 'jobs by hand are owner only');
  const a = await owner();
  const r = await a('/api/socials/roster');
  const card = brandOf(r.data, 'gallery').cards[0];
  assert.equal((await a(`/api/socials/cards/${card.suggestionId}/decide`, { method: 'POST', body: { decision: 'later' }, kess: false })).status, 403);
});

test('roster: three brands, today with Previous day only, cards with captions, carousel options and windows', async () => {
  const a = await owner();
  const { data } = await a('/api/socials/roster');
  assert.equal(data.date, sydneyDate(new Date()));
  assert.equal(data.age, 0);
  assert.equal(data.nextDate, null);
  assert.equal(data.prevDate, shiftDate(data.date, -1));
  assert.deepEqual(data.brands.map((b) => b.brand), ['gallery', 'kessmedia', 'alexkess']);
  like(data.status, { sending: false, jobs: false, model: 'claude-sonnet-5-5' });
  for (const b of data.brands) assert.ok(b.cards.length >= 1 && b.cards.length <= 3, b.brand);
  const g = brandOf(data, 'gallery');
  assert.equal(g.windows.filter((w) => !w.takenBy).length, 6);
  assert.ok(g.cards.every((c) => c.variants.length === 4 && c.baseCaption));
  const stanwell = g.cards.find((c) => c.primary.title === 'Stanwell Park Sunrise Pano');
  if (stanwell) assert.ok(stanwell.siblings.some((s) => s.mapPoster) && stanwell.siblings.some((s) => s.source === 'studio'), 'map poster and mockup are carousel options');
  // a date outside the roster falls back to today
  assert.equal((await a('/api/socials/roster?date=2020-01-01')).data.date, data.date);
});

test('Later rests one image 14 days, Never retires it, Restore brings it back', async () => {
  const a = await owner();
  const { data } = await a('/api/socials/roster');
  const [c1, c2] = brandOf(data, 'alexkess').cards;
  assert.equal((await a(`/api/socials/cards/${c1.suggestionId}/decide`, { method: 'POST', body: { decision: 'later' } })).status, 200);
  assert.equal(store.getSuggestion(c1.suggestionId).decision, 'later');
  assert.equal((await a(`/api/socials/cards/${c2.suggestionId}/decide`, { method: 'POST', body: { decision: 'never' } })).status, 200);
  like(store.getItems([c2.item.id])[0], { status: 'retired', retiredReason: 'never' });
  const ledger = (await a('/api/socials/ledger')).data;
  assert.ok(ledger.retired.some((i) => i.id === c2.item.id && i.reason === 'never'));
  assert.equal((await a(`/api/socials/items/${c2.item.id}/restore`, { method: 'POST', body: {} })).status, 200);
  like(store.getItems([c2.item.id])[0], { status: 'active', retiredReason: null });
  const after = brandOf((await a('/api/socials/roster')).data, 'alexkess').cards.find((c) => c.suggestionId === c1.suggestionId);
  assert.equal(after.decision, 'later', 'a decided card shows as a receipt');
});

test('carousel: tick siblings (up to 4 extra), Make primary, captions per account, conform and mention chips', async () => {
  const a = await owner();
  const g = brandOf((await a('/api/socials/roster')).data, 'gallery');
  const card = g.cards.find((c) => c.siblings.length >= 1);
  const sib = card.siblings[0];
  await a(`/api/socials/posts/${card.postId}/siblings`, { method: 'POST', body: { ids: [sib.id] } });
  assert.deepEqual(store.getPost(card.postId).itemIds, [card.item.id, sib.id]);
  await a(`/api/socials/posts/${card.postId}/primary`, { method: 'POST', body: { itemId: sib.id } });
  assert.deepEqual(store.getPost(card.postId).itemIds, [sib.id, card.item.id]);
  await a(`/api/socials/posts/${card.postId}/primary`, { method: 'POST', body: { itemId: card.item.id } });

  const [ig, ...others] = card.variants;
  assert.equal((await a(`/api/socials/variants/${ig.id}`, { method: 'PATCH', body: { caption: 'Mine.\n\n#wallart #fineartphotography #kessgallery' } })).status, 200);
  like(store.getVariant(ig.id), { caption: 'Mine.\n\n#wallart #fineartphotography #kessgallery', edited: true });
  await a(`/api/socials/posts/${card.postId}/conform`, { method: 'POST', body: { variantId: ig.id, caption: 'Mine.\n\n#wallart #fineartphotography #kessgallery' } });
  const vs = store.variants(card.postId);
  assert.equal(vs.find((v) => v.platform === 'facebook').caption, 'Mine.\n\n#wallart #fineartphotography', 'Kess Gallery Facebook keeps 2 hashtags');
  assert.equal(vs.find((v) => v.platform === 'google').caption, 'Mine.');
  assert.ok(vs.every((v) => v.edited));
  assert.equal(others.length, 3);

  // mention chip: Alex Kess is suggested on every Kess Gallery card (curated list, from the seed)
  const fresh = brandOf((await a('/api/socials/roster')).data, 'gallery').cards.find((c) => c.postId === card.postId);
  const chip = fresh.mentions.find((m) => m.name === 'Alex Kess');
  assert.ok(chip && !chip.added);
  await a(`/api/socials/posts/${card.postId}/mention`, { method: 'POST', body: { mentionId: chip.id, captions: [] } });
  const tagged = store.variants(card.postId);
  assert.ok(tagged.find((v) => v.platform === 'instagram').caption.includes('@alexkess'));
  assert.ok(tagged.find((v) => v.platform === 'facebook').caption.includes('@mention[Alex Kess](104680749567314)'));
  assert.ok(brandOf((await a('/api/socials/roster')).data, 'gallery').cards.find((c) => c.postId === card.postId).mentions.find((m) => m.id === chip.id).added);
});

test('DRY RUN: without SOCIALS_SEND=1 Draft, Schedule and Post now never call Publer and change no rotation', async () => {
  process.env.PUBLER_API_KEY = 'k'; process.env.PUBLER_WORKSPACE_ID = 'w';
  const a = await owner();
  const card = brandOf((await a('/api/socials/roster')).data, 'kessmedia').cards.find((c) => c.decision === 'pending');
  const before = store.getItems([card.item.id])[0];
  calls.length = 0;
  for (const body of [{ mode: 'draft' }, { mode: 'now' }, { mode: 'schedule', windowKey: brandOf((await a('/api/socials/roster')).data, 'kessmedia').windows.find((w) => !w.takenBy).key }, { mode: 'schedule', otherTime: '2030-01-05T10:00' }]) {
    const r = await a(`/api/socials/posts/${card.postId}/send`, { method: 'POST', body: { ...body, captions: card.variants.map((v) => ({ variantId: v.id, caption: v.caption, enabled: v.enabled })) } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    like(r.data, { ok: true, dryRun: true });
  }
  assert.equal(hostCalls('publer.com').length, 0, 'no request went to Publer');
  const post = store.getPost(card.postId);
  like(post, { state: 'pending', publerJobId: null, mode: null });
  assert.equal(post.dryRun.mode, 'schedule');
  assert.equal(post.dryRun.scheduledAt, sydneyLocalToIso('2030-01-05T10:00'));
  assert.ok(post.dryRun.requests.every((r) => r.path === '/posts/schedule' && r.body.bulk.state === 'scheduled'));
  // Kess Media has two LinkedIn accounts, so the request is split in two batches, as the live client would send it
  assert.equal(post.dryRun.requests.length, 2);
  like(store.getItems([card.item.id])[0], { lastPostedAt: before.lastPostedAt, timesPosted: before.timesPosted, restUntil: before.restUntil });
  assert.equal(store.getSuggestion(card.suggestionId).decision, 'pending');
  assert.ok((await a('/api/socials/ledger')).data.dryRuns.some((d) => d.id === card.postId));
});

test('LIVE: with SOCIALS_SEND=1 the card is sent once (faked Publer), images marked posted; a taken window is refused', async () => {
  process.env.SOCIALS_SEND = '1'; process.env.PUBLER_API_KEY = 'k'; process.env.PUBLER_WORKSPACE_ID = 'w';
  const a = await owner();
  const roster = (await a('/api/socials/roster')).data;
  const g = brandOf(roster, 'gallery');
  const [first, second] = g.cards.filter((c) => c.decision === 'pending' && c.state === 'pending');
  const win = g.windows.find((w) => !w.takenBy);
  calls.length = 0;
  const r = await a(`/api/socials/posts/${first.postId}/send`, { method: 'POST', body: { mode: 'schedule', windowKey: win.key } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.dryRun, undefined);
  const uploads = hostCalls('publer.com').filter((c) => c.url.endsWith('/media/from-url'));
  const submits = hostCalls('publer.com').filter((c) => c.url.endsWith('/posts/schedule'));
  assert.equal(uploads.length, store.getPost(first.postId).itemIds.length);
  assert.equal(submits.length, 1);
  const times = accountTimes('gallery', g.accounts, win.date, win.daypart);
  assert.deepEqual(submits[0].body.bulk.posts[0].accounts.map((x) => x.scheduled_at), g.accounts.map((acc) => times[acc.accountId]));
  like(store.getPost(first.postId), { state: 'sent', mode: 'schedule' });
  assert.equal(store.getItems([first.item.id])[0].timesPosted >= 1, true);
  assert.equal(store.getSuggestion(first.suggestionId).decision, 'approved');
  // never twice
  const again = await a(`/api/socials/posts/${first.postId}/send`, { method: 'POST', body: { mode: 'now' } });
  assert.equal(again.status, 409);
  // that window now holds this card, and the server re-checks at send time
  const taken = await a(`/api/socials/posts/${second.postId}/send`, { method: 'POST', body: { mode: 'schedule', windowKey: win.key } });
  assert.equal(taken.status, 409);
  assert.match(taken.data.error, /That window now holds/);
  assert.ok(brandOf((await a('/api/socials/roster')).data, 'gallery').windows.find((w) => w.key === win.key).takenBy);
});

test('LIVE: a job that cannot be confirmed says a post may exist; "I checked Publer" clears it; no second submit before that', async () => {
  process.env.SOCIALS_SEND = '1'; process.env.PUBLER_API_KEY = 'k'; process.env.PUBLER_WORKSPACE_ID = 'w';
  const a = await owner();
  const card = brandOf((await a('/api/socials/roster')).data, 'alexkess').cards.find((c) => c.decision === 'pending' && c.state === 'pending');
  P.failJob = true;
  const r1 = await a(`/api/socials/posts/${card.postId}/send`, { method: 'POST', body: { mode: 'now' } });
  assert.equal(r1.status, 400);
  const jobId = store.getPost(card.postId).publerJobId;
  assert.ok(jobId, 'the job id was stored before waiting');
  calls.length = 0;
  const r2 = await a(`/api/socials/posts/${card.postId}/send`, { method: 'POST', body: { mode: 'now' } });
  assert.match(r2.data.error, /may already exist/);
  assert.equal(hostCalls('publer.com').filter((c) => c.url.includes('/posts/schedule')).length, 0, 'the retry only re-checked the job');
  await a(`/api/socials/posts/${card.postId}/reset-job`, { method: 'POST', body: {} });
  like(store.getPost(card.postId), { publerJobId: null, state: 'failed' });
  P.failJob = false;
  assert.equal((await a(`/api/socials/posts/${card.postId}/send`, { method: 'POST', body: { mode: 'draft' } })).status, 200);
  like(store.getPost(card.postId), { state: 'sent', mode: 'draft' });
  assert.ok(store.getItems([card.item.id])[0].restUntil, 'a draft rests the image');
});

test('a send stuck for 10 minutes can be taken over; a fresh one cannot', () => {
  const p = store.ledger(30, sydneyDate(new Date())).find((x) => x.state === 'pending');
  const t0 = new Date().toISOString();
  assert.equal(store.lockPost(p.id, t0), true);
  assert.equal(store.lockPost(p.id, new Date(Date.parse(t0) + 9 * 60_000).toISOString()), false);
  assert.equal(store.lockPost(p.id, new Date(Date.parse(t0) + 11 * 60_000).toISOString()), true);
  store.updatePost(p.id, { state: 'pending', locked_at: null });
});

test('Post something else: search a brand, add today as manual, never doubled, rest rules ignored', async () => {
  const a = await owner();
  const found = (await a('/api/socials/search?brand=kessmedia&q=austrade')).data.items
    .filter((i) => !store.recentSuggestions(7, sydneyDate(new Date())).some((s) => s.itemId === i.id));
  assert.ok(found.length >= 1);
  assert.ok(found.every((i) => /austrade/i.test(i.title)));
  assert.deepEqual((await a('/api/socials/search?brand=kessmedia&q=b')).data.items, []);
  assert.equal((await a('/api/socials/search?brand=nope&q=bega')).status, 400);
  const r = await a('/api/socials/cards', { method: 'POST', body: { itemId: found[0].id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.date, sydneyDate(new Date()));
  const s = store.suggestionsForDate(r.data.date).find((x) => x.itemId === found[0].id);
  assert.equal(s.manual, true);
  const dup = await a('/api/socials/cards', { method: 'POST', body: { itemId: found[0].id } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.date, r.data.date);
  // a product's extra image cannot lead
  const extra = db.get("SELECT id FROM social_item WHERE source_id = 'demo-prod-1:2'").id;
  assert.equal((await a('/api/socials/cards', { method: 'POST', body: { itemId: extra } })).status, 409);
});

test('Regenerate with brief: Claude over HTTPS (faked), edited captions kept unless overwrite', async () => {
  const a = await owner();
  const card = brandOf((await a('/api/socials/roster')).data, 'kessmedia').cards.find((c) => c.decision === 'pending' && c.state === 'pending');
  assert.equal((await a(`/api/socials/posts/${card.postId}/regenerate`, { method: 'POST', body: { brief: 'x', overwrite: false } })).status, 400, 'not set up without a key');
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  const mine = card.variants[0];
  await a(`/api/socials/variants/${mine.id}`, { method: 'PATCH', body: { caption: 'My own words.' } });
  calls.length = 0;
  const r = await a(`/api/socials/posts/${card.postId}/regenerate`, { method: 'POST', body: { brief: 'Shot at dawn for Austrade', overwrite: false } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const call = hostCalls('anthropic.com')[0];
  like(call.headers, { 'x-api-key': 'sk-test', 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
  like(call.body, { model: 'claude-sonnet-5-5', fallbacks: 'default', output_config: { format: { type: 'json_schema' } } });
  assert.ok(call.body.messages[0].content.startsWith('Brief from Alex (this overrides the name, the location and every other rule): Shot at dawn for Austrade'));
  assert.equal(store.getItems([card.item.id])[0].brief, 'Shot at dawn for Austrade');
  const vs = store.variants(card.postId);
  assert.equal(vs.find((v) => v.id === mine.id).caption, 'My own words.');
  assert.ok(vs.filter((v) => v.id !== mine.id).every((v) => v.caption.startsWith('Fresh caption for')));
  await a(`/api/socials/posts/${card.postId}/regenerate`, { method: 'POST', body: { brief: 'Shot at dawn for Austrade', overwrite: true } });
  assert.match(store.variants(card.postId).find((v) => v.id === mine.id).caption, /^Fresh caption for/);
  delete process.env.ANTHROPIC_API_KEY;
});

test('Anthropic client: retries an overloaded API, reports a refusal, honours SOCIALS_CAPTION_MODEL', async () => {
  const c = anthropicCaptionClient('sk', { sleep: async () => {}, model: 'claude-haiku-5-5' });
  A.statuses = [529, 500];
  A.reply = { base: 'b', variants: [] };
  calls.length = 0;
  assert.equal(JSON.parse(await c.complete('sys', 'user')).base, 'b');
  assert.equal(hostCalls('anthropic.com').length, 3);
  assert.equal(hostCalls('anthropic.com')[0].headers['anthropic-beta'], undefined, 'no fallback beta for a model without it');
  A.refuse = true;
  await assert.rejects(c.complete('s', 'u'), /captions:refusal/);
  A.refuse = false; A.reply = null;
  process.env.SOCIALS_CAPTION_MODEL = 'claude-opus-5-5';
  assert.equal(anthropicCaptionClient('sk').model, 'claude-opus-5-5');
  delete process.env.SOCIALS_CAPTION_MODEL;
});

test('sync (owner, by hand): Shopify with map posters and both Sanity datasets; studio and Dropbox rows untouched', async () => {
  const a = await owner();
  let r = await a('/api/socials/run/sync', { method: 'POST', body: {} });
  assert.equal(r.data.report.gallery.error, 'shopify:not-configured');
  assert.equal(r.data.report.kessmedia.upserted, 1);
  Object.assign(process.env, { SHOPIFY_STORE: 'kess-test.myshopify.com', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret' });
  r = await a('/api/socials/run/sync', { method: 'POST', body: {} });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.deepEqual(r.data.report.gallery, { upserted: 3, retired: 12, revived: 0 }, 'two images and a map poster in; the 12 demo Shopify rows (with their posters) are gone from the shop');
  like(store.getItems([db.get("SELECT id FROM social_item WHERE source_id = '77:map-poster'").id])[0], { position: 50, imageW: 1080, context: { mapPoster: true } });
  assert.equal(db.get("SELECT status FROM social_item WHERE source = 'studio'").status, 'active');
  assert.equal(db.get("SELECT status FROM social_item WHERE source = 'dropbox'").status, 'active');
  assert.equal(db.get("SELECT retired_reason FROM social_item WHERE source_id = 'demo-prod-1:1'").retired_reason, 'gone');
  const tokenCall = hostCalls('myshopify.com')[0];
  like(tokenCall.body, { client_id: 'id', client_secret: 'secret', grant_type: 'client_credentials' });
  for (const k of ['SHOPIFY_STORE', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET']) delete process.env[k];
});

test('suggest: three per brand, idempotent, hand-added cards do not count, one in-app notice per day', async () => {
  const d2 = openDb(':memory:');
  d2.run("INSERT INTO users (email, name, role) VALUES ('alex@kess.media', 'Alex', 'owner')");
  seedSocialsDemo(d2, { now: new Date('2026-09-01T00:00:00Z') });
  const s2 = makeStore(d2);
  const now = () => new Date('2026-09-17T21:05:00Z'); // 07:05 on 18/09 in Sydney
  const notices = [];
  const deps = { db: s2, captions: null, now, recipient: 'alex@kess.media', log: () => {}, notify: (n) => notices.push(n) };
  const handPicked = s2.listItems('alexkess')[0];
  const ms = s2.insertSuggestion({ itemId: handPicked.id, forDate: '2026-09-18', recipient: 'a', baseCaption: null, manual: true });
  s2.createPost({ suggestionId: ms.id, brand: 'alexkess', itemIds: [handPicked.id], baseCaption: '' });
  const r1 = await runSuggest(deps);
  assert.equal(r1.date, '2026-09-18');
  assert.equal(r1.created, 9);
  assert.equal(r1.notified, true);
  const daily = s2.suggestionsForDate('2026-09-18').filter((s) => !s.manual);
  assert.equal(daily.length, 9);
  assert.ok(!daily.some((s) => s.itemId === handPicked.id));
  const r2 = await runSuggest(deps);
  assert.deepEqual(r2, { date: '2026-09-18', created: 0, notified: false });
  assert.equal(notices.length, 1);
  like(notices[0], { date: '2026-09-18', total: 10 });
  // every new card has a pending post and an (empty) caption per account
  const vs = s2.variantsForPosts(s2.postsForSuggestions(daily.map((s) => s.id)).map((p) => p.id));
  assert.equal(vs.length, 3 * 4 + 3 * 6 + 3 * 9);
});

test('daily jobs: off without SOCIALS_JOBS=1; then sync at 20:00 and suggest at 07:00 Sydney, once a day', async () => {
  const d3 = openDb(':memory:');
  d3.run("INSERT INTO users (email, name, role) VALUES ('alex@kess.media', 'Alex', 'owner')");
  seedSocialsDemo(d3, { now: new Date('2026-11-01T00:00:00Z') });
  const at = (local) => new Date(sydneyLocalToIso(local));
  const syncs = [];
  const deps = { sync: { sources: { kessmedia: async () => { syncs.push(1); return []; } } }, suggest: { captions: null } };
  assert.deepEqual(await socialsTick(d3, at('2026-11-10T07:05'), deps), { skipped: 'SOCIALS_JOBS is not 1' });
  assert.equal(makeStore(d3).suggestionsForDate('2026-11-10').length, 0);
  process.env.SOCIALS_JOBS = '1';
  assert.deepEqual(await socialsTick(d3, at('2026-11-10T06:55'), deps), {});
  const morning = await socialsTick(d3, at('2026-11-10T07:05'), deps);
  assert.ok(morning.suggest.created > 0);
  assert.equal(morning.sync, undefined);
  assert.equal(d3.get("SELECT COUNT(*) n FROM notifications WHERE title = 'Today''s socials are ready'").n, 1);
  assert.deepEqual(await socialsTick(d3, at('2026-11-10T07:10'), deps), {}, 'once a day');
  const recap = await socialsTick(d3, at('2026-11-10T07:25'), deps);
  assert.deepEqual(recap.recaption, { date: '2026-11-10', filled: 0, failed: 0 });
  const evening = await socialsTick(d3, at('2026-11-10T20:05'), deps);
  assert.ok(evening.sync);
  assert.equal(syncs.length, 1);
  await socialsTick(d3, at('2026-11-10T21:05'), deps);
  assert.equal(syncs.length, 1);
});

// ---------- the Supabase import ----------
const SB = {
  brand_config: [{ brand: 'gallery', accounts: [{ accountId: 'ig-live', platform: 'instagram', label: '@kessgallery', charLimit: 2200, requiresMedia: true }], voice: 'Live voice.', link_domain: 'kess.gallery', default_hashtags: ['#wallart'] }],
  mention: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Austrade', keywords: ['austrade'], brands: null, always: false, instagram: 'austradeofficial', facebook: null, linkedin: 'urn:li:organization:7867', twitter: null, bluesky: null, mastodon: null, created_at: '2026-09-27T01:02:03.123456+00:00' }],
  content_item: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', brand: 'gallery', source: 'shopify', source_id: '900:1', parent_id: '900', parent_title: 'Rock Pool', parent_url: 'https://kess.gallery/products/rock-pool', kind: 'product', image_url: 'https://cdn.shopify.com/rp.jpg', image_w: 2000, image_h: 2000, title: 'Rock Pool', context: { handle: 'rock-pool' }, brief: null, status: 'active', retired_reason: null, position: 0, created_at: '2026-09-18T00:00:00+00:00', last_posted_at: '2026-10-01T09:18:00+00:00', times_posted: 3, rest_until: null },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', brand: 'gallery', source: 'studio', source_id: 'mockup:abc', parent_id: '900', parent_title: 'Rock Pool', parent_url: 'https://kess.gallery/products/rock-pool', kind: 'product', image_url: 'https://xyz.supabase.co/storage/v1/object/public/studio/mockups/abc.jpg', image_w: 1600, image_h: 1200, title: 'Rock Pool in a room', context: {}, brief: null, status: 'active', retired_reason: null, position: 100, created_at: '2026-10-02T00:00:00+00:00', last_posted_at: null, times_posted: 0, rest_until: null },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', brand: 'kessmedia', source: 'dropbox', source_id: 'dropbox:hash1', parent_id: 'dropbox:Austrade/21 - Narooma', parent_title: 'Narooma', parent_url: 'https://kess.media/work/austrade', kind: 'image', image_url: 'https://xyz.supabase.co/storage/v1/object/public/studio/dropbox/hash1.jpg', image_w: 2048, image_h: 1365, title: 'Narooma', context: { client: 'Austrade', folder: 'Austrade/21 - Narooma' }, brief: null, status: 'retired', retired_reason: 'never', position: 0, created_at: '2026-10-03T00:00:00+00:00', last_posted_at: null, times_posted: 0, rest_until: '2026-10-20T00:00:00+00:00' },
  ],
  suggestion: [{ id: 'bbbbbbbb-0000-4000-8000-000000000001', item_id: 'aaaaaaaa-0000-4000-8000-000000000001', for_date: '2026-10-01', recipient: 'alex@kess.media', base_caption: 'Rock Pool.', decision: 'approved', decided_by: 'alex@kess.media', decided_at: '2026-10-01T08:00:00+00:00' }],
  post: [{ id: 'cccccccc-0000-4000-8000-000000000001', suggestion_id: 'bbbbbbbb-0000-4000-8000-000000000001', brand: 'gallery', item_ids: ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'], base_caption: 'Rock Pool.', mode: 'schedule', scheduled_at: '2026-10-01T09:18:00+00:00', scheduled_until: '2026-10-01T10:53:00+00:00', publer_job_id: 'j1,j2', publer_post_ids: null, state: 'sent', locked_at: '2026-10-01T08:00:00+00:00', error: null, created_at: '2026-10-01T07:00:00+00:00', sent_at: '2026-10-01T08:00:30+00:00' }],
  post_variant: [{ id: 'dddddddd-0000-4000-8000-000000000001', post_id: 'cccccccc-0000-4000-8000-000000000001', account_id: 'ig-live', platform: 'instagram', caption: 'Rock Pool.\n#wallart', enabled: true, edited: true }],
};
const SB_PAGES = [];
function supabase(u) {
  SB_PAGES.push(u.pathname + u.search);
  const table = u.pathname.split('/').pop();
  const offset = Number(u.searchParams.get('offset')), limit = Number(u.searchParams.get('limit'));
  return json((SB[table] ?? []).slice(offset, offset + limit));
}

test('import from Supabase: REST with the service key, history carried over, safe to re-run, local clashes give way', async () => {
  const d4 = openDb(':memory:');
  seedSocialsDemo(d4, { now: new Date('2026-11-01T00:00:00Z') });
  const s4 = makeStore(d4);
  // The Kess Cloud sync found Rock Pool first, under its own id, and a card was made for it locally.
  s4.upsertItems([{ brand: 'gallery', source: 'shopify', sourceId: '900:1', parentId: '900', parentTitle: 'Rock Pool', parentUrl: 'u', kind: 'product', imageUrl: 'x', imageW: 1, imageH: 1, title: 'Rock Pool', context: {}, position: 0 }]);
  const localId = d4.get("SELECT id FROM social_item WHERE source_id = '900:1'").id;
  const ls = s4.insertSuggestion({ itemId: localId, forDate: '2026-10-01', recipient: 'a', baseCaption: null });
  const lp = s4.createPost({ suggestionId: ls.id, brand: 'gallery', itemIds: [localId], baseCaption: '' });
  const other = s4.insertSuggestion({ itemId: localId, forDate: '2026-10-02', recipient: 'a', baseCaption: null });

  calls.length = 0;
  const data = await fetchSupabaseTables({ url: 'https://supabase.test/', key: 'service-role' });
  like(hostCalls('supabase.test')[0].headers, { apikey: 'service-role', Authorization: 'Bearer service-role' });
  assert.ok(SB_PAGES.some((p) => p.startsWith('/rest/v1/content_item?select=*&order=id.asc&limit=1000&offset=0')));
  const dry = importSocials(d4, data, { dryRun: true });
  assert.equal(dry.items, 3);
  assert.equal(d4.get("SELECT COUNT(*) n FROM social_item WHERE id LIKE 'aaaaaaaa%'").n, 0, 'a dry run writes nothing');

  const r1 = importSocials(d4, data);
  like(r1, { brands: 1, mentions: 1, items: 3, rekeyed: 1, suggestions: 1, replacedLocalCards: 1, posts: 1, variants: 1, skipped: 0 });
  like(s4.getItems(['aaaaaaaa-0000-4000-8000-000000000001'])[0], { timesPosted: 3, lastPostedAt: '2026-10-01T09:18:00.000Z' });
  assert.equal(s4.getSuggestion(other.id).itemId, 'aaaaaaaa-0000-4000-8000-000000000001', 'local cards follow the re-keyed item');
  assert.equal(s4.findPost(lp.id), null, 'the clashing local card gave way');
  like(s4.getItems(['aaaaaaaa-0000-4000-8000-000000000003'])[0], { source: 'dropbox', status: 'retired', retiredReason: 'never', imageUrl: SB.content_item[2].image_url });
  like(s4.getPost('cccccccc-0000-4000-8000-000000000001'), { state: 'sent', publerJobId: 'j1,j2', itemIds: SB.post[0].item_ids });
  assert.equal(s4.brandConfigs().find((b) => b.brand === 'gallery').voice, 'Live voice.');
  assert.deepEqual(s4.listMentions().map((m) => m.name), ['Austrade'], 'seeded mentions are replaced by the live list');
  // the window that post held is taken in Kess Cloud too
  assert.equal(s4.scheduledAhead('gallery', '2026-10-01T00:00:00.000Z')[0].title, 'Rock Pool');

  // re-run: same counts, no duplicates, local dry runs kept
  s4.updatePost('cccccccc-0000-4000-8000-000000000001', { dry_run: { mode: 'now', uploads: [], requests: [] }, dry_run_at: '2026-11-01T00:00:00.000Z' });
  const r2 = importSocials(d4, data);
  like(r2, { items: 3, rekeyed: 0, replacedLocalCards: 0, posts: 1 });
  assert.equal(d4.get("SELECT COUNT(*) n FROM social_item WHERE source_id = '900:1'").n, 1);
  assert.equal(d4.get('SELECT COUNT(*) n FROM social_variant WHERE post_id = ?', 'cccccccc-0000-4000-8000-000000000001').n, 1);
  assert.ok(s4.getPost('cccccccc-0000-4000-8000-000000000001').dryRun);
  // a broken export rolls back whole
  assert.throws(() => importSocials(d4, { ...data, content_item: [{ ...SB.content_item[0], id: 'zzz', kind: 'nonsense' }] }));
  assert.equal(d4.get("SELECT COUNT(*) n FROM social_item WHERE id = 'zzz'").n, 0);
});
