// SQLite store for Socials. Mirrors kess-socials src/lib/db.ts (makeDb) method for method, so the ported
// suggest, send and sync code reads the same. Methods are synchronous (node:sqlite); callers may still await them.
// Ids are text UUIDs, as in Supabase, so imported history keeps its ids. Arrays and JSON are stored as JSON text.
// Every timestamp is a full ISO string (toISOString), so text comparison matches time order.
import { randomUUID } from 'node:crypto';
import { j } from '../services.js';

/** A send left in sending for longer than this is treated as abandoned and can be retried. */
export const LOCK_STALE_MS = 10 * 60_000;
/** Studio mockups sit after a product's own images, so they are never its lead image. */
export const STUDIO_FIRST_POSITION = 100;

const nowIso = () => new Date().toISOString();
const qs = (n) => Array.from({ length: n }, () => '?').join(',');

export const rowToItem = (r) => ({
  id: r.id, brand: r.brand, source: r.source, sourceId: r.source_id, parentId: r.parent_id, parentTitle: r.parent_title, parentUrl: r.parent_url,
  kind: r.kind, imageUrl: r.image_url, imageW: r.image_w ?? null, imageH: r.image_h ?? null, title: r.title, context: j(r.context, {}) ?? {}, brief: r.brief ?? null,
  status: r.status, retiredReason: r.retired_reason ?? null, position: r.position, createdAt: r.created_at, lastPostedAt: r.last_posted_at ?? null, timesPosted: r.times_posted, restUntil: r.rest_until ?? null,
});
const rowToSuggestion = (r) => ({ id: r.id, itemId: r.item_id, forDate: r.for_date, recipient: r.recipient, baseCaption: r.base_caption ?? null, decision: r.decision, decidedBy: r.decided_by ?? null, decidedAt: r.decided_at ?? null, manual: Boolean(r.manual) });
const rowToPost = (r) => ({
  id: r.id, suggestionId: r.suggestion_id, brand: r.brand, itemIds: j(r.item_ids, []), baseCaption: r.base_caption, mode: r.mode ?? null, scheduledAt: r.scheduled_at ?? null,
  scheduledUntil: r.scheduled_until ?? null, publerJobId: r.publer_job_id ?? null, publerPostIds: j(r.publer_post_ids, null), state: r.state, lockedAt: r.locked_at ?? null,
  error: r.error ?? null, createdAt: r.created_at, sentAt: r.sent_at ?? null, dryRun: j(r.dry_run, null), dryRunAt: r.dry_run_at ?? null,
});
const rowToVariant = (r) => ({ id: r.id, postId: r.post_id, accountId: r.account_id, platform: r.platform, caption: r.caption, enabled: Boolean(r.enabled), edited: Boolean(r.edited) });
const rowToMention = (r) => ({ id: r.id, name: r.name, keywords: j(r.keywords, []) ?? [], brands: j(r.brands, null), always: Boolean(r.always), instagram: r.instagram ?? null, facebook: r.facebook ?? null, linkedin: r.linkedin ?? null, twitter: r.twitter ?? null, bluesky: r.bluesky ?? null, mastodon: r.mastodon ?? null });
const rowToBrand = (r) => ({ brand: r.brand, accounts: j(r.accounts, []), voice: r.voice, linkDomain: r.link_domain, defaultHashtags: j(r.default_hashtags, []) });

const POST_COLUMNS = new Set(['item_ids', 'base_caption', 'mode', 'scheduled_at', 'scheduled_until', 'publer_job_id', 'publer_post_ids', 'state', 'locked_at', 'error', 'sent_at', 'dry_run', 'dry_run_at']);
const JSON_POST_COLUMNS = new Set(['item_ids', 'publer_post_ids', 'dry_run']);

