// Socials rules, ported from the kess-socials vitest suites (rotation, slots, dates, conform, mentions, names,
// captions, sync, map posters, card building). Same fixtures and expectations, in node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pick, siblings, eligible } from '../server/lib/socials/rotation.js';
import { accountTimes, DAYPARTS, freeWindows, platformTime, parseWindowKey, windowTakenBy } from '../server/lib/socials/slots.js';
import { sydneyDate, sydneyLocalToIso, shiftDate, clampRosterDate } from '../server/lib/socials/dates.js';
import { conformText, hashtagLimit } from '../server/lib/socials/conform.js';
import { insertMention, mentionText, suggestMentions } from '../server/lib/socials/mentions.js';
import { cleanName, dedupeLocation, withShotOn } from '../server/lib/socials/names.js';
import { captionHasLink } from '../server/lib/socials/links.js';
import { buildCaptionPrompt, checkCaptions, generateCaptions, mergeEdits, describeError } from '../server/lib/socials/captions.js';
import { planUpsert, errorName } from '../server/lib/socials/sync.js';
import { buildCards, contextLine } from '../server/lib/socials/load.js';
import { thumb } from '../server/lib/socials/thumb.js';
import { BRANDS } from '../server/lib/socials/types.js';
import { like } from './socials-helpers.js';

const today = '2026-09-18';
let n = 0;
const item = (over = {}) => ({
  id: `i${++n}`, brand: 'gallery', source: 'shopify', sourceId: `s${n}`, parentId: `p${n}`, parentTitle: 'P', parentUrl: 'u', kind: 'product', imageUrl: 'i', imageW: null, imageH: null,
  title: 't', context: {}, position: 0, brief: null, status: 'active', retiredReason: null, createdAt: '2026-01-01T00:00:00Z', lastPostedAt: null, timesPosted: 0, restUntil: null, ...over,
});
const sug = (itemId, forDate, decision) => ({ id: 'x', itemId, forDate, recipient: 'a', baseCaption: null, decision, decidedBy: null, decidedAt: null });

// ---------- rotation ----------
test('rotation: eligible excludes retired, posted within 90 days, Later within 14 days, and already suggested today', () => {
  const a = item({ status: 'retired' });
  const b = item({ lastPostedAt: '2026-08-01T00:00:00Z' });
  const c = item();
  const d = item();
  const e = item({ lastPostedAt: '2026-05-01T00:00:00Z' });
  const s = [sug(c.id, '2026-09-10', 'later'), sug(d.id, today, 'pending')];
  assert.deepEqual(eligible([a, b, c, d, e], s, today).map((i) => i.id), [e.id]);
  assert.deepEqual(eligible([c], [sug(c.id, '2026-09-03', 'later')], today).map((i) => i.id), [c.id]);
});

test('rotation: one post per client a day (Kess Media), one per project, product leads with its first image', () => {
  const narooma = item({ brand: 'kessmedia', kind: 'image', parentId: 'narooma', context: { client: 'Austrade' } });
  const bega = item({ brand: 'kessmedia', kind: 'image', parentId: 'bega', context: { client: 'austrade ' } });
  const forum = item({ brand: 'kessmedia', kind: 'image', parentId: 'forum', context: { client: 'Connect Media' } });
  const noClient = item({ brand: 'kessmedia', kind: 'image', parentId: 'q2' });
  const picked = pick({ items: [narooma, bega, forum, noClient], suggestions: [], today }).kessmedia;
  assert.equal(picked.length, 3);
  assert.equal(picked.filter((i) => i.context.client).length, 2);
  assert.ok(picked.some((i) => i.id === forum.id) && picked.some((i) => i.id === noClient.id));

  const first = item({ parentId: 'prod', position: 0 });
  const mockup = item({ parentId: 'prod2', position: 3 });
  const photo = item({ brand: 'alexkess', kind: 'image', parentId: 'proj', position: 4 });
  const r = pick({ items: [mockup, first, photo], suggestions: [], today });
  assert.deepEqual(r.gallery.map((i) => i.id), [first.id]);
  assert.deepEqual(r.alexkess.map((i) => i.id), [photo.id]);
});

