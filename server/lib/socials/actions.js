// What each Socials button does. Ported from kess-socials src/app/review/actions.ts and the cron routes
// (src/app/api/cron/{sync,suggest,recaption}/route.ts). The API (server/api/socials.js) and the daily jobs call these.
// Failures throw HttpError with the source's wording, so the screen shows the same messages the Vercel app did.
import { HttpError, bad, notFound } from '../http.js';
import { sendMail, appUrl } from '../mail.js';
import { anthropicCaptionClient, describeError, generateCaptions, mergeEdits } from './captions.js';
import { conformText } from './conform.js';
import { insertMention, mentionText } from './mentions.js';
import { ddmmyyyy, sydneyDate, sydneyLocalToIso } from './dates.js';
import { makeStore } from './store.js';
import { publerFromEnv } from './publer.js';
import { siblings } from './rotation.js';
import { sendPost } from './send.js';
import { accountTimes, parseWindowKey, windowTakenBy } from './slots.js';
import { addManualCard, runRecaption, runSuggest } from './suggest.js';
import { runSync } from './sync.js';
import { thumb } from './thumb.js';
import { fetchShopifyItems } from './sources/shopify.js';
import { fetchAlexKessItems, fetchKessMediaItems } from './sources/sanity.js';
import { BRAND_LABEL, BRANDS } from './types.js';
import { sendingOn } from './config.js';

// node --test sets NODE_TEST_CONTEXT in its workers; keep test output readable.
export const log = (stage, meta) => { if (!process.env.NODE_TEST_CONTEXT) console.log('[socials]', stage, meta ?? ''); };

/** A caption writer when ANTHROPIC_API_KEY is set, else null (cards are made without captions, as in the source). */
export function captionClientFromEnv() {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicCaptionClient(key) : null;
}

const notSent = (post) => { if (post.state === 'sent') throw bad('already sent'); };
const postOr404 = (store, id) => { const p = store.findPost(id); if (!p) throw notFound('Card not found'); return p; };

export function decide(db, user, suggestionId, decision) {
  if (!['later', 'never'].includes(decision)) throw bad('Pick Later or Never');
  const store = makeStore(db);
  const s = store.getSuggestion(suggestionId);
  if (!s) throw notFound('Card not found');
  store.setDecision(s.id, decision, user.email, new Date().toISOString());
  // Never retires that one image (undo on the Ledger). Later only rests it, through the suggestion's decision.
  if (decision === 'never') store.setItemStatus(s.itemId, 'retired', 'never');
  return { ok: true };
}

export function restoreItem(db, itemId) {
  const store = makeStore(db);
  if (!store.getItems([itemId]).length) throw notFound('Item not found');
  store.setItemStatus(itemId, 'active');
  return { ok: true };
}

export function saveBrief(db, itemId, brief) {
  makeStore(db).setBrief(itemId, String(brief ?? '').trim().slice(0, 2000) || null);
  return { ok: true };
}

export function setSiblings(db, postId, siblingIds) {
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  store.updatePost(postId, { item_ids: Array.from(new Set([post.itemIds[0], ...siblingIds.map(String)])).slice(0, 5) });
  return { ok: true };
}

export function makePrimary(db, postId, itemId) {
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  store.updatePost(postId, { item_ids: Array.from(new Set([String(itemId), ...post.itemIds])).slice(0, 5) });
  return { ok: true };
}

export function updateVariant(db, variantId, patch) {
  const store = makeStore(db);
  if (!store.getVariant(variantId)) throw notFound('Caption not found');
  const clean = {};
  if (patch.caption !== undefined) clean.caption = String(patch.caption).slice(0, 10_000);
  if (patch.enabled !== undefined) clean.enabled = Boolean(patch.enabled);
  store.updateVariant(variantId, { ...clean, ...(clean.caption !== undefined ? { edited: true } : {}) });
  return { ok: true };
}

