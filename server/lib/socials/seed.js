// Socials defaults (brand accounts, voice cards, hashtags, curated mentions) and demo data.
import { readFileSync } from 'node:fs';
import { makeStore } from './store.js';
import { pick } from './rotation.js';
import { shiftDate, sydneyDate } from './dates.js';
import { NO_LINK_IN_CAPTION } from './links.js';
import { hashtagLimit } from './conform.js';
import { BRANDS } from './types.js';

export const DEFAULTS = JSON.parse(readFileSync(new URL('./defaults.json', import.meta.url), 'utf8'));
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Seeded mentions carry ids starting "seed-" so the Supabase import can replace them with the live rows. */
export const SEED_MENTION_PREFIX = 'seed-mention-';

/** Brand config and mentions from the source's seed, when Kess Cloud has none yet. Safe to call on every start. */
export function ensureSocialsDefaults(db) {
  for (const b of BRANDS) {
    const d = DEFAULTS.brands[b];
    if (d && !db.get('SELECT 1 FROM social_brand WHERE brand = ?', b)) {
      db.run('INSERT INTO social_brand (brand, accounts, voice, link_domain, default_hashtags) VALUES (?, ?, ?, ?, ?)', b, JSON.stringify(d.accounts), d.voice, d.link_domain, JSON.stringify(d.default_hashtags));
    }
  }
  if (!db.get('SELECT 1 FROM social_mention LIMIT 1')) {
    for (const m of DEFAULTS.mentions) {
      db.run('INSERT INTO social_mention (id, name, keywords, brands, always, instagram, facebook, linkedin, twitter, bluesky, mastodon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        SEED_MENTION_PREFIX + slug(m.name), m.name, JSON.stringify(m.keywords), m.brands ? JSON.stringify(m.brands) : null, m.always, m.instagram, m.facebook, m.linkedin, m.twitter, m.bluesky, m.mastodon, new Date().toISOString());
    }
  }
}

// ---------- demo ----------
// Self-contained artwork (SVG data URIs) so the demo works offline and in headless checks.
function art(title, hue, shape = 'sun') {
  const h2 = (hue + 40) % 360;
  const fig = shape === 'sun' ? '<circle cx="600" cy="420" r="120" fill="#F2EDE6" opacity=".85"/>' : shape === 'wave' ? '<path d="M0 620 Q300 520 600 620 T1200 620 V900 H0Z" fill="#1E5C34" opacity=".7"/>' : '<rect x="420" y="260" width="360" height="420" rx="18" fill="#1a1a1a" opacity=".55"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${h2},45%,30%)"/></linearGradient></defs><rect width="1200" height="900" fill="url(#g)"/>${fig}<text x="60" y="840" font-family="Inter,Arial" font-size="44" fill="#F2EDE6">${title.replace(/[<&>]/g, '')}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const DEMO_ITEMS = [
  // Kess Gallery: products with their extra images, a map poster and a Studio mockup.
  ...['Stanwell Park Sunrise Pano', 'Turquoise Pool', 'Wave Squared', 'Voodoo Poles I', 'Bare Island Fort'].flatMap((t, n) => {
    const pid = `demo-prod-${n + 1}`;
    const base = { brand: 'gallery', source: 'shopify', parentId: pid, parentTitle: t, parentUrl: `https://kess.gallery/products/${slug(t)}`, kind: 'product', title: t, context: { handle: slug(t), priceFrom: String(180 + n * 40), printTypes: ['Fine Art Paper', 'Acrylic', 'Canvas'], tags: ['Aerial'] } };
    const out = [{ ...base, sourceId: `${pid}:1`, imageUrl: art(t, 190 + n * 20), position: 0 }, { ...base, sourceId: `${pid}:2`, imageUrl: art(`${t} (detail)`, 200 + n * 20, 'wave'), position: 1 }];
    if (n < 2) out.push({ ...base, sourceId: `${pid}:map-poster`, imageUrl: art(`Map poster: ${t}`, 90, 'frame'), position: 50, context: { ...base.context, mapPoster: true, alt: `Map poster: where ${t} was taken` } });
    if (n === 0) out.push({ ...base, source: 'studio', sourceId: 'mockup:demo-1', imageUrl: art(`${t} in a living room`, 30, 'frame'), position: 100 });
    return out;
  }),
  // Kess Media: projects with clients, and a Dropbox photo whose client was not found.
  ...[['DAFF Meat Exports', 'DAFF', 'training'], ['Narooma for Austrade', 'Austrade', 'tourism'], ['Bega Cheese for Austrade', 'Austrade', 'tourism'], ['AI Leaders Forum', 'Connect Media', 'event'], ['Trinity Grammar Open Day', 'Trinity Grammar School', 'education']].flatMap(([t, client, category], n) => {
    const pid = `demo-km-${n + 1}`;
    return [0, 1, 2].map((k) => ({ brand: 'kessmedia', source: 'sanity', sourceId: `${pid}:${k}`, parentId: pid, parentTitle: t, parentUrl: `https://kess.media/work/${slug(t)}`, kind: 'image', title: k ? `${t}, frame ${k + 1}` : t, imageUrl: art(k ? `${t} ${k + 1}` : t, 120 + n * 25 + k * 8, k === 1 ? 'wave' : 'sun'), position: k, context: { client, category, excerpt: `${t}: photography and video by Kess Media.` } }));
  }),
  { brand: 'kessmedia', source: 'dropbox', sourceId: 'dropbox:demo1', parentId: 'dropbox:old/Q2', parentTitle: 'Kess Media', parentUrl: 'https://kess.media', kind: 'image', title: 'Kess Media', imageUrl: art('Event photo (Dropbox)', 330), position: 0, context: { client: null, folder: 'old/Q2', possibleClients: ['Jacobs', 'Cabra Bowls'] } },
  // Alex Kess: portfolio images and an essay.
  ...[['Cronulla', 'Aerials'], ['Opera House Sunrise', 'Sydney'], ['Humpty Doo', 'Australia.'], ['North Cronulla Rowing Out', 'Aerials'], ['Kurnell Firescape', 'iPhoneography']].flatMap(([t, parent], n) => {
    const pid = `demo-ak-${n + 1}`;
    return [0, 1].map((k) => ({ brand: 'alexkess', source: 'sanity', sourceId: `${pid}:${k}`, parentId: pid, parentTitle: parent, parentUrl: `https://alexkess.com/portfolio/${slug(parent)}`, kind: 'image', title: k ? `${t} II` : t, imageUrl: art(k ? `${t} II` : t, 20 + n * 30 + k * 10, k ? 'wave' : 'sun'), position: k, context: { locationOrTitle: t, ...(parent === 'iPhoneography' ? { camera: 'iPhone 4S', year: '2012' } : {}) } }));
  }),
  { brand: 'alexkess', source: 'sanity', sourceId: 'demo-essay-1', parentId: 'demo-essay-1', parentTitle: 'The Empty Canvas in My Head', parentUrl: 'https://alexkess.com/journal/the-empty-canvas', kind: 'essay', title: 'The Empty Canvas in My Head', imageUrl: art('The Empty Canvas in My Head', 260, 'frame'), position: 0, context: { category: 'Reflections', deck: 'Discovering aphantasia at 48.', canonicalUrl: 'https://alexkess.com/journal/the-empty-canvas' } },
];

/** Plausible captions that follow the platform rules (no links where they are not allowed, hashtag counts). */
function demoCaptions(cfg, item) {
  const tags = cfg.defaultHashtags;
  const link = item.parentUrl.replace(/^https:\/\//, '');
  const base = cfg.brand === 'alexkess' ? `${item.context.locationOrTitle || item.title}.\n${item.title}.` : cfg.brand === 'gallery' ? `${item.title}, seen from above.\nAvailable on fine art paper, acrylic or canvas.` : `${item.parentTitle}. ${item.context.client ? `Shot for ${item.context.client}. ` : ''}A day on location with the crew.`;
  const variants = {};
  for (const a of cfg.accounts) {
    const n = Math.min(hashtagLimit(cfg.brand, a.platform), tags.length);
    const parts = [base];
    if (!NO_LINK_IN_CAPTION.includes(a.platform)) parts.push(link);
    if (n) parts.push(tags.slice(0, Math.min(n, a.platform === 'instagram' ? 4 : n)).join(' '));
    variants[a.accountId] = parts.join('\n').slice(0, a.charLimit);
  }
  return { base, variants };
}

/**
 * Demo items once, then today's cards (topped up each start, so the demo always has a roster for today), a day of
 * history, a scheduled post holding tonight's Kess Gallery window, and a retired image. Synchronous and idempotent.
 */
export function seedSocialsDemo(db, { now = new Date(), recipient = 'alex@kess.media' } = {}) {
  ensureSocialsDefaults(db);
  const store = makeStore(db);
  const today = sydneyDate(now);
  if (!db.get("SELECT 1 FROM social_item WHERE source_id = 'demo-prod-1:1'")) {
    store.upsertItems(DEMO_ITEMS);
    const id = (sid) => db.get('SELECT id FROM social_item WHERE source_id = ?', sid).id;
    const ago = (d) => new Date(now.getTime() - d * 864e5).toISOString();
    // History: some items were posted before, one is resting after a draft, one was retired with Never.
    db.run('UPDATE social_item SET created_at = ?', ago(60));
    db.run('UPDATE social_item SET created_at = ? WHERE source_id = ?', ago(2), 'demo-prod-5:1');
    store.markPosted([id('demo-prod-3:1')], ago(200));
    store.markPosted([id('demo-ak-4:0')], ago(120));
    store.restItems([id('demo-km-5:0')], new Date(now.getTime() + 5 * 864e5).toISOString());
    store.setItemStatus(id('demo-ak-5:1'), 'retired', 'never');
    // Yesterday: one card Later, one sent and scheduled for tonight (so that window shows as taken).
    const yesterday = shiftDate(today, -1);
    const s1 = store.insertSuggestion({ itemId: id('demo-prod-4:1'), forDate: yesterday, recipient, baseCaption: 'Voodoo Poles I, seen from above.' });
    const p1 = store.createPost({ suggestionId: s1.id, brand: 'gallery', itemIds: [id('demo-prod-4:1')], baseCaption: s1.baseCaption });
    const tonight = new Date(Date.parse(`${today}T09:18:00.000Z`));
    store.updatePost(p1.id, { state: 'sent', mode: 'schedule', scheduled_at: tonight.toISOString(), scheduled_until: new Date(tonight.getTime() + 95 * 60_000).toISOString(), sent_at: ago(1), publer_job_id: 'demo-job' });
    store.setDecision(s1.id, 'approved', recipient, ago(1));
    store.markPosted([id('demo-prod-4:1')], ago(1));
    const s2 = store.insertSuggestion({ itemId: id('demo-km-4:0'), forDate: yesterday, recipient, baseCaption: 'AI Leaders Forum.' });
    store.createPost({ suggestionId: s2.id, brand: 'kessmedia', itemIds: [id('demo-km-4:0')], baseCaption: s2.baseCaption });
    store.setDecision(s2.id, 'later', recipient, ago(1));
  }
  // Today's three per brand, written like the daily run would, with demo captions in place of Claude's.
  if (!store.suggestionsForDate(today).some((s) => !s.manual)) {
    const configs = store.brandConfigs();
    const items = BRANDS.flatMap((b) => store.listItems(b));
    const picked = pick({ items, suggestions: store.recentSuggestions(120, today), today });
    for (const cfg of configs) {
      for (const item of picked[cfg.brand]) {
        const set = demoCaptions(cfg, item);
        const s = store.insertSuggestion({ itemId: item.id, forDate: today, recipient, baseCaption: set.base });
        const post = store.createPost({ suggestionId: s.id, brand: cfg.brand, itemIds: [item.id], baseCaption: set.base });
        store.upsertVariants(post.id, cfg.accounts.map((a) => ({ accountId: a.accountId, platform: a.platform, caption: set.variants[a.accountId] ?? '' })));
      }
    }
  }
  return { today };
}