test('rotation: new first, then never posted, then fewest posts, one per parent, stable for the day', () => {
  const fresh = item({ createdAt: '2026-09-15T00:00:00Z', timesPosted: 5, lastPostedAt: '2026-01-01T00:00:00Z' });
  const never1 = item({ parentId: 'same' });
  const never2 = item({ parentId: 'same' });
  const once = item({ timesPosted: 1, lastPostedAt: '2026-01-01T00:00:00Z' });
  const twice = item({ timesPosted: 2, lastPostedAt: '2026-01-01T00:00:00Z' });
  const r1 = pick({ items: [twice, once, never2, never1, fresh], suggestions: [], today });
  const r2 = pick({ items: [fresh, never1, never2, once, twice], suggestions: [], today });
  assert.equal(r1.gallery[0].id, fresh.id);
  assert.equal(r1.gallery.filter((i) => i.parentId === 'same').length, 1);
  assert.equal(r1.gallery[2].id, once.id);
  assert.deepEqual(r1.gallery.map((i) => i.id), r2.gallery.map((i) => i.id));
  const short = pick({ items: [item({ brand: 'alexkess' }), item({ brand: 'kessmedia' })], suggestions: [], today });
  assert.deepEqual(short.gallery, []);
  assert.equal(short.alexkess.length, 1);
});

test('rotation: siblings are eligible images of the same parent, by position, capped', () => {
  const self = item({ parentId: 'prod', position: 0 });
  const s1 = item({ parentId: 'prod', position: 2 });
  const s2 = item({ parentId: 'prod', position: 1 });
  const s3 = item({ parentId: 'prod', position: 3, lastPostedAt: '2026-09-01T00:00:00Z' });
  const other = item({ parentId: 'other' });
  assert.deepEqual(siblings(self, [self, s1, s2, s3, other], [], today).map((i) => i.id), [s2.id, s1.id]);
});

test('rotation: the 7 day roster keeps a waiting card out, then returns it ranked lower for being shown', () => {
  const a = item();
  assert.deepEqual(eligible([a], [sug(a.id, '2026-09-12', 'pending')], today), []);
  assert.deepEqual(eligible([a], [sug(a.id, '2026-09-11', 'pending')], today).map((i) => i.id), [a.id]);
  const shownTwice = item();
  const shownOnce = item();
  const neverShown = item();
  const s = [sug(shownTwice.id, '2026-08-01', 'pending'), sug(shownTwice.id, '2026-08-20', 'pending'), sug(shownOnce.id, '2026-08-05', 'pending')];
  assert.deepEqual(pick({ items: [shownTwice, shownOnce, neverShown], suggestions: s, today }).gallery.map((i) => i.id), [neverShown.id, shownOnce.id, shownTwice.id]);
});

test('rotation: a draft rests its image until rest_until without counting it as posted', () => {
  const resting = item({ restUntil: '2026-09-25T00:00:00.000Z' });
  const rested = item({ restUntil: '2026-09-18T00:00:00.000Z' });
  assert.deepEqual(eligible([resting, rested], [], today).map((i) => i.id), [rested.id]);
  assert.equal(rested.lastPostedAt, null);
});

// ---------- dates ----------
test('dates: Sydney midnight, daylight saving, wall clock to UTC, roster clamp', () => {
  assert.equal(sydneyDate(new Date('2026-09-18T13:59:00Z')), '2026-09-18');
  assert.equal(sydneyDate(new Date('2026-09-18T14:00:00Z')), '2026-09-19');
  assert.equal(sydneyDate(new Date('2026-10-10T12:59:00Z')), '2026-10-10');
  assert.equal(sydneyDate(new Date('2026-10-10T13:00:00Z')), '2026-10-11');
  assert.equal(sydneyLocalToIso('2026-09-20T10:00'), '2026-09-20T00:00:00.000Z');
  assert.equal(sydneyLocalToIso('2026-10-10T10:00'), '2026-10-09T23:00:00.000Z');
  assert.equal(shiftDate('2026-10-01', -1), '2026-09-30');
  assert.equal(clampRosterDate('2026-09-12', '2026-09-18'), '2026-09-12');
  assert.equal(clampRosterDate('2026-09-11', '2026-09-18'), '2026-09-18');
  assert.equal(clampRosterDate('2026-09-19', '2026-09-18'), '2026-09-18');
  assert.equal(clampRosterDate('garbage', '2026-09-18'), '2026-09-18');
  assert.equal(clampRosterDate(undefined, '2026-09-18'), '2026-09-18');
});

// ---------- slots ----------
const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'bluesky', 'threads', 'pinterest', 'google', 'twitter', 'mastodon'];
const acc = (accountId, platform, charLimit = 500) => ({ accountId, platform, label: accountId, charLimit, requiresMedia: false });
const satMorning = new Date('2026-09-18T20:00:00Z'); // Saturday 19/09/2026 06:00 Sydney

