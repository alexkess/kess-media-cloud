// Publer payloads, the Publer client and send safety. Ported from kess-socials publer.test.ts, send.test.ts and
// studio-social.test.ts, plus the Kess Cloud dry run and the SOCIALS_SEND lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPostBody, createPublerClient, publerFromEnv, publerRequests, guardedFetch, PublerError, undouble } from '../server/lib/socials/publer.js';
import { sendPost, MAYBE_SENT } from '../server/lib/socials/send.js';
import { like, json, fakeFetch } from './socials-helpers.js';

const ig = { accountId: 'ig1', platform: 'instagram', label: 'ig', charLimit: 2200, requiresMedia: true };
const fb = { accountId: 'fb1', platform: 'facebook', label: 'fb', charLimit: 5000, requiresMedia: false };
const pin = { accountId: 'pin1', platform: 'pinterest', label: 'pin', charLimit: 500, requiresMedia: true, boardId: 'b1' };
const li = { accountId: 'li1', platform: 'linkedin', label: 'li', charLimit: 3000, requiresMedia: false };
const x = { accountId: 'x1', platform: 'twitter', label: 'x', charLimit: 280, requiresMedia: false };
const company = { accountId: 'li-co', platform: 'linkedin', label: 'Kess Media PTY LTD', charLimit: 3000, requiresMedia: false };
const personal = { accountId: 'li-me', platform: 'linkedin', label: 'Alexander Kesselaar', charLimit: 3000, requiresMedia: false };
const client = (f) => createPublerClient({ apiKey: 'k', workspaceId: 'w', fetch: f, sleep: async () => {} });

test('payload: draft photo post with one caption per provider; schedule time per account; photo type for carousels', () => {
  const d = buildPostBody({ mode: 'draft', entries: [{ account: ig, caption: 'ig text' }, { account: fb, caption: 'fb text' }], mediaIds: ['m1'] });
  assert.equal(d.bulk.state, 'draft');
  assert.deepEqual(d.bulk.posts[0].accounts, [{ id: 'ig1' }, { id: 'fb1' }]);
  assert.deepEqual(d.bulk.posts[0].networks.instagram, { type: 'photo', text: 'ig text', media: [{ id: 'm1' }] });
  const s = buildPostBody({ mode: 'schedule', scheduledAt: '2026-09-20T10:00:00+10:00', entries: [{ account: ig, caption: 'x' }, { account: fb, caption: 'y' }], mediaIds: ['m1', 'm2'] });
  assert.equal(s.bulk.state, 'scheduled');
  assert.deepEqual(s.bulk.posts[0].accounts[0], { id: 'ig1', scheduled_at: '2026-09-20T10:00:00+10:00' });
  assert.equal(s.bulk.posts[0].networks.instagram.type, 'photo');
  const staggered = buildPostBody({ mode: 'schedule', entries: [{ account: ig, caption: 'a', scheduledAt: '2026-09-21T09:18:00.000Z' }, { account: fb, caption: 'b', scheduledAt: '2026-09-21T09:47:00.000Z' }], mediaIds: ['m1'] });
  assert.deepEqual(staggered.bulk.posts[0].accounts, [{ id: 'ig1', scheduled_at: '2026-09-21T09:18:00.000Z' }, { id: 'fb1', scheduled_at: '2026-09-21T09:47:00.000Z' }]);
});

test('payload: Pinterest board, title and link; media required; Google Business gets the lead image only', () => {
  const p = buildPostBody({ mode: 'now', entries: [{ account: pin, caption: 'p' }], mediaIds: ['m1'], link: 'https://kess.gallery/products/x', title: 'Stanwell' });
  assert.equal(p.bulk.state, 'scheduled');
  assert.deepEqual(p.bulk.posts[0].accounts[0], { id: 'pin1', album_id: 'b1' });
  like(p.bulk.posts[0].networks.pinterest, { type: 'photo', title: 'Stanwell', link: 'https://kess.gallery/products/x' });
  assert.throws(() => buildPostBody({ mode: 'draft', entries: [{ account: ig, caption: 'x' }], mediaIds: [] }), PublerError);
  const gbp = { accountId: 'gbp', platform: 'google', label: 'Google', charLimit: 1500, requiresMedia: false };
  const g = buildPostBody({ mode: 'draft', entries: [{ account: ig, caption: 'a' }, { account: gbp, caption: 'b' }], mediaIds: ['print', 'poster'] });
  assert.deepEqual(g.bulk.posts[0].networks.instagram.media, [{ id: 'print' }, { id: 'poster' }]);
  assert.deepEqual(g.bulk.posts[0].networks.google.media, [{ id: 'print' }]);
});

