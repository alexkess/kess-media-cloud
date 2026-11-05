// Sources and the remaining suggest cases. Ported from kess-socials shopify.test.ts, sanity-*.test.ts,
// studio-social.test.ts (map posters, adding a card by hand) and suggest.test.ts (recaption).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchShopifyItems, mapProduct, filesBase, findMapPosters } from '../server/lib/socials/sources/shopify.js';
import { fetchKessMediaItems, fetchAlexKessItems, sanityImage, KESSMEDIA_QUERY } from '../server/lib/socials/sources/sanity.js';
import { addManualCard, runRecaption, runSuggest } from '../server/lib/socials/suggest.js';
import { openDb } from '../server/db.js';
import { makeStore } from '../server/lib/socials/store.js';
import { like, json, fakeFetch } from './socials-helpers.js';

const product = {
  id: 'gid://shopify/Product/4842425548909', handle: 'stanwell-park-sunrise-pano', title: 'Stanwell Park Sunrise Pano', productType: 'Print', tags: ['Aerial', 'Beach'],
  descriptionHtml: '<p>Dawn over the escarpment.</p>', onlineStoreUrl: 'https://kess.gallery/products/stanwell-park-sunrise-pano',
  priceRangeV2: { minVariantPrice: { amount: '200.0', currencyCode: 'AUD' } },
  options: [{ name: 'Print Style Options', values: ['Fine Art Paper - Unframed', 'Acrylic Mounted', 'Canvas'] }, { name: 'Size in Centimetres', values: ['121w x 40h'] }],
  media: { nodes: [{ id: 'gid://shopify/MediaImage/1', image: { url: 'https://cdn.shopify.com/a.jpg', width: 3000, height: 1000, altText: null } }, { id: 'gid://shopify/MediaImage/2', image: { url: 'https://cdn.shopify.com/b.jpg', width: 1200, height: 1200, altText: 'Room' } }, { id: 'gid://shopify/Video/3' }] },
};

test('Shopify: one item per image, shared product context, client credentials, paging, GraphQL errors fail the run', async () => {
  const items = mapProduct(product);
  assert.equal(items.length, 2);
  like(items[0], { brand: 'gallery', source: 'shopify', sourceId: '4842425548909:1', parentId: '4842425548909', kind: 'product', position: 0, imageW: 3000, parentUrl: 'https://kess.gallery/products/stanwell-park-sunrise-pano' });
  like(items[0].context, { handle: 'stanwell-park-sunrise-pano', priceFrom: '200', printTypes: ['Fine Art Paper - Unframed', 'Acrylic Mounted', 'Canvas'], sizes: ['121w x 40h'], description: 'Dawn over the escarpment.' });
  assert.equal(items[1].position, 1);
  const f = fakeFetch((url, init) => {
    if (url.endsWith('/admin/oauth/access_token')) return json({ access_token: 'tok', expires_in: 86399 });
    if (init.method === 'HEAD') return new Response(null, { status: 404 });
    assert.equal(init.headers['X-Shopify-Access-Token'], 'tok');
    const page = JSON.parse(init.body).variables.after ? { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } : { nodes: [product], pageInfo: { hasNextPage: true, endCursor: 'c1' } };
    return json({ data: { products: page } });
  });
  assert.equal((await fetchShopifyItems(f, { store: 's.myshopify.com', clientId: 'id', clientSecret: 'sec' })).length, 2);
  assert.equal(f.calls[0].url, 'https://s.myshopify.com/admin/oauth/access_token');
  assert.equal(f.calls.filter((c) => c.url.includes('graphql.json')).length, 2);
  const errs = fakeFetch((url) => (url.endsWith('/access_token') ? json({ access_token: 'tok' }) : json({ data: { products: { nodes: [product], pageInfo: { hasNextPage: false } } }, errors: [{ message: 'Throttled' }] })));
  await assert.rejects(fetchShopifyItems(errs, { store: 's.myshopify.com', clientId: 'id', clientSecret: 'sec' }), /shopify:graphql:errors/);
});