test('slots: never on a quarter hour, brands offset, LinkedIn in the working day', () => {
  for (const b of BRANDS) for (const p of PLATFORMS) for (const d of DAYPARTS) assert.notEqual(Number(platformTime(p, d, b).split(':')[1]) % 15, 0, `${b} ${p} ${d}`);
  assert.equal(new Set(BRANDS.map((b) => platformTime('instagram', 'night', b))).size, 3);
  assert.equal(platformTime('instagram', 'night', 'gallery'), '19:18');
  assert.equal(platformTime('instagram', 'night', 'alexkess'), '19:29');
  assert.ok(platformTime('linkedin', 'night', 'gallery') < '18:30');
});

test('slots: every account its own instant, a second account on one platform 6 minutes later', () => {
  const t = accountTimes('kessmedia', [acc('ig', 'instagram'), acc('li-co', 'linkedin'), acc('li-me', 'linkedin')], '2026-09-21', 'midday');
  assert.equal(new Set(Object.values(t)).size, 3);
  assert.equal(t['li-co'], '2026-09-21T02:32:00.000Z'); // 12:07 + 23 = 12:30, nudged to 12:32 Sydney
  assert.equal(Date.parse(t['li-me']) - Date.parse(t['li-co']), 6 * 60_000);
});

test('slots: free windows in plain words, started ones skipped, taken ones kept and named', () => {
  const accounts = [acc('ig', 'instagram'), acc('fb', 'facebook'), acc('pin', 'pinterest')];
  const w = freeWindows({ brand: 'gallery', accounts, taken: [], now: satMorning, count: 4 });
  assert.deepEqual(w.map((x) => x.label), ['Today morning', 'Today midday', 'Today night', 'Tomorrow morning']);
  like(w[0], { key: '2026-09-19:morning', range: '8:12 am to 9:13 am', weekend: true });
  assert.equal(w[0].startIso, '2026-09-18T22:12:00.000Z');
  const later = new Date('2026-09-18T22:30:00Z');
  const t1 = freeWindows({ brand: 'gallery', accounts, taken: [{ at: '2026-09-19T09:18:00.000Z', title: 'Voodoo Poles I' }], now: later, count: 2 });
  assert.deepEqual(t1.map((x) => [x.key, x.takenBy ?? null]), [['2026-09-19:midday', null], ['2026-09-19:night', 'Voodoo Poles I'], ['2026-09-20:morning', null]]);
  const t2 = freeWindows({ brand: 'gallery', accounts, taken: [{ at: '2026-09-19T02:24:00.000Z', title: 'A' }, { at: '2026-09-19T09:18:00.000Z', title: 'B' }], now: later, count: 1 });
  assert.deepEqual(t2.map((x) => x.key), ['2026-09-19:midday', '2026-09-19:night', '2026-09-20:morning']);
  like(freeWindows({ brand: 'gallery', accounts, taken: [], now: satMorning, count: 7 })[6], { label: 'Mon 21 Sept morning', weekend: false });
  // the server re-check at send time
  assert.equal(windowTakenBy('gallery', accounts, '2026-09-19', 'night', [{ at: '2026-09-19T09:18:00.000Z', title: 'B' }]), 'B');
  assert.equal(windowTakenBy('gallery', accounts, '2026-09-19', 'morning', [{ at: '2026-09-19T09:18:00.000Z', title: 'B' }]), null);
  assert.deepEqual(parseWindowKey('2026-09-21:night'), { date: '2026-09-21', daypart: 'night' });
  assert.equal(parseWindowKey('2026-09-21:brunch'), null);
  assert.equal(parseWindowKey('garbage'), null);
});

// ---------- conform ----------
const handles = { kessgallery: 'Kess Gallery', alexkess: 'Alex Kess', kess_media_sydney: 'Kess Media' };
const source = 'North Cronulla - Rowing Out\nfor Prints check out @kessgallery ( www.kess.gallery )\n\n#alexkess #sydney #dronephotography';
const cacc = (platform, charLimit = 5000) => ({ accountId: platform, platform, label: platform, charLimit, requiresMedia: false });