test('payload: a second account on one platform goes in its own post; link as first comment on LinkedIn and X only', () => {
  const b = buildPostBody({ mode: 'schedule', scheduledAt: '2026-09-20T00:00:00.000Z', entries: [{ account: ig, caption: 'ig' }, { account: company, caption: 'we did this' }, { account: personal, caption: 'I did this' }], mediaIds: ['m1'] });
  assert.equal(b.bulk.posts.length, 2);
  assert.deepEqual(b.bulk.posts[0].accounts.map((a) => a.id), ['ig1', 'li-co']);
  assert.equal(b.bulk.posts[0].networks.linkedin.text, 'we did this');
  assert.deepEqual(b.bulk.posts[1].networks, { linkedin: { type: 'photo', text: 'I did this', media: [{ id: 'm1' }] } });
  const link = 'https://kess.media/work/daff';
  const c = buildPostBody({ mode: 'draft', entries: [{ account: li, caption: 'a' }, { account: x, caption: 'b' }, { account: fb, caption: `c ${link}` }], mediaIds: ['m1'], link });
  const accs = c.bulk.posts[0].accounts;
  assert.deepEqual(accs.find((a) => a.id === 'li1').comments, [{ text: link }]);
  assert.deepEqual(accs.find((a) => a.id === 'x1').comments, [{ text: link }]);
  assert.equal(accs.find((a) => a.id === 'fb1').comments, undefined);
  assert.equal(buildPostBody({ mode: 'draft', entries: [{ account: li, caption: 'see kess.media/work/daff' }], mediaIds: ['m1'], link }).bulk.posts[0].accounts[0].comments, undefined);
  // one request per batch, now goes to the publish endpoint
  const reqs = publerRequests({ mode: 'now', entries: [{ account: company, caption: 'we' }, { account: personal, caption: 'I' }], mediaIds: [] });
  assert.deepEqual(reqs.map((r) => [r.path, r.body.bulk.posts.length]), [['/posts/schedule/publish', 1], ['/posts/schedule/publish', 1]]);
});

test('client: uploads by URL and polls; submit returns before the job runs; one request per batch', async () => {
  const q = [json({ job_id: 'j1' }), json({ status: 'working' }), json({ status: 'complete', payload: [{ id: 'm9' }] })];
  const f = fakeFetch(() => q.shift());
  assert.equal(await client(f).uploadImage('https://cdn/x.jpg', 'x.jpg'), 'm9');
  assert.equal(f.calls[0].url, 'https://app.publer.com/api/v1/media/from-url');
  like(f.calls[0].init.headers, { Authorization: 'Bearer-API k', 'Publer-Workspace-Id': 'w' });
  const f2 = fakeFetch(() => json({ job_id: 'j2' }));
  assert.deepEqual(await client(f2).submitPost({ mode: 'now', entries: [{ account: fb, caption: 'x' }], mediaIds: [] }), { jobId: 'j2' });
  assert.equal(f2.calls.length, 1);
  assert.equal(f2.calls[0].url, 'https://app.publer.com/api/v1/posts/schedule/publish');
  const q3 = [json({ job_id: 'j1' }), json({ job_id: 'j2' })];
  const f3 = fakeFetch(() => q3.shift());
  assert.deepEqual(await client(f3).submitPost({ mode: 'draft', entries: [{ account: ig, caption: 'ig' }, { account: company, caption: 'we' }, { account: personal, caption: 'I' }], mediaIds: ['m1'] }), { jobId: 'j1,j2' });
  assert.deepEqual(f3.calls.map((c) => c.body.bulk.posts[0].accounts.map((a) => a.id)), [['ig1', 'li-co'], ['li-me']]);
});

test('client: jobs already accepted are kept when a later batch fails, so a retry never posts twice', async () => {
  const q = [json({ job_id: 'j1' }), new Response('x', { status: 500 })];
  const err = await client(fakeFetch(() => q.shift())).submitPost({ mode: 'draft', entries: [{ account: company, caption: 'we' }, { account: personal, caption: 'I' }], mediaIds: [] }).catch((e) => e);
  assert.ok(err instanceof PublerError);
  assert.deepEqual(err.submittedJobIds, ['j1']);
});