const p2 = (handle, n) => ({ id: `gid://shopify/Product/${n}`, handle, title: handle.replace(/-/g, ' '), options: [], priceRangeV2: { minVariantPrice: { amount: '300.0' } },
  media: { nodes: [{ id: `gid://shopify/MediaImage/${n}0`, image: { url: `https://cdn.shopify.com/s/files/1/0054/8477/3427/products/${handle}-1.jpg?v=1`, width: 2048, height: 2048 } }] } });

test('map posters: found by HEAD in Shopify Files, after the product images; any unclear answer skips them all', async () => {
  assert.equal(filesBase('https://cdn.shopify.com/s/files/1/0054/8477/3427/products/a.jpg?v=1'), 'https://cdn.shopify.com/s/files/1/0054/8477/3427/files/');
  assert.equal(filesBase('https://cdn.shopify.com/a.jpg'), null);
  const f = fakeFetch((url) => (url.includes('turquoise-pool') ? new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } }) : new Response('no', { status: 404, headers: { 'content-type': 'text/html' } })));
  const posters = await findMapPosters(f, [p2('turquoise-pool', 1), p2('wave-squared', 2)]);
  assert.equal(posters.length, 1);
  like(posters[0], { sourceId: '1:map-poster', parentId: '1', position: 50, imageW: 1080, imageH: 1350, kind: 'product', imageUrl: 'https://cdn.shopify.com/s/files/1/0054/8477/3427/files/turquoise-pool-map-poster.jpg' });
  assert.ok(f.calls.every((c) => c.init.method === 'HEAD'));
  const unclear = fakeFetch((url) => (url.includes('wave') ? new Response('busy', { status: 503 }) : new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })));
  assert.deepEqual(await findMapPosters(unclear, [p2('turquoise-pool', 1), p2('wave-squared', 2)]), []);
});

test('Sanity kess.media: projects, then services and blog posts, one photo once, small and PNG images skipped', async () => {
  const project = { _id: 'p1', title: 'DAFF Meat Exports', client: 'DAFF', excerpt: 'A four-part series.', category: 'training', link: '/work/daff-meat-exports', slug: 'daff-meat-exports',
    imgs: [{ key: 'hero', ref: 'image-aaa-3840x2160-jpg', alt: 'Aerial farmland' }, { key: 'g1', ref: 'image-bbb-3984x2656-jpg', alt: 'Crew filming', caption: 'Filming in Canberra' }, { key: 'g2', ref: 'image-aaa-3840x2160-jpg', alt: 'dup', caption: 'dup' }, { key: 'g3', ref: null }] };
  const service = { _id: 's1', title: 'Drone Photography & Video', slug: 'drone', excerpt: 'CASA-licensed aerials.', imgs: [{ key: 'image', ref: 'image-bbb-3984x2656-jpg' }, { key: 'b1', ref: 'image-ccc-2048x1534-jpg', alt: 'Narooma from above', caption: null }, { key: 'b2', ref: 'image-ddd-800x446-jpg' }] };
  const post = { _id: 'b1', title: 'Inside Australia\'s largest barramundi farm', slug: 'barramundi', excerpt: 'On assignment for Austrade.', category: 'Field Notes', imgs: [{ key: 'hero', ref: 'image-eee-2048x1365-jpg' }, { key: 'image', ref: 'image-fff-1788x1186-png' }] };
  const f = fakeFetch(() => json({ result: { projects: [project], services: [service], posts: [post] } }));
  const items = await fetchKessMediaItems(f);
  assert.deepEqual(items.map((i) => i.sourceId), ['p1:hero', 'p1:g1', 's1:b1', 'b1:hero']);
  like(items[1], { title: 'Filming in Canberra', position: 1, context: { alt: 'Crew filming', client: 'DAFF', excerpt: 'A four-part series.', category: 'training' } });
  like(items[2], { parentUrl: 'https://kess.media/services/drone', context: { page: 'service' } });
  like(items[3], { parentUrl: 'https://kess.media/blog/barramundi', context: { page: 'blog post' } });
  assert.match(f.calls[0].url, /^https:\/\/sdgel12z\.api\.sanity\.io\/v2026-04-28\/data\/query\/production\?query=.*&perspective=published$/);
  await assert.rejects(fetchKessMediaItems(async () => new Response('x', { status: 500 })), /sanity:sdgel12z:500/);
  assert.ok(KESSMEDIA_QUERY.includes('_type == "project"'));
  assert.deepEqual(sanityImage('sdgel12z', 'image-49373b0bfd4b6a606d5c7acf1273e45c3b57bf93-3840x2160-jpg'), { url: 'https://cdn.sanity.io/images/sdgel12z/production/49373b0bfd4b6a606d5c7acf1273e45c3b57bf93-3840x2160.jpg', w: 3840, h: 2160 });
  assert.equal(sanityImage('x', 'nope'), null);
});