export async function regenerate(db, postId, brief, overwrite, captions = captionClientFromEnv()) {
  if (!captions) throw bad('Captions are not set up yet (ANTHROPIC_API_KEY).');
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  const items = store.getItems(post.itemIds);
  const primary = items.find((i) => i.id === post.itemIds[0]);
  if (!primary) throw bad('item missing');
  const cleanBrief = String(brief ?? '').trim().slice(0, 2000) || null;
  store.setBrief(primary.id, cleanBrief);
  const cfg = store.brandConfigs().find((c) => c.brand === post.brand);
  if (!cfg) throw bad('brand config missing');
  const today = sydneyDate(new Date());
  const pool = store.listItems(post.brand);
  const chosen = siblings(primary, pool, store.recentSuggestions(120, today), today).filter((s) => post.itemIds.includes(s.id));
  try {
    const existing = store.variants(postId);
    const fresh = await generateCaptions(captions, { brand: cfg, item: { ...primary, brief: cleanBrief }, siblings: chosen, recentCaptions: store.recentCaptions(post.brand, 3) });
    const merged = mergeEdits(fresh, existing, overwrite);
    store.updatePost(postId, { base_caption: merged.base });
    store.setSuggestionCaption(post.suggestionId, merged.base);
    store.upsertVariants(postId, cfg.accounts.map((a) => ({ accountId: a.accountId, platform: a.platform, caption: merged.variants[a.accountId] ?? '', enabled: existing.find((v) => v.accountId === a.accountId)?.enabled ?? true, edited: !overwrite && (existing.find((v) => v.accountId === a.accountId)?.edited ?? false) })));
    return { ok: true };
  } catch (err) {
    log('regenerate:failed', describeError(err));
    throw new HttpError(502, 'caption generation failed, try again');
  }
}

/** Clears a stuck job id after Alex has checked Publer, so the post can be sent again. */
export function resetPublerJob(db, postId) {
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  store.updatePost(postId, { publer_job_id: null, state: 'failed' });
  return { ok: true };
}

/** Saves one caption Alex wrote, then carries it to every other account on the card, adjusting only hashtags, handles and length. */
export function conformOthers(db, postId, variantId, caption) {
  if (!String(caption ?? '').trim()) throw bad('write the caption first');
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  const existing = store.variants(postId);
  const source = existing.find((v) => v.id === variantId);
  if (!source) throw bad('caption missing');
  const configs = store.brandConfigs();
  const cfg = configs.find((c) => c.brand === post.brand);
  if (!cfg) throw bad('card incomplete');
  // Instagram handles of all three brands, so "@kessgallery" reads "Kess Gallery" where the @ would not link.
  const handles = Object.fromEntries(configs.flatMap((c) => c.accounts.filter((a) => a.platform === 'instagram' && a.label.startsWith('@')).map((a) => [a.label.slice(1).toLowerCase(), BRAND_LABEL[c.brand]])));
  store.updateVariant(variantId, { caption, edited: true });
  // Marked edited: they are Alex's words, so a later Regenerate leaves them alone unless told to overwrite.
  store.upsertVariants(postId, cfg.accounts.filter((a) => a.accountId !== source.accountId).map((a) => ({ accountId: a.accountId, platform: a.platform, caption: conformText({ text: caption, brand: cfg.brand, target: a, handles }), enabled: existing.find((v) => v.accountId === a.accountId)?.enabled ?? true, edited: true })));
  return { ok: true };
}

/** Saves what is on screen, so an action never works from captions older than what Alex sees. */
function flushCaptions(store, postId, captions = []) {
  const stored = store.variants(postId);
  for (const c of Array.isArray(captions) ? captions : []) {
    const was = stored.find((v) => v.id === c.variantId);
    if (!was || typeof c.caption !== 'string') continue;
    const enabled = c.enabled === undefined ? was.enabled : Boolean(c.enabled);
    if (was.caption === c.caption && was.enabled === enabled) continue;
    store.updateVariant(c.variantId, { caption: c.caption, enabled, ...(was.caption !== c.caption ? { edited: true } : {}) });
  }
}