test('conform: keeps every word, sets hashtags per platform, names handles where @ would not link, trims at a word', () => {
  for (const p of ['facebook', 'bluesky', 'threads', 'linkedin', 'twitter', 'mastodon', 'google']) {
    const out = conformText({ text: source, brand: 'alexkess', target: cacc(p, 3000), handles });
    assert.ok(out.includes('North Cronulla - Rowing Out') && out.includes('www.kess.gallery'), p);
  }
  assert.equal(conformText({ text: source, brand: 'alexkess', target: cacc('facebook'), handles }), 'North Cronulla - Rowing Out\nfor Prints check out Kess Gallery ( www.kess.gallery )');
  assert.equal(conformText({ text: source, brand: 'alexkess', target: cacc('bluesky', 300), handles }), 'North Cronulla - Rowing Out\nfor Prints check out Kess Gallery ( www.kess.gallery )\n\n#alexkess #sydney');
  assert.match(conformText({ text: source, brand: 'alexkess', target: cacc('mastodon', 500), handles }), /#alexkess #sydney #dronephotography$/);
  assert.equal(conformText({ text: source, brand: 'alexkess', target: cacc('instagram', 2200), handles }), source);
  assert.ok(conformText({ text: source, brand: 'alexkess', target: cacc('threads', 500), handles }).includes('@kessgallery'));
  assert.equal(conformText({ text: 'Thanks @someoneelse', brand: 'alexkess', target: cacc('facebook'), handles }), 'Thanks @someoneelse');
  assert.equal(conformText({ text: 'Dawn at #Cronulla again.\n\n#alexkess', brand: 'alexkess', target: cacc('facebook'), handles }), 'Dawn at #Cronulla again.');
  assert.equal(conformText({ text: 'Short line.\n\n#one #two', brand: 'alexkess', target: cacc('twitter', 15), handles }), 'Short line.');
  assert.equal(conformText({ text: 'one two three four five', brand: 'alexkess', target: cacc('twitter', 14), handles }), 'one two three…');
  assert.equal(hashtagLimit('kessmedia', 'linkedin'), 5);
  assert.equal(hashtagLimit('alexkess', 'linkedin'), 0);
});

// ---------- mentions ----------
const austrade = { id: 'm1', name: 'Austrade', keywords: ['austrade', 'australian trade and investment commission'], brands: null, always: false, instagram: 'austradeofficial', facebook: null, linkedin: 'urn:li:organization:7867', twitter: null, bluesky: null, mastodon: null };
const gallery = { id: 'm2', name: 'Kess Gallery', keywords: [], brands: ['alexkess'], always: true, instagram: 'kessgallery', facebook: null, linkedin: null, twitter: null, bluesky: null, mastodon: null };
const aphantasia = { id: 'm3', name: 'Aphantasia Network', keywords: ['aphantasia'], brands: null, always: false, instagram: 'aphantasianetwork', facebook: '111497816896431', linkedin: 'urn:li:organization:64697377', twitter: null, bluesky: null, mastodon: null };
const dji = { id: 'm4', name: 'DJI', keywords: ['dji', 'mavic'], brands: null, always: false, instagram: 'djiglobal', facebook: null, linkedin: null, twitter: null, bluesky: null, mastodon: null };

test('mentions: only known tags, whole words, per-platform form, one tag line above the hashtags', () => {
  const all = [austrade, gallery, aphantasia, dji];
  assert.deepEqual(suggestMentions(all, { brand: 'kessmedia', texts: ['A national image library for Austrade.'] }).map((m) => m.name), ['Austrade']);
  assert.deepEqual(suggestMentions(all, { brand: 'kessmedia', texts: ['Austradenetzero UNSW'] }).map((m) => m.name), []);
  assert.deepEqual(suggestMentions(all, { brand: 'alexkess', texts: ['Opera House Sunrise'] }).map((m) => m.name), ['Kess Gallery']);
  assert.deepEqual(suggestMentions(all, { brand: 'kessmedia', texts: ['Shot on the Mavic 4 Pro'] }).map((m) => m.name), ['DJI']);
  assert.equal(mentionText(austrade, 'instagram'), '@austradeofficial');
  assert.equal(mentionText(austrade, 'threads'), '@austradeofficial');
  assert.equal(mentionText(austrade, 'linkedin'), '@mention[Austrade](urn:li:organization:7867)');
  assert.equal(mentionText(aphantasia, 'facebook'), '@mention[Aphantasia Network](111497816896431)');
  assert.equal(mentionText(austrade, 'facebook'), 'Austrade');
  assert.equal(mentionText(austrade, 'bluesky'), 'Austrade');
  const cap = 'Sydney.\nOpera House Sunrise.\n#alexkess #sydney';
  const once = insertMention(cap, '@kessgallery');
  assert.equal(once, 'Sydney.\nOpera House Sunrise.\n@kessgallery\n#alexkess #sydney');
  const twice = insertMention(once, '@austradeofficial');
  assert.equal(twice, 'Sydney.\nOpera House Sunrise.\n@kessgallery @austradeofficial\n#alexkess #sydney');
  assert.equal(insertMention(twice, '@kessgallery'), twice);
  assert.equal(insertMention('Sydney.\nOpera House Sunrise.', 'Kess Gallery'), 'Sydney.\nOpera House Sunrise.\nKess Gallery');
});

// ---------- names ----------
test('names: file names cleaned, location deduped, iPhone and year added under the name', () => {
  for (const [title, parent, expected] of [
    ['ANB Austrade 2025 029 Community Harvest', 'Australia.', 'Community Harvest'], ['Austradenetzero 01 UNSW 00176', 'Austrade', 'UNSW'],
    ['Iphone 366 Iphoneography', 'iPhoneography', 'iPhoneography'], ['Hills Shire Dji 0036 4 Gigapixel Standard Width 8000px', 'Hills Shire', 'Hills Shire'],
    ['Northline Commercial Lightpainting 11', 'Northline', 'Commercial Lightpainting'], ['Aerial Coast 07', 'Travel', 'Aerial Coast'],
    ['Braille, Bare Island #12', 'Film', 'Braille, Bare Island #12'], ['Street on Iphone', 'x', 'Street on iPhone'], ['Akp 1234', 'Australia.', 'Australia'],
    ['Iphone a Day to Remember 19 of 366 Mobile Photography Project', 'iPhoneography', 'A Day to Remember'], ['Iphone Photo 55365 Botany Bay True Hdr', 'iPhoneography', 'Botany Bay'],
  ]) assert.equal(cleanName(title, parent), expected, title);
  assert.equal(dedupeLocation('Sydney Opera House.\nOpera House Sunrise.\n@sydneyoperahouse\n#alexkess #sydney'), 'Sydney.\nOpera House Sunrise.\n@sydneyoperahouse\n#alexkess #sydney');
  assert.equal(dedupeLocation('Cronulla.\nCronulla Pools.\n#alexkess'), 'Cronulla Pools.\n#alexkess');
  assert.equal(dedupeLocation('North Cronulla.\nRowing Out.'), 'North Cronulla.\nRowing Out.');
  assert.equal(withShotOn('Cronulla.\nRock Pool.\n#sydney', 'iPhone 3GS', '2010'), 'Cronulla.\nRock Pool.\niPhone 3GS, 2010.\n#sydney');
  assert.equal(withShotOn('Shot on an iphone 3gs in 2010.', 'iPhone 3GS', '2010'), 'Shot on an iphone 3gs in 2010.');
  assert.equal(withShotOn('Rock Pool.\n#a #bb', 'iPhone 3GS', '2010', 34), 'Rock Pool.\niPhone 3GS, 2010.\n#a');
  assert.equal(withShotOn('Rock Pool.', 'iPhone 3GS', '2010', 12), 'Rock Pool.');
});

// ---------- captions ----------
const caccounts = [{ accountId: 'ig', platform: 'instagram', label: '@x', charLimit: 2200, requiresMedia: true }, { accountId: 'bs', platform: 'bluesky', label: '@x', charLimit: 300, requiresMedia: false }];
const cbrand = { brand: 'alexkess', accounts: caccounts, voice: 'Short.', linkDomain: 'alexkess.com', defaultHashtags: ['#alexkess'] };
const citem = { id: 'i', brand: 'alexkess', source: 'sanity', sourceId: 's', parentId: 'p', parentTitle: 'Aerials', parentUrl: 'https://alexkess.com/projects/aerials', kind: 'image', imageUrl: 'u', imageW: 1, imageH: 1, title: 'Cronulla', context: { focalLength: '24mm' }, position: 0, brief: 'shot at dawn', status: 'active', retiredReason: null, createdAt: '2026-01-01T00:00:00Z', lastPostedAt: null, timesPosted: 0, restUntil: null };
const input = { brand: cbrand, item: citem, siblings: [], recentCaptions: ['Old one.'] };

test('captions: prompt carries voice, rules, context, brief first, accounts, recent captions, never a price', () => {
  const { system, user } = buildCaptionPrompt(input);
  for (const s of ['Short.', 'em dash']) assert.ok(system.includes(s));
  for (const s of ['Cronulla', '24mm', 'shot at dawn', 'bluesky "@x" (max 300)', 'Old one.']) assert.ok(user.includes(s), s);
  const priced = buildCaptionPrompt({ ...input, item: { ...citem, context: { priceFrom: '180', printTypes: ['Canvas'] } } }).user;
  assert.ok(!priced.includes('180') && !priced.includes('priceFrom') && priced.includes('Canvas'));
  const named = buildCaptionPrompt({ ...input, item: { ...citem, title: 'Aerial Beach Figure Sunset', parentTitle: 'Sydney', brief: 'Opera House Sunrise' } }).user;
  assert.ok(named.includes('Brief from Alex (this overrides the name, the location and every other rule): Opera House Sunrise'));
  assert.ok(named.indexOf('Brief from Alex') < named.indexOf('Stored image name'));
  assert.ok(buildCaptionPrompt({ ...input, item: { ...citem, title: 'ANB Austrade 2025 029 Community Harvest', parentTitle: 'Australia.' } }).user.includes('Stored image name (use only if the brief does not name it): Community Harvest'));
});

test('captions: check rejects em dashes, over length, missing accounts and links where they are not allowed', () => {
  const good = { base: 'Cronulla from above.', variants: [{ account_id: 'ig', caption: 'Cronulla from above. #alexkess' }, { account_id: 'bs', caption: 'Cronulla from above.' }] };
  assert.deepEqual(checkCaptions(good, caccounts), { ok: true, value: { base: 'Cronulla from above.', variants: { ig: 'Cronulla from above. #alexkess', bs: 'Cronulla from above.' } } });
  like(checkCaptions({ ...good, base: 'A — B' }, caccounts), { ok: false, problems: ['base contains an em dash'] });
  like(checkCaptions({ ...good, variants: [good.variants[0], { account_id: 'bs', caption: 'x'.repeat(301) }] }, caccounts), { ok: false, problems: ['bs exceeds 300 characters'] });
  like(checkCaptions({ ...good, variants: [good.variants[0]] }, caccounts), { ok: false, problems: ['bs missing'] });
  like(checkCaptions('nope', caccounts), { ok: false });
  const three = [caccounts[0], { accountId: 'li', platform: 'linkedin', label: 'x', charLimit: 3000, requiresMedia: false }, { accountId: 'bs', platform: 'bluesky', label: 'x', charLimit: 300, requiresMedia: false }];
  like(checkCaptions({ base: 'b', variants: [{ account_id: 'ig', caption: 'x kess.gallery/products/a' }, { account_id: 'li', caption: 'x https://kess.media' }, { account_id: 'bs', caption: 'x https://alexkess.com/portfolio/sydney' }] }, three), { ok: false, problems: ['ig must not contain a link', 'li must not contain a link'] });
  assert.ok(captionHasLink('see kess.media/work/daff', 'https://kess.media/work/daff'));
});

test('captions: an em dash is sent back once with the problem named, then scrubbed in the fallback', async () => {
  const calls = [];
  const client = { complete: async (_s, u) => { calls.push(u); return JSON.stringify({ base: 'A — B', variants: [{ account_id: 'ig', caption: 'ok' }, { account_id: 'bs', caption: 'ok' }] }); } };
  const r = await generateCaptions(client, input);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes('base contains an em dash'));
  assert.equal(r.base, 'A, B');
  assert.equal(r.variants.bs, 'A, B');
  assert.ok(!/—/.test(JSON.stringify(r)));
});