test('Sanity alexkess.com: portfolio and commission URLs, essays with canonical links, iPhone and year from the EXIF table', async () => {
  const fixture = {
    projects: [{ _id: 'pr1', _type: 'project', title: 'Aerials', slug: 'aerials', description: 'From above.', client: null, cover: { ref: 'image-c1-2500x1667-jpg', alt: 'Cover' }, gallery: [{ key: 'a', ref: 'image-a1-2500x1667-jpg', alt: 'Cronulla', caption: null, locationOrTitle: 'Cronulla', focalLength: '24mm', exposure: 'f/5.6' }] }],
    commissions: [{ _id: 'co1', _type: 'commission', title: 'Vivid', slug: 'vivid', description: 'Light festival', client: 'Destination NSW', cover: { ref: 'image-fa1-2500x1667-jpg' }, gallery: [] },
      { _id: 'commission_iphoneography', _type: 'commission', title: 'iPhoneography', slug: 'iphoneography', cover: {}, gallery: [{ key: 'k1', ref: 'image-4f585aae2183a3fc87306c4f39f4f9289893b5cf-2244x2245-jpg', locationOrTitle: 'Opera Moment' }] }],
    essays: [{ _id: 'es1', title: 'The Empty Canvas in My Head', slug: 'the-empty-canvas', deck: 'Discovering aphantasia at 48.', category: 'Reflections', canonicalUrl: null, cover: { ref: 'image-e1-2400x1600-jpg' } }],
  };
  const items = await fetchAlexKessItems(async () => json({ result: fixture }));
  assert.deepEqual(items.map((i) => i.sourceId), ['pr1:cover', 'pr1:a', 'co1:cover', 'commission_iphoneography:k1', 'es1']);
  like(items[1], { title: 'Cronulla', parentUrl: 'https://alexkess.com/portfolio/aerials', context: { focalLength: '24mm', locationOrTitle: 'Cronulla' } });
  like(items[2], { parentUrl: 'https://alexkess.com/projects/vivid', context: { client: 'Destination NSW' } });
  like(items[3].context, { camera: 'iPhone 4S', year: '2012' });
  like(items[4], { kind: 'essay', parentUrl: 'https://alexkess.com/journal/the-empty-canvas', context: { canonicalUrl: 'https://alexkess.com/journal/the-empty-canvas' } });
});