/** Adds one tag from the curated list to every caption on the card, in each platform's form. */
export function addMention(db, postId, mentionId, captions) {
  const store = makeStore(db);
  const post = postOr404(store, postId);
  notSent(post);
  const m = store.listMentions().find((x) => x.id === mentionId);
  if (!m) throw bad('tag not found');
  flushCaptions(store, postId, captions);
  for (const v of store.variants(postId)) {
    const next = insertMention(v.caption, mentionText(m, v.platform));
    if (next !== v.caption) store.updateVariant(v.id, { caption: next, edited: true });
  }
  return { ok: true };
}

/**
 * Draft, Schedule or Post now. Without SOCIALS_SEND=1 this is a dry run: the exact Publer requests are built and
 * kept on the post, and nothing is sent. body: { mode, windowKey?, otherTime? (YYYY-MM-DDTHH:mm Sydney), captions }
 */
export async function send(db, user, postId, body, { publer, now = () => new Date() } = {}) {
  const mode = body.mode;
  if (!['draft', 'schedule', 'now'].includes(mode)) throw bad('Pick Draft, Schedule or Post now');
  const store = makeStore(db);
  const post = postOr404(store, postId);
  const dryRun = !sendingOn();
  if (!dryRun && !publer) {
    try { publer = publerFromEnv(); } catch { throw bad('Publer not configured'); }
  }
  // Flush what is on screen first, so a send never outruns a caption the blur save missed.
  flushCaptions(store, postId, body.captions);
  let scheduledAt;
  if (mode === 'schedule' && body.otherTime) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.otherTime)) throw bad('pick a time');
    scheduledAt = sydneyLocalToIso(body.otherTime);
  }
  // A part of the day was chosen: every account gets its own staggered time. Computed here, never trusted from the client.
  let scheduledTimes;
  if (mode === 'schedule' && body.windowKey && !scheduledAt) {
    const w = parseWindowKey(body.windowKey);
    const cfg = w && store.brandConfigs().find((c) => c.brand === post.brand);
    if (!w || !cfg) throw bad('pick a time');
    // The page may be stale: another card could have taken this window since it was drawn.
    const holder = windowTakenBy(cfg.brand, cfg.accounts, w.date, w.daypart, store.scheduledAhead(cfg.brand, now().toISOString(), postId));
    if (holder) throw new HttpError(409, `That window now holds "${holder}". Pick another.`);
    scheduledTimes = accountTimes(cfg.brand, cfg.accounts, w.date, w.daypart);
  }
  const r = await sendPost({ db: store, publer, now, log, dryRun }, { postId, mode, scheduledAt, scheduledTimes, by: user.email });
  if (!r.ok) throw new HttpError(r.error === 'already sent' ? 409 : 400, r.error);
  return r;
}

/** Lead items of one brand whose title matches, for "Post something else". */
export function searchCards(db, brand, q) {
  if (!BRANDS.includes(brand)) throw bad('unknown brand');
  const words = String(q ?? '').trim().slice(0, 60);
  if (words.length < 2) return { items: [] };
  const found = makeStore(db).searchItems(brand, words, 12);
  return { items: found.map((i) => ({ id: i.id, title: i.title, thumb: thumb(i.imageUrl, 160), detail: i.lastPostedAt ? `Last posted ${ddmmyyyy(i.lastPostedAt)}` : 'Not posted yet' })) };
}

/** Adds a card for today by hand. Returns the roster day to open. */
export async function addCard(db, user, itemId, { captions = captionClientFromEnv(), now = () => new Date(), extraItemIds } = {}) {
  const res = await addManualCard({ db: makeStore(db), captions, now, log, recipient: user.email }, { itemId: String(itemId ?? ''), extraItemIds });
  if (!res.ok) throw new HttpError(409, res.error, res.date ? { date: res.date } : undefined);
  return res;
}