test('captions: Alex Kess tidy (location deduped, phone and year), other brands untouched, Dropbox photos sent as images', async () => {
  const one = (base, ig, bs) => ({ complete: async () => JSON.stringify({ base, variants: [{ account_id: 'ig', caption: ig }, { account_id: 'bs', caption: bs }] }) });
  const r = await generateCaptions(one('Sydney Opera House.\nOpera House Sunrise.', 'Sydney Opera House.\nOpera House Sunrise.\n#alexkess', 'x'), input);
  assert.equal(r.base, 'Sydney.\nOpera House Sunrise.');
  assert.equal(r.variants.ig, 'Sydney.\nOpera House Sunrise.\n#alexkess');
  const ip = await generateCaptions(one('Sydney.\nOpera Moment.', 'Sydney.\nOpera Moment.\n\n#iphoneography', 'Sydney.\nOpera Moment. iPhone 4S, 2012.'), { ...input, item: { ...citem, context: { camera: 'iPhone 4S', year: '2012' } } });
  assert.equal(ip.base, 'Sydney.\nOpera Moment.\niPhone 4S, 2012.');
  assert.equal(ip.variants.ig, 'Sydney.\nOpera Moment.\niPhone 4S, 2012.\n\n#iphoneography');
  assert.equal(ip.variants.bs, 'Sydney.\nOpera Moment. iPhone 4S, 2012.');
  assert.equal((await generateCaptions(one('Sydney Opera House.\nOpera House Sunrise.', 'a', 'b'), { ...input, brand: { ...cbrand, brand: 'gallery' } })).base, 'Sydney Opera House.\nOpera House Sunrise.');
  const seen = [];
  let prompt = '';
  const watcher = { complete: async (_s, u, img) => { seen.push(img); prompt = u; return JSON.stringify({ base: 'a', variants: [{ account_id: 'ig', caption: 'a' }, { account_id: 'bs', caption: 'a' }] }); } };
  await generateCaptions(watcher, { ...input, item: { ...citem, source: 'dropbox', imageUrl: 'https://x/a.jpg' } });
  assert.ok(prompt.includes('describe only what you can see'));
  await generateCaptions(watcher, input);
  assert.deepEqual(seen, ['https://x/a.jpg', undefined]);
});

