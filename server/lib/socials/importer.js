// Copies the kess-socials Supabase data into Kess Cloud's SQLite tables, over Supabase's REST API (PostgREST, no SDK).
// Used by scripts/import-socials-from-supabase.mjs. Supabase is the source of truth until the switch-over, so:
// - rows are upserted by their Supabase id, so re-running is safe and picks up what changed;
// - a local row that holds the same natural key under another id (an item the Kess Cloud sync found first, a card
//   made locally) gives way to the Supabase row: items are re-keyed (their cards follow), cards and captions replaced;
// - nothing else local is deleted, and local dry-run records on posts are kept;
// - image URLs are copied as they are, so they keep pointing at Supabase storage and the shop and Sanity CDNs.
// Everything runs in one transaction: a failed import leaves the database as it was.
import { SEED_MENTION_PREFIX } from './seed.js';

const TABLES = [
  ['brand_config', 'brand'], ['mention', 'id'], ['content_item', 'id'], ['suggestion', 'id'], ['post', 'id'], ['post_variant', 'id'],
];
const PAGE = 1000;
const ts = (v) => (v ? new Date(v).toISOString() : null);
const js = (v, fallback) => JSON.stringify(v ?? fallback);
const bool = (v) => (v ? 1 : 0);

export async function fetchSupabaseTables({ url, key, fetch: f = (u, i) => fetch(u, i) }) {
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const base = url.replace(/\/+$/, '');
  const out = {};
  for (const [table, order] of TABLES) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await f(`${base}/rest/v1/${table}?select=*&order=${order}.asc&limit=${PAGE}&offset=${offset}`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      if (!res.ok) throw new Error(`supabase:${table}:${res.status}`);
      const page = await res.json();
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    out[table] = rows;
  }
  return out;
}