test('client: awaitJob surfaces refusals, partly or wholly, across every job of the post', async () => {
  const failures = { post_0: [{ account_id: 'ig1', provider: 'instagram', message: "undefined method 'first' for nil" }] };
  await assert.rejects(client(fakeFetch(() => json({ status: 'complete', payload: { failures: { ig1: [{ message: 'bad' }] } } }))).awaitJob('j2'), /Publer: post rejected/);
  assert.deepEqual(await client(fakeFetch(() => json({ status: 'complete', payload: { failures } }))).awaitJob('j', 3), { rejected: [{ provider: 'instagram', message: "undefined method 'first' for nil" }] });
  await assert.rejects(client(fakeFetch(() => json({ status: 'complete', payload: { failures } }))).awaitJob('j', 1), /Publer: post rejected \(instagram/);
  const q = [json({ status: 'complete', payload: { failures: {} } }), json({ status: 'complete', payload: { failures: { post_0: [{ provider: 'linkedin', message: 'nope' }] } } })];
  const f = fakeFetch(() => q.shift());
  assert.deepEqual(await client(f).awaitJob('j1,j2', 3), { rejected: [{ provider: 'linkedin', message: 'nope' }] });
  assert.deepEqual(f.calls.map((c) => c.url), ['https://app.publer.com/api/v1/job_status/j1', 'https://app.publer.com/api/v1/job_status/j2']);
  assert.equal(undouble('abc123abc123'), 'abc123');
  assert.equal(undouble('abc123abc124'), 'abc123abc124');
});

test('SOCIALS_SEND lock: no live client and no Publer fetch unless SOCIALS_SEND=1', async () => {
  const before = { ...process.env };
  try {
    process.env.PUBLER_API_KEY = 'k'; process.env.PUBLER_WORKSPACE_ID = 'w';
    delete process.env.SOCIALS_SEND;
    assert.throws(() => publerFromEnv(), /sending is off/);
    process.env.SOCIALS_SEND = 'true';
    assert.throws(() => publerFromEnv(), /sending is off/, 'only exactly 1 turns it on');
    const real = globalThis.fetch;
    let hit = 0;
    globalThis.fetch = async () => { hit++; return json({}); };
    try { await assert.rejects(guardedFetch('https://app.publer.com/api/v1/x', {}), /sending is off/); } finally { globalThis.fetch = real; }
    assert.equal(hit, 0);
    process.env.SOCIALS_SEND = '1';
    assert.ok(publerFromEnv());
  } finally { for (const k of ['PUBLER_API_KEY', 'PUBLER_WORKSPACE_ID', 'SOCIALS_SEND']) if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; }
});

// ---------- send.js (ported send.test.ts) ----------
const post = { id: 'p1', suggestionId: 's1', brand: 'gallery', itemIds: ['i1', 'i2'], baseCaption: 'b', mode: null, scheduledAt: null, scheduledUntil: null, publerJobId: null, publerPostIds: null, state: 'pending', lockedAt: null, error: null, createdAt: '', sentAt: null };
const variants = [
  { id: 'v1', postId: 'p1', accountId: 'ig', platform: 'instagram', caption: 'ig cap', enabled: true, edited: false },
  { id: 'v2', postId: 'p1', accountId: 'fb', platform: 'facebook', caption: 'fb cap', enabled: false, edited: false },
];
const items = ['i1', 'i2'].map((id, k) => ({ id, brand: 'gallery', source: 'shopify', sourceId: id, parentId: 'prod', parentTitle: 'Stanwell', parentUrl: 'https://kess.gallery/products/x', kind: 'product', imageUrl: `https://cdn/${id}.jpg`, imageW: 1, imageH: 1, title: 'Stanwell', context: {}, position: k, brief: null, status: 'active', retiredReason: null, createdAt: '', lastPostedAt: null, timesPosted: 0, restUntil: null }));
const cfg = { brand: 'gallery', accounts: [{ accountId: 'ig', platform: 'instagram', label: 'ig', charLimit: 2200, requiresMedia: true }, { accountId: 'fb', platform: 'facebook', label: 'fb', charLimit: 5000, requiresMedia: false }], voice: '', linkDomain: '', defaultHashtags: [] };

function deps(over = {}) {
  const updates = [], posted = [], rested = [], decisions = [], logs = [];
  const spy = (fn) => { const f = async (...a) => { f.calls.push(a); return fn(...a); }; f.calls = []; return f; };
  const db = {
    lockPost: async () => over.lock ?? true,
    getPost: async () => over.post ?? post, variants: async () => over.variants ?? variants, getItems: async () => over.items ?? items, brandConfigs: async () => [cfg],
    updatePost: over.updatePost ?? (async (_id, patch) => { updates.push(patch); }),
    markPosted: async (ids) => { posted.push(ids); }, restItems: async (ids, until) => { rested.push({ ids, until }); }, setDecision: async (_id, d) => { decisions.push(d); },
  };
  const publer = {
    uploadImage: spy(async (url) => `m-${url.split('/').pop()}`),
    submitPost: spy(over.submitPost ?? (async () => ({ jobId: 'j1' }))),
    awaitJob: spy(over.awaitJob ?? (async () => ({ rejected: [] }))),
  };
  return { d: { db, publer, now: () => new Date('2026-09-18T01:00:00Z'), log: (s) => logs.push(s), dryRun: over.dryRun }, updates, posted, rested, decisions, publer, logs };
}

test('send: uploads every item in order one at a time, only ticked accounts, stores the job id, marks sent and posted', async () => {
  const { d, updates, posted, decisions, publer } = deps();
  assert.deepEqual(await sendPost(d, { postId: 'p1', mode: 'schedule', scheduledAt: '2026-09-20T10:00:00+10:00', by: 'alex' }), { ok: true });
  assert.deepEqual(publer.uploadImage.calls.map((c) => c[0]), ['https://cdn/i1.jpg', 'https://cdn/i2.jpg']);
  const input = publer.submitPost.calls[0][0];
  assert.deepEqual(input.entries.map((e) => e.account.accountId), ['ig']);
  assert.deepEqual(input.mediaIds, ['m-i1.jpg', 'm-i2.jpg']);
  like(input, { mode: 'schedule', scheduledAt: '2026-09-20T10:00:00+10:00', link: 'https://kess.gallery/products/x' });
  like(updates[0], { publer_job_id: 'j1', mode: 'schedule', scheduled_at: '2026-09-20T10:00:00+10:00' });
  like(updates.at(-1), { state: 'sent' });
  assert.deepEqual(posted, [['i1', 'i2']]);
  assert.deepEqual(decisions, ['approved']);
});

test('send: the job id is stored before waiting, so a crash cannot lose it', async () => {
  const seen = [];
  const { d } = deps({ updatePost: async (_id, patch) => { seen.push(patch); }, awaitJob: async () => { like(seen[0], { publer_job_id: 'j1' }); throw new Error('Publer: job timed out'); } });
  assert.deepEqual(await sendPost(d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: 'Publer: job timed out' });
  like(seen.at(-1), { state: 'failed' });
});

test('send: a retry with a stored job re-checks it and never uploads or submits again; a failed re-check says a post may exist', async () => {
  const a = deps({ post: { ...post, state: 'sending', publerJobId: 'j-old', mode: 'now' } });
  assert.deepEqual(await sendPost(a.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: true });
  assert.equal(a.publer.uploadImage.calls.length + a.publer.submitPost.calls.length, 0);
  assert.deepEqual(a.publer.awaitJob.calls[0], ['j-old']);
  assert.deepEqual(a.posted, [['i1', 'i2']]);
  const b = deps({ post: { ...post, state: 'sending', publerJobId: 'j-old' }, awaitJob: async () => { throw new Error('Publer: post rejected'); } });
  assert.deepEqual(await sendPost(b.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: MAYBE_SENT });
  assert.equal(b.publer.submitPost.calls.length, 0);
  like(b.updates.at(-1), { state: 'failed' });
  assert.ok(!b.updates.some((u) => 'publer_job_id' in u));
});

test('send: lock, time, ticked accounts and items are all checked before Publer is touched', async () => {
  assert.deepEqual(await sendPost(deps({ lock: false }).d, { postId: 'p1', mode: 'draft', by: 'alex' }), { ok: false, error: 'already sent' });
  assert.deepEqual(await sendPost(deps().d, { postId: 'p1', mode: 'schedule', by: 'alex' }), { ok: false, error: 'pick a time' });
  const off = deps({ variants: variants.map((v) => ({ ...v, enabled: false })) });
  assert.deepEqual(await sendPost(off.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: 'no accounts ticked' });
  assert.equal(off.publer.uploadImage.calls.length, 0);
  like(off.updates.at(-1), { state: 'failed', error: 'Error' });
  const none = deps({ items: [] });
  assert.deepEqual(await sendPost(none.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: 'items missing' });
  assert.equal(none.publer.submitPost.calls.length, 0);
  const bad = deps({ submitPost: async () => { throw new Error('Publer: post rejected'); } });
  assert.deepEqual(await sendPost(bad.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: 'Publer: post rejected' });
  assert.deepEqual(bad.posted, []);
  const worse = deps({ submitPost: async () => { throw new Error('Publer: post rejected'); }, updatePost: async () => { throw new Error('db down'); } });
  assert.deepEqual(await sendPost(worse.d, { postId: 'p1', mode: 'now', by: 'alex' }), { ok: false, error: 'Publer: post rejected' });
  assert.ok(worse.logs.includes('send:mark-failed-failed'));
});

test('send: partial refusal is sent with a warning; Draft rests 14 days; Schedule and Post now count as posted; past window time moves ahead', async () => {
  const part = deps({ awaitJob: async () => ({ rejected: [{ provider: 'instagram', message: 'bad ratio' }] }) });
  assert.deepEqual(await sendPost(part.d, { postId: 'p1', mode: 'draft', by: 'alex' }), { ok: true, warning: 'Sent, except instagram (bad ratio)' });
  assert.deepEqual(part.updates.at(-1), { error: 'partial:instagram' });
  assert.equal(part.posted.length, 0);
  assert.equal(part.rested.length, 1);
  const draft = deps();
  await sendPost(draft.d, { postId: 'p1', mode: 'draft', by: 'alex' });
  assert.deepEqual([draft.posted, draft.rested], [[], [{ ids: ['i1', 'i2'], until: '2026-10-02T01:00:00.000Z' }]]);
  const now = deps();
  await sendPost(now.d, { postId: 'p1', mode: 'now', by: 'alex' });
  assert.deepEqual([now.posted, now.rested], [[['i1', 'i2']], []]);
  const win = deps();
  assert.deepEqual(await sendPost(win.d, { postId: 'p1', mode: 'schedule', scheduledTimes: { ig: '2026-09-18T00:30:00.000Z', fb: '2026-09-18T09:47:00.000Z' }, by: 'alex' }), { ok: true });
  const entries = win.publer.submitPost.calls[0][0].entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].scheduledAt, '2026-09-18T01:05:00.000Z');
  like(win.updates.find((u) => u.publer_job_id), { scheduled_at: '2026-09-18T01:05:00.000Z', scheduled_until: null });
});