test('captions: Regenerate keeps edited captions unless "overwrite my edits"; errors are described by code only', () => {
  const fresh = { base: 'new', variants: { ig: 'new ig', bs: 'new bs' } };
  const existing = [{ accountId: 'ig', caption: 'my edit', edited: true }, { accountId: 'bs', caption: 'old', edited: false }];
  assert.deepEqual(mergeEdits(fresh, existing, false).variants, { ig: 'my edit', bs: 'new bs' });
  assert.deepEqual(mergeEdits(fresh, existing, true).variants, { ig: 'new ig', bs: 'new bs' });
  class NotFoundError extends Error { status = 404; error = { error: { type: 'not_found_error', message: 'model: secret detail' } }; }
  assert.deepEqual(describeError(new NotFoundError('model: secret detail')), { name: 'NotFoundError', status: 404, type: 'not_found_error' });
  class BadRequestError extends Error { status = 400; error = { error: { type: 'invalid_request_error', message: 'output_config.format: unsupported' } }; }
  assert.deepEqual(describeError(new BadRequestError('x')), { name: 'BadRequestError', status: 400, type: 'invalid_request_error', detail: 'output_config.format: unsupported' });
  assert.deepEqual(describeError(new Error('captions:no-text')), { name: 'captions:no-text' });
  assert.deepEqual(describeError(new Error('free text with a caption in it')), { name: 'Error' });
  assert.deepEqual(describeError('nope'), { name: 'unknown' });
});