// ---------- suggest, against the real SQLite store ----------
function fresh() {
  const db = openDb(':memory:');
  db.run("INSERT INTO social_brand (brand, accounts, voice, link_domain, default_hashtags) VALUES ('gallery', ?, 'v', 'kess.gallery', '[]')", JSON.stringify([{ accountId: 'ig', platform: 'instagram', label: 'ig', charLimit: 2200, requiresMedia: true }]));
  const s = makeStore(db);
  s.upsertItems([
    { brand: 'gallery', source: 'shopify', sourceId: '1:10', parentId: '1', parentTitle: 'Turquoise Pool', parentUrl: 'u', kind: 'product', imageUrl: 'x', imageW: 1, imageH: 1, title: 'Turquoise Pool', context: {}, position: 0 },
    { brand: 'gallery', source: 'studio', sourceId: 'mockup:1', parentId: '1', parentTitle: 'Turquoise Pool', parentUrl: 'u', kind: 'product', imageUrl: 'm', imageW: 1, imageH: 1, title: 'Turquoise Pool', context: {}, position: 100 },
    { brand: 'gallery', source: 'shopify', sourceId: '9:90', parentId: '9', parentTitle: 'Other', parentUrl: 'u', kind: 'product', imageUrl: 'o', imageW: 1, imageH: 1, title: 'Other', context: {}, position: 1 },
  ]);
  const id = (sid) => db.get('SELECT id FROM social_item WHERE source_id = ?', sid).id;
  return { db, s, id };
}
const ok = { complete: async () => JSON.stringify({ base: 'Base.', variants: [{ account_id: 'ig', caption: 'IG.' }] }) };
const at = () => new Date('2026-10-09T23:00:00Z'); // 10/10/2026 in Sydney

test('adding a card by hand: manual, with a mockup as second image, warns when posted lately, never doubled', async () => {
  const { s, id } = fresh();
  s.markPosted([id('1:10')], '2026-09-30T08:00:00.000Z');
  const deps = { db: s, captions: ok, now: at, log: () => {}, recipient: 'alex@kess.media' };
  assert.deepEqual(await addManualCard(deps, { itemId: id('1:10'), extraItemIds: [id('mockup:1'), id('9:90')] }), { ok: true, date: '2026-10-10', warning: 'It was last posted on 30/09/2026.' });
  const sug = s.suggestionsForDate('2026-10-10')[0];
  like(sug, { manual: true, baseCaption: 'Base.' });
  assert.deepEqual(s.postForSuggestion(sug.id).itemIds, [id('1:10'), id('mockup:1')], 'an image from another print is ignored');
  like(await addManualCard(deps, { itemId: id('1:10') }), { ok: false, date: '2026-10-10' });
  assert.equal((await addManualCard(deps, { itemId: id('9:90') })).ok, false, 'a product extra image cannot lead');
  assert.equal((await addManualCard(deps, { itemId: id('mockup:1') })).ok, false, 'a mockup cannot lead either');
});

test('recaption: fills cards with no captions and accounts added later, never touches existing text', async () => {
  const { db, s } = fresh();
  const down = { complete: async () => { throw new Error('boom'); } };
  const r = await runSuggest({ db: s, captions: down, now: at, recipient: 'a', log: () => {} });
  assert.equal(r.created, 1);
  const [sug] = s.suggestionsForDate('2026-10-10');
  assert.equal(sug.baseCaption, null);
  const post = s.postForSuggestion(sug.id);
  const [v] = s.variants(post.id);
  s.updateVariant(v.id, { caption: 'my own words', edited: true });
  // Google Business added to the brand after the card was made
  db.run("UPDATE social_brand SET accounts = ? WHERE brand = 'gallery'", JSON.stringify([{ accountId: 'ig', platform: 'instagram', label: 'ig', charLimit: 2200, requiresMedia: true }, { accountId: 'gbp', platform: 'google', label: 'Kess Gallery', charLimit: 1500, requiresMedia: false }]));
  const writer = { complete: async () => JSON.stringify({ base: 'New base.', variants: [{ account_id: 'ig', caption: 'n' }, { account_id: 'gbp', caption: 'Local update.' }] }) };
  // three days later the card is still in the roster
  const res = await runRecaption({ db: s, captions: writer, now: () => new Date('2026-10-12T23:00:00Z'), log: () => {} });
  assert.deepEqual(res, { date: '2026-10-13', filled: 1, failed: 0 });
  assert.equal(s.getSuggestion(sug.id).baseCaption, 'New base.');
  const vs = s.variants(post.id);
  assert.equal(vs.find((x) => x.accountId === 'ig').caption, 'my own words');
  assert.equal(vs.find((x) => x.accountId === 'gbp').caption, 'Local update.');
  assert.deepEqual(await runRecaption({ db: s, captions: null, now: at, log: () => {} }), { date: '2026-10-10', filled: 0, failed: 0 });
});