/** Last 30 days per brand, the dry runs, and the retired list. Ported from src/app/ledger/page.tsx. */
export function ledger(db, now = new Date()) {
  const store = makeStore(db);
  const today = sydneyDate(now);
  const recent = store.ledger(30, today);
  const posts = recent.filter((p) => p.state !== 'pending');
  const dryRuns = recent.filter((p) => p.dryRunAt).sort((a, b) => b.dryRunAt.localeCompare(a.dryRunAt));
  const items = new Map(store.getItems([...new Set([...posts, ...dryRuns].map((p) => p.itemIds[0]).filter(Boolean))]).map((i) => [i.id, i]));
  const row = (p) => {
    const item = items.get(p.itemIds[0]);
    return { id: p.id, brand: p.brand, title: item?.title ?? 'item removed', thumb: item ? thumb(item.imageUrl, 160) : null, extra: p.itemIds.length - 1, state: p.state, mode: p.mode, scheduledAt: p.scheduledAt, scheduledUntil: p.scheduledUntil, sentAt: p.sentAt, error: p.error, dryRunAt: p.dryRunAt, dryRun: p.dryRun };
  };
  const retired = BRANDS.flatMap((b) => store.listItems(b, 'retired')).map((i) => ({ id: i.id, brand: i.brand, title: i.title, thumb: thumb(i.imageUrl, 160), reason: i.retiredReason }));
  return { brands: BRANDS.map((b) => ({ brand: b, label: BRAND_LABEL[b], posts: posts.filter((p) => p.brand === b).map(row) })), dryRuns: dryRuns.map(row), retired };
}

// ---------- the three jobs (the Vercel crons) ----------
const realFetch = (u, i) => fetch(u, i);

export function syncSources(fetchImpl = realFetch) {
  const { SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET } = process.env;
  return {
    // The source refused the whole run without Shopify keys; here Kess Gallery reports the error and the other brands still sync.
    gallery: () => (SHOPIFY_STORE && SHOPIFY_CLIENT_ID && SHOPIFY_CLIENT_SECRET
      ? fetchShopifyItems(fetchImpl, { store: SHOPIFY_STORE, clientId: SHOPIFY_CLIENT_ID, clientSecret: SHOPIFY_CLIENT_SECRET })
      : Promise.reject(new Error('shopify:not-configured'))),
    kessmedia: () => fetchKessMediaItems(fetchImpl),
    alexkess: () => fetchAlexKessItems(fetchImpl),
  };
}

export async function syncNow(db, { sources = syncSources() } = {}) {
  const report = await runSync({ db: makeStore(db), sources, log });
  return { ok: !Object.values(report).some((r) => r.error), report };
}

/** "Today's socials are ready" for the owner(s), in the app. Email only with SOCIALS_NOTIFY_EMAIL=1 (the source's digest). */
export function notifyReady(db, { date, total, brands }) {
  const title = "Today's socials are ready";
  const body = `${total} card${total === 1 ? '' : 's'} for ${ddmmyyyy(date)}: ${brands.map((b) => `${BRAND_LABEL[b.brand]} ${b.count}${b.short ? ' (pool is running low)' : ''}`).join(', ')}.`;
  const link = `#/socials?date=${date}`;
  for (const u of db.all("SELECT id, email, name, email_notify FROM users WHERE role = 'owner'")) {
    db.run('INSERT INTO notifications (user_id, audience, title, body, link) VALUES (?, ?, ?, ?, ?)', u.id, 'agency', title, body, link);
    if (process.env.SOCIALS_NOTIFY_EMAIL === '1' && u.email_notify) sendMail(db, { to: u.email, subject: title, heading: title, lines: [`Hi ${u.name.split(' ')[0]},`, body], button: { label: 'Open Socials', url: `${appUrl(db)}/${link}` } });
  }
}

export async function suggestNow(db, { captions = captionClientFromEnv(), now = () => new Date(), notify = true } = {}) {
  const owner = db.get("SELECT email FROM users WHERE role = 'owner' ORDER BY id LIMIT 1");
  return runSuggest({ db: makeStore(db), captions, now, log, recipient: owner?.email || 'alex@kess.media', notify: notify ? (n) => notifyReady(db, n) : undefined });
}

export async function recaptionNow(db, { captions = captionClientFromEnv(), now = () => new Date() } = {}) {
  return runRecaption({ db: makeStore(db), captions, now, log });
}