export function makeStore(db) {
  const BRAND_ORDER = "CASE brand WHEN 'gallery' THEN 0 WHEN 'kessmedia' THEN 1 WHEN 'alexkess' THEN 2 ELSE 3 END";
  const s = {
    // brand config
    brandConfigs() { return db.all(`SELECT * FROM social_brand ORDER BY ${BRAND_ORDER}`).map(rowToBrand); },

    // items
    listItems(brand, status = 'active') { return db.all('SELECT * FROM social_item WHERE brand = ? AND status = ? ORDER BY id', brand, status).map(rowToItem); },
    listSourceIds(brand) {
      return db.all('SELECT source_id, source, status, retired_reason FROM social_item WHERE brand = ? ORDER BY id', brand)
        .map((r) => ({ sourceId: r.source_id, source: r.source, status: r.status, retiredReason: r.retired_reason ?? null }));
    },
    /** Every active image of the given parents (products, projects): the sibling pool for a day's cards. */
    listItemsByParents(parentIds) {
      if (!parentIds.length) return [];
      return db.all(`SELECT * FROM social_item WHERE parent_id IN (${qs(parentIds.length)}) AND status = 'active' ORDER BY id`, ...parentIds).map(rowToItem);
    },
    postsForSuggestions(ids) { return ids.length ? db.all(`SELECT * FROM social_post WHERE suggestion_id IN (${qs(ids.length)})`, ...ids).map(rowToPost) : []; },
    variantsForPosts(ids) { return ids.length ? db.all(`SELECT * FROM social_variant WHERE post_id IN (${qs(ids.length)})`, ...ids).map(rowToVariant) : []; },
    listMentions() { return db.all('SELECT * FROM social_mention ORDER BY name').map(rowToMention); },
    getItems(ids) { return ids.length ? db.all(`SELECT * FROM social_item WHERE id IN (${qs(ids.length)})`, ...ids).map(rowToItem) : []; },
    upsertItems(items) {
      db.tx(() => {
        for (const i of items) {
          db.run(`INSERT INTO social_item (id, brand, source, source_id, parent_id, parent_title, parent_url, kind, image_url, image_w, image_h, title, context, position, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(brand, source_id) DO UPDATE SET source = excluded.source, parent_id = excluded.parent_id, parent_title = excluded.parent_title, parent_url = excluded.parent_url,
              kind = excluded.kind, image_url = excluded.image_url, image_w = excluded.image_w, image_h = excluded.image_h, title = excluded.title, context = excluded.context, position = excluded.position`,
          randomUUID(), i.brand, i.source, i.sourceId, i.parentId, i.parentTitle, i.parentUrl, i.kind, i.imageUrl, i.imageW ?? null, i.imageH ?? null, i.title, JSON.stringify(i.context ?? {}), i.position, nowIso());
        }
      });
    },
    setStatusBySourceIds(brand, sourceIds, status) {
      db.tx(() => { for (const id of sourceIds) db.run('UPDATE social_item SET status = ?, retired_reason = ? WHERE brand = ? AND source_id = ?', status, status === 'retired' ? 'gone' : null, brand, id); });
    },
    setItemStatus(id, status, reason) { db.run('UPDATE social_item SET status = ?, retired_reason = ? WHERE id = ?', status, status === 'retired' ? reason ?? null : null, id); },
    setBrief(id, brief) { db.run('UPDATE social_item SET brief = ? WHERE id = ?', brief, id); },
    /** Keeps images out of rotation until a date, without counting them as posted. */
    restItems(ids, untilIso) { db.tx(() => { for (const id of ids) db.run('UPDATE social_item SET rest_until = ? WHERE id = ?', untilIso, id); }); },
    markPosted(ids, at) { db.tx(() => { for (const id of ids) db.run('UPDATE social_item SET last_posted_at = ?, times_posted = times_posted + 1 WHERE id = ?', at, id); }); },

    // suggestions
    recentSuggestions(days, today) {
      const since = new Date(Date.parse(today + 'T00:00:00Z') - days * 86_400_000).toISOString().slice(0, 10);
      return db.all('SELECT * FROM social_suggestion WHERE for_date >= ? ORDER BY id', since).map(rowToSuggestion);
    },
    suggestionsForDate(date) { return db.all('SELECT * FROM social_suggestion WHERE for_date = ?', date).map(rowToSuggestion); },
    getSuggestion(id) { const r = db.get('SELECT * FROM social_suggestion WHERE id = ?', id); return r ? rowToSuggestion(r) : null; },
    insertSuggestion({ itemId, forDate, recipient, baseCaption, manual }) {
      const id = randomUUID();
      db.run('INSERT INTO social_suggestion (id, item_id, for_date, recipient, base_caption, manual) VALUES (?, ?, ?, ?, ?, ?)', id, itemId, forDate, recipient, baseCaption ?? null, manual ? 1 : 0);
      return rowToSuggestion(db.get('SELECT * FROM social_suggestion WHERE id = ?', id));
    },
    /** A product's lead image (its first Shopify image). */
    leadItem(parentId) {
      const r = db.get("SELECT * FROM social_item WHERE parent_id = ? AND source = 'shopify' AND position = 0 AND status = 'active'", parentId);
      return r ? rowToItem(r) : null;
    },
    /** Lead items (a product's first image, or any image or essay) whose title contains the words, for adding a card by hand. */
    searchItems(brand, q, limit) {
      const words = q.toLowerCase().replace(/[%_\\,()]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
      const where = words.map(() => 'AND title LIKE ?').join(' ');
      return db.all(`SELECT * FROM social_item WHERE brand = ? AND status = 'active' AND (kind <> 'product' OR position = 0) ${where} ORDER BY title COLLATE NOCASE LIMIT ?`, brand, ...words.map((w) => `%${w}%`), limit).map(rowToItem);
    },
    setDecision(id, decision, by, at) { db.run('UPDATE social_suggestion SET decision = ?, decided_by = ?, decided_at = ? WHERE id = ?', decision, by, at, id); },
    setSuggestionCaption(id, baseCaption) { db.run('UPDATE social_suggestion SET base_caption = ? WHERE id = ?', baseCaption, id); },

    // posts
    createPost({ suggestionId, brand, itemIds, baseCaption }) {
      const id = randomUUID();
      db.run('INSERT INTO social_post (id, suggestion_id, brand, item_ids, base_caption, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, suggestionId, brand, JSON.stringify(itemIds), baseCaption ?? '', nowIso());
      return s.getPost(id);
    },
    postForSuggestion(suggestionId) {
      const r = db.get('SELECT * FROM social_post WHERE suggestion_id = ? ORDER BY created_at DESC LIMIT 1', suggestionId);
      return r ? rowToPost(r) : null;
    },
    getPost(id) {
      const r = db.get('SELECT * FROM social_post WHERE id = ?', id);
      if (!r) throw new Error('db:getPost:empty');
      return rowToPost(r);
    },
    findPost(id) { const r = db.get('SELECT * FROM social_post WHERE id = ?', id); return r ? rowToPost(r) : null; },
    updatePost(id, patch) {
      const keys = Object.keys(patch).filter((k) => POST_COLUMNS.has(k));
      if (!keys.length) return;
      db.run(`UPDATE social_post SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (JSON_POST_COLUMNS.has(k) && patch[k] !== null ? JSON.stringify(patch[k]) : patch[k])), id);
    },
    /**
     * Returns true if this call moved the post into sending: either from pending or failed,
     * or by taking over a send that has been stuck in sending for more than ten minutes.
     */
    lockPost(id, now) {
      const fresh = db.run("UPDATE social_post SET state = 'sending', locked_at = ?, error = NULL WHERE id = ? AND state IN ('pending','failed')", now, id);
      if (fresh.changes === 1) return true;
      const staleBefore = new Date(Date.parse(now) - LOCK_STALE_MS).toISOString();
      return db.run("UPDATE social_post SET state = 'sending', locked_at = ?, error = NULL WHERE id = ? AND state = 'sending' AND locked_at < ?", now, id, staleBefore).changes === 1;
    },

    // variants
    variants(postId) { return db.all('SELECT * FROM social_variant WHERE post_id = ?', postId).map(rowToVariant); },
    getVariant(id) { const r = db.get('SELECT * FROM social_variant WHERE id = ?', id); return r ? rowToVariant(r) : null; },
    upsertVariants(postId, list) {
      db.tx(() => {
        for (const v of list) {
          db.run(`INSERT INTO social_variant (id, post_id, account_id, platform, caption, enabled, edited) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(post_id, account_id) DO UPDATE SET platform = excluded.platform, caption = excluded.caption, enabled = excluded.enabled, edited = excluded.edited`,
          randomUUID(), postId, v.accountId, v.platform, v.caption, v.enabled ?? true, v.edited ?? false);
        }
      });
    },
    updateVariant(id, patch) {
      const keys = ['caption', 'enabled', 'edited'].filter((k) => patch[k] !== undefined);
      if (keys.length) db.run(`UPDATE social_variant SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => patch[k]), id);
    },

    // ledger
    ledger(days, today) {
      const since = new Date(Date.parse(today + 'T00:00:00Z') - days * 86_400_000).toISOString();
      return db.all('SELECT * FROM social_post WHERE created_at >= ? ORDER BY created_at DESC', since).map(rowToPost);
    },
    /** Scheduled posts still ahead for the brand, with a title, so a window is not offered twice and says what holds it. */
    scheduledAhead(brand, fromIso, exceptPostId) {
      const rows = db.all("SELECT id, scheduled_at, item_ids FROM social_post WHERE brand = ? AND mode = 'schedule' AND state IN ('sent','sending') AND scheduled_at >= ?", brand, fromIso)
        .map((r) => ({ id: r.id, scheduled_at: r.scheduled_at, item_ids: j(r.item_ids, []) }));
      const live = rows.filter((r) => r.scheduled_at && r.id !== exceptPostId);
      const ids = [...new Set(live.map((r) => r.item_ids[0]).filter(Boolean))];
      const titles = new Map(ids.length ? db.all(`SELECT id, title FROM social_item WHERE id IN (${qs(ids.length)})`, ...ids).map((i) => [i.id, i.title]) : []);
      return live.map((r) => ({ at: r.scheduled_at, title: titles.get(r.item_ids[0]) ?? 'a scheduled post' }));
    },
    recentCaptions(brand, limit) {
      return db.all("SELECT base_caption FROM social_post WHERE brand = ? AND state = 'sent' ORDER BY sent_at DESC LIMIT ?", brand, limit).map((r) => r.base_caption);
    },

    // once-a-day markers (the Vercel app's digest_log), kept in Kess Cloud's job_runs
    ranToday(key) { return !!db.get('SELECT 1 FROM job_runs WHERE key = ?', key); },
    markRan(key) { db.run("INSERT INTO job_runs (key, ran_at) VALUES (?, datetime('now')) ON CONFLICT(key) DO UPDATE SET ran_at = excluded.ran_at", key); },
  };
  return s;
}