/** Writes fetched Supabase rows into Kess Cloud. With dryRun the transaction is rolled back. Returns counts. */
export function importSocials(db, data, { dryRun = false } = {}) {
  const report = { brands: 0, mentions: 0, items: 0, rekeyed: 0, suggestions: 0, replacedLocalCards: 0, posts: 0, variants: 0, skipped: 0 };
  db.exec('BEGIN');
  try {
    // Lets an item change id while its cards point at it, inside this transaction only.
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const r of data.brand_config ?? []) {
      db.run(`INSERT INTO social_brand (brand, accounts, voice, link_domain, default_hashtags) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(brand) DO UPDATE SET accounts = excluded.accounts, voice = excluded.voice, link_domain = excluded.link_domain, default_hashtags = excluded.default_hashtags`,
      r.brand, js(r.accounts, []), r.voice ?? '', r.link_domain ?? '', js(r.default_hashtags, []));
      report.brands++;
    }
    if ((data.mention ?? []).length) db.run('DELETE FROM social_mention WHERE id LIKE ?', `${SEED_MENTION_PREFIX}%`);
    for (const m of data.mention ?? []) {
      db.run(`INSERT INTO social_mention (id, name, keywords, brands, always, instagram, facebook, linkedin, twitter, bluesky, mastodon, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, keywords = excluded.keywords, brands = excluded.brands, always = excluded.always, instagram = excluded.instagram, facebook = excluded.facebook,
          linkedin = excluded.linkedin, twitter = excluded.twitter, bluesky = excluded.bluesky, mastodon = excluded.mastodon`,
      m.id, m.name, js(m.keywords, []), m.brands ? JSON.stringify(m.brands) : null, bool(m.always), m.instagram ?? null, m.facebook ?? null, m.linkedin ?? null, m.twitter ?? null, m.bluesky ?? null, m.mastodon ?? null, ts(m.created_at) ?? new Date().toISOString());
      report.mentions++;
    }
    for (const i of data.content_item ?? []) {
      const local = db.get('SELECT id FROM social_item WHERE brand = ? AND source_id = ?', i.brand, i.source_id);
      if (local && local.id !== i.id) { rekeyItem(db, local.id, i.id); report.rekeyed++; }
      db.run(`INSERT INTO social_item (id, brand, source, source_id, parent_id, parent_title, parent_url, kind, image_url, image_w, image_h, title, context, brief, status, retired_reason, position, created_at, last_posted_at, times_posted, rest_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET brand = excluded.brand, source = excluded.source, source_id = excluded.source_id, parent_id = excluded.parent_id, parent_title = excluded.parent_title,
          parent_url = excluded.parent_url, kind = excluded.kind, image_url = excluded.image_url, image_w = excluded.image_w, image_h = excluded.image_h, title = excluded.title, context = excluded.context,
          brief = excluded.brief, status = excluded.status, retired_reason = excluded.retired_reason, position = excluded.position, created_at = excluded.created_at,
          last_posted_at = excluded.last_posted_at, times_posted = excluded.times_posted, rest_until = excluded.rest_until`,
      i.id, i.brand, i.source, i.source_id, i.parent_id, i.parent_title, i.parent_url, i.kind, i.image_url, i.image_w ?? null, i.image_h ?? null, i.title, js(i.context, {}), i.brief ?? null,
      i.status, i.retired_reason ?? null, i.position ?? 0, ts(i.created_at) ?? new Date().toISOString(), ts(i.last_posted_at), i.times_posted ?? 0, ts(i.rest_until));
      report.items++;
    }
    for (const s of data.suggestion ?? []) {
      if (!db.get('SELECT 1 FROM social_item WHERE id = ?', s.item_id)) { report.skipped++; continue; }
      for (const local of db.all('SELECT id FROM social_suggestion WHERE item_id = ? AND for_date = ? AND id <> ?', s.item_id, s.for_date, s.id)) { dropSuggestion(db, local.id); report.replacedLocalCards++; }
      db.run(`INSERT INTO social_suggestion (id, item_id, for_date, recipient, base_caption, decision, decided_by, decided_at, manual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET item_id = excluded.item_id, for_date = excluded.for_date, recipient = excluded.recipient, base_caption = excluded.base_caption, decision = excluded.decision,
          decided_by = excluded.decided_by, decided_at = excluded.decided_at, manual = excluded.manual`,
      s.id, s.item_id, String(s.for_date).slice(0, 10), s.recipient ?? '', s.base_caption ?? null, s.decision, s.decided_by ?? null, ts(s.decided_at), bool(s.manual));
      report.suggestions++;
    }
    for (const p of data.post ?? []) {
      if (!db.get('SELECT 1 FROM social_suggestion WHERE id = ?', p.suggestion_id)) { report.skipped++; continue; }
      // dry_run and dry_run_at are Kess Cloud's own, so an update leaves them alone.
      db.run(`INSERT INTO social_post (id, suggestion_id, brand, item_ids, base_caption, mode, scheduled_at, scheduled_until, publer_job_id, publer_post_ids, state, locked_at, error, created_at, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET suggestion_id = excluded.suggestion_id, brand = excluded.brand, item_ids = excluded.item_ids, base_caption = excluded.base_caption, mode = excluded.mode,
          scheduled_at = excluded.scheduled_at, scheduled_until = excluded.scheduled_until, publer_job_id = excluded.publer_job_id, publer_post_ids = excluded.publer_post_ids, state = excluded.state,
          locked_at = excluded.locked_at, error = excluded.error, created_at = excluded.created_at, sent_at = excluded.sent_at`,
      p.id, p.suggestion_id, p.brand, js(p.item_ids, []), p.base_caption ?? '', p.mode ?? null, ts(p.scheduled_at), ts(p.scheduled_until), p.publer_job_id ?? null, p.publer_post_ids ? JSON.stringify(p.publer_post_ids) : null,
      p.state, ts(p.locked_at), p.error ?? null, ts(p.created_at) ?? new Date().toISOString(), ts(p.sent_at));
      report.posts++;
    }
    for (const v of data.post_variant ?? []) {
      if (!db.get('SELECT 1 FROM social_post WHERE id = ?', v.post_id)) { report.skipped++; continue; }
      db.run('DELETE FROM social_variant WHERE post_id = ? AND account_id = ? AND id <> ?', v.post_id, v.account_id, v.id);
      db.run(`INSERT INTO social_variant (id, post_id, account_id, platform, caption, enabled, edited) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET post_id = excluded.post_id, account_id = excluded.account_id, platform = excluded.platform, caption = excluded.caption, enabled = excluded.enabled, edited = excluded.edited`,
      v.id, v.post_id, v.account_id, v.platform, v.caption ?? '', bool(v.enabled), bool(v.edited));
      report.variants++;
    }
    const broken = db.all('PRAGMA foreign_key_check');
    if (broken.length) throw new Error(`import:foreign-keys:${broken.length}`);
    db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return report;
}

function rekeyItem(db, oldId, newId) {
  db.run('UPDATE social_item SET id = ? WHERE id = ?', newId, oldId);
  db.run('UPDATE social_suggestion SET item_id = ? WHERE item_id = ?', newId, oldId);
  for (const p of db.all('SELECT id, item_ids FROM social_post WHERE item_ids LIKE ?', `%${oldId}%`)) {
    const ids = JSON.parse(p.item_ids).map((x) => (x === oldId ? newId : x));
    db.run('UPDATE social_post SET item_ids = ? WHERE id = ?', JSON.stringify(ids), p.id);
  }
}

function dropSuggestion(db, id) {
  for (const p of db.all('SELECT id FROM social_post WHERE suggestion_id = ?', id)) db.run('DELETE FROM social_post WHERE id = ?', p.id);
  db.run('DELETE FROM social_suggestion WHERE id = ?', id);
}