// ---------- sync ----------
const si = (sourceId, over = {}) => ({ brand: 'gallery', source: 'shopify', sourceId, parentId: 'p', parentTitle: 'P', parentUrl: 'u', kind: 'product', imageUrl: 'i', imageW: null, imageH: null, title: 't', context: {}, position: 0, ...over });
test('sync: retire gone, revive returned, keep Never retired, leave studio and dropbox rows, never retire on an empty fetch', () => {
  assert.deepEqual(planUpsert([], [si('a'), si('b'), si('a')]).upsert.map((i) => i.sourceId), ['a', 'b']);
  const existing = [{ sourceId: 'a', status: 'active', retiredReason: null }, { sourceId: 'b', status: 'active', retiredReason: null }, { sourceId: 'c', status: 'retired', retiredReason: 'gone' }];
  const plan = planUpsert(existing, [si('a'), si('c'), si('d')]);
  assert.deepEqual([plan.retire, plan.revive], [['b'], ['c']]);
  assert.deepEqual(planUpsert([{ sourceId: 'a', status: 'active', retiredReason: null }], []).retire, []);
  assert.deepEqual(planUpsert([{ sourceId: 'gone', status: 'retired', retiredReason: 'gone' }, { sourceId: 'never', status: 'retired', retiredReason: 'never' }], [si('gone'), si('never')]).revive, ['gone']);
  assert.deepEqual(planUpsert([{ sourceId: 'mockup:1', source: 'studio', status: 'active', retiredReason: null }, { sourceId: 'dropbox:x', source: 'dropbox', status: 'active', retiredReason: null }, { sourceId: 'b', source: 'shopify', status: 'active', retiredReason: null }], [si('a')]).retire, ['b']);
  // map posters: left alone when the poster check was skipped, retired when it ran
  const withPoster = [{ sourceId: '1:10', status: 'active', retiredReason: null }, { sourceId: '1:map-poster', status: 'active', retiredReason: null }];
  assert.deepEqual(planUpsert(withPoster, [si('1:10')]).retire, []);
  assert.deepEqual(planUpsert(withPoster, [si('1:10'), si('2:map-poster')]).retire, ['1:map-poster']);
  assert.equal(errorName(new Error('shopify:graphql:errors:MAX_COST_EXCEEDED')), 'shopify:graphql:errors:MAX_COST_EXCEEDED');
  assert.equal(errorName(new TypeError('Failed to parse URL from https://x')), 'TypeError');
});