test('send dry run: same checks, exact requests kept on the post, Publer untouched, no lock, state or rotation change', async () => {
  const dry = deps({ dryRun: true });
  const r = await sendPost(dry.d, { postId: 'p1', mode: 'schedule', scheduledTimes: { ig: '2026-09-20T09:18:00.000Z' }, by: 'alex' });
  like(r, { ok: true, dryRun: true });
  assert.equal(dry.publer.uploadImage.calls.length + dry.publer.submitPost.calls.length + dry.publer.awaitJob.calls.length, 0);
  assert.equal(dry.updates.length, 1);
  const rec = dry.updates[0].dry_run;
  assert.deepEqual(Object.keys(dry.updates[0]).sort(), ['dry_run', 'dry_run_at']);
  assert.deepEqual(rec.uploads.map((u) => u.body.media[0].url), ['https://cdn/i1.jpg', 'https://cdn/i2.jpg']);
  // the requests are exactly what the live client would send for these entries
  assert.deepEqual(rec.requests, publerRequests({ mode: 'schedule', entries: [{ account: cfg.accounts[0], caption: 'ig cap', scheduledAt: '2026-09-20T09:18:00.000Z' }], mediaIds: ['dry-run-media-1', 'dry-run-media-2'], link: 'https://kess.gallery/products/x', title: 'Stanwell' }));
  assert.deepEqual([dry.posted, dry.rested, dry.decisions], [[], [], []]);
  assert.deepEqual(await sendPost(deps({ dryRun: true, post: { ...post, state: 'sent' } }).d, { postId: 'p1', mode: 'now', by: 'a' }), { ok: false, error: 'already sent' });
  assert.deepEqual(await sendPost(deps({ dryRun: true, variants: [] }).d, { postId: 'p1', mode: 'now', by: 'a' }), { ok: false, error: 'no accounts ticked' });
  const resume = deps({ dryRun: true, post: { ...post, state: 'failed', publerJobId: 'j-old' } });
  await sendPost(resume.d, { postId: 'p1', mode: 'now', by: 'a' });
  like(resume.updates[0].dry_run, { resume: true, jobId: 'j-old' });
});