// ---------- cards ----------
const base = { id: 'i', brand: 'alexkess', source: 'sanity', sourceId: 's', parentId: 'p', parentTitle: 'Aerials', parentUrl: 'u', kind: 'image', imageUrl: 'https://cdn.sanity.io/x.jpg', imageW: 1, imageH: 1, title: 'Cronulla', context: {}, position: 0, brief: null, status: 'active', retiredReason: null, createdAt: '', lastPostedAt: null, timesPosted: 0, restUntil: null };
const s1 = { id: 's1', itemId: 'i', forDate: '2026-09-18', recipient: 'a', baseCaption: 'b', decision: 'pending', decidedBy: null, decidedAt: null };
const p1 = (itemIds) => ({ id: 'p1', suggestionId: 's1', brand: 'alexkess', itemIds, baseCaption: 'b', mode: null, scheduledAt: null, scheduledUntil: null, publerJobId: null, publerPostIds: null, state: 'pending', lockedAt: null, error: null, createdAt: '', sentAt: null });
const igAcc = [{ accountId: 'ig', platform: 'instagram', label: '@alexkess', charLimit: 2200, requiresMedia: true }];

test('cards: context line (prices inc GST), siblings, Make primary, rested siblings hidden, mention chips', () => {
  assert.equal(contextLine({ ...base, context: { locationOrTitle: 'Cronulla', focalLength: '24mm', client: 'DNSW' } }), 'Aerials · Cronulla · 24mm · DNSW');
  assert.equal(contextLine({ ...base, brand: 'gallery', kind: 'product', context: { priceFrom: '200', printTypes: ['Canvas'] } }), 'Aerials · from $200 inc GST · Canvas');
  assert.equal(contextLine({ ...base, kind: 'essay', context: { category: 'Reflections' } }), 'Aerials · Reflections · essay');
  const items = [base, { ...base, id: 'sib1', position: 1 }, { ...base, id: 'sib2', position: 2 }];
  const cards = buildCards({ suggestions: [s1], posts: [p1(['i', 'sib1'])], variants: [{ id: 'v1', postId: 'p1', accountId: 'ig', platform: 'instagram', caption: 'c', enabled: true, edited: false }], items, accounts: igAcc, today: '2026-09-18', recentSuggestions: [s1] });
  like(cards[0].variants[0], { label: '@alexkess', charLimit: 2200, caption: 'c' });
  assert.deepEqual(cards[0].siblings.map((s) => s.id), ['sib1', 'sib2']);
  assert.deepEqual(cards[0].selectedSiblingIds, ['sib1']);
  const later = buildCards({ suggestions: [s1], posts: [p1(['i'])], variants: [], items, accounts: igAcc, today: '2026-09-18', recentSuggestions: [s1, { ...s1, id: 's2', itemId: 'sib1', forDate: '2026-09-13', decision: 'later' }] });
  assert.deepEqual(later[0].siblings.map((s) => s.id), ['sib2']);
  const primary = buildCards({ suggestions: [s1], posts: [p1(['sib1', 'i'])], variants: [], items, accounts: igAcc, today: '2026-09-18', recentSuggestions: [] });
  assert.equal(primary[0].primary.id, 'sib1');
  assert.deepEqual(primary[0].siblings.map((x) => x.id), ['i', 'sib2']);
  const m = (id, name, keywords, instagram) => ({ id, name, keywords, brands: null, always: false, instagram, facebook: null, linkedin: null, twitter: null, bluesky: null, mastodon: null });
  const chips = buildCards({ suggestions: [s1], posts: [{ ...p1(['i']), brand: 'kessmedia' }], items: [{ ...base, brand: 'kessmedia', context: { client: 'Austrade' } }], accounts: igAcc, today: '2026-09-18', recentSuggestions: [],
    variants: [{ id: 'v1', postId: 'p1', accountId: 'ig', platform: 'instagram', caption: 'x\n@austradeofficial', enabled: true, edited: true }], mentions: [m('m1', 'Austrade', ['austrade'], 'austradeofficial'), m('m2', 'DJI', ['dji'], 'djiglobal')] });
  assert.deepEqual(chips[0].mentions, [{ id: 'm1', name: 'Austrade', added: true }]);
  assert.equal(thumb('https://cdn.shopify.com/s/files/a.jpg?v=1', 480), 'https://cdn.shopify.com/s/files/a.jpg?v=1&width=480');
});
