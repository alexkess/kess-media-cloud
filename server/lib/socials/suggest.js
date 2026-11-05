// The daily pick, the caption top-up and "Post something else". Ported from kess-socials src/lib/suggest.ts.
// Kess Cloud difference: no digest email. Instead an optional in-app notification (deps.notify) once a day.
import { describeError, generateCaptions } from './captions.js';
import { daysBetween, ROSTER_DAYS, shiftDate, sydneyDate, ddmmyyyy } from './dates.js';
import { pick, PER_BRAND } from './rotation.js';
import { BRANDS } from './types.js';

/** deps: { db, captions: CaptionClient|null, now, recipient, log, notify?: ({date, total, brands}) => void } */
export async function runSuggest(deps) {
  const now = deps.now();
  const date = sydneyDate(now);

  const configs = await deps.db.brandConfigs();
  const configuredBrands = new Set(configs.map((c) => c.brand));
  for (const b of BRANDS) if (!configuredBrands.has(b)) deps.log('suggest:no-brand-config', { brand: b });

  const recent = await deps.db.recentSuggestions(120, date);
  const byBrand = {};
  for (const b of BRANDS) byBrand[b] = await deps.db.listItems(b);
  const itemById = new Map(BRANDS.flatMap((b) => byBrand[b]).map((i) => [i.id, i]));

  // Idempotency is per item, not per date: a crashed run is topped up rather than repeated.
  // Cards added by hand do not count towards the daily three.
  const already = (await deps.db.suggestionsForDate(date)).filter((s) => !s.manual);
  const haveByBrand = {};
  for (const b of BRANDS) haveByBrand[b] = already.filter((s) => itemById.get(s.itemId)?.brand === b).length;

  const picked = pick({ items: BRANDS.flatMap((b) => byBrand[b]), suggestions: recent, today: date });

  let created = 0;
  for (const cfg of configs) {
    const need = PER_BRAND - (haveByBrand[cfg.brand] ?? 0);
    if (need <= 0) { deps.log('suggest:brand-complete', { brand: cfg.brand, date }); continue; }
    for (const item of picked[cfg.brand].slice(0, need)) {
      let baseCaption = null;
      let variants = {};
      if (deps.captions) {
        try {
          const set = await generateCaptions(deps.captions, { brand: cfg, item, siblings: [], recentCaptions: await deps.db.recentCaptions(cfg.brand, 3) });
          baseCaption = set.base;
          variants = set.variants;
        } catch (err) {
          deps.log('suggest:captions-failed', describeError(err));
        }
      }
      const s = await deps.db.insertSuggestion({ itemId: item.id, forDate: date, recipient: deps.recipient, baseCaption });
      const post = await deps.db.createPost({ suggestionId: s.id, brand: cfg.brand, itemIds: [item.id], baseCaption: baseCaption ?? '' });
      await deps.db.upsertVariants(post.id, cfg.accounts.map((a) => ({ accountId: a.accountId, platform: a.platform, caption: variants[a.accountId] ?? '' })));
      created++;
    }
  }

  // The source emailed a digest here, once per date. Kess Cloud posts one in-app notification instead, when asked to.
  const key = `socials-notify:${date}`;
  if (!deps.notify || deps.db.ranToday(key)) { deps.log('suggest:done', { date, created }); return { date, created, notified: false }; }
  // The notice covers everything standing for the date, not just what this run created.
  const all = await deps.db.suggestionsForDate(date);
  const missing = all.map((s) => s.itemId).filter((id) => !itemById.has(id));
  for (const i of missing.length ? await deps.db.getItems([...new Set(missing)]) : []) itemById.set(i.id, i);
  const brands = configs.map((cfg) => {
    const n = all.filter((s) => itemById.get(s.itemId)?.brand === cfg.brand).length;
    return { brand: cfg.brand, count: n, short: n < PER_BRAND };
  });
  await deps.notify({ date, total: all.length, brands });
  deps.db.markRan(key);
  deps.log('suggest:notified', { date, created });
  return { date, created, notified: true };
}

/**
 * Fills what is missing on the pending cards of the 7 day roster: a card with no caption at all (Claude was down at suggest time),
 * or a card lacking a caption for an account that was added to the brand later. Never touches text that already exists.
 */
export async function runRecaption(deps) {
  const date = sydneyDate(deps.now());
  if (!deps.captions) { deps.log('recaption:not-configured'); return { date, filled: 0, failed: 0 }; }
  const configs = await deps.db.brandConfigs();
  // The whole roster, not just today: a card from earlier in the week is still postable and should gain a new account too.
  const days = Array.from({ length: ROSTER_DAYS }, (_, n) => shiftDate(date, -n));
  const pending = (await Promise.all(days.map((d) => deps.db.suggestionsForDate(d)))).flat().filter((s) => s.decision === 'pending');
  const items = new Map((await deps.db.getItems(pending.map((s) => s.itemId))).map((i) => [i.id, i]));
  let filled = 0;
  let failed = 0;
  for (const s of pending) {
    const item = items.get(s.itemId);
    const cfg = item && configs.find((c) => c.brand === item.brand);
    const post = await deps.db.postForSuggestion(s.id);
    if (!item || !cfg || !post || post.state !== 'pending') continue;
    const existing = await deps.db.variants(post.id);
    const has = (accountId) => Boolean(existing.find((v) => v.accountId === accountId)?.caption.trim());
    const missing = cfg.accounts.filter((a) => !has(a.accountId));
    if (s.baseCaption && !missing.length) continue;
    try {
      const set = await generateCaptions(deps.captions, { brand: cfg, item, siblings: [], recentCaptions: await deps.db.recentCaptions(cfg.brand, 3) });
      if (!s.baseCaption) {
        await deps.db.setSuggestionCaption(s.id, set.base);
        await deps.db.updatePost(post.id, { base_caption: set.base });
      }
      await deps.db.upsertVariants(post.id, missing.map((a) => ({ accountId: a.accountId, platform: a.platform, caption: set.variants[a.accountId] ?? '', enabled: existing.find((v) => v.accountId === a.accountId)?.enabled ?? true })));
      filled++;
    } catch (err) {
      failed++;
      deps.log('recaption:failed', describeError(err));
    }
  }
  deps.log('recaption:done', { date, filled, failed });
  return { date, filled, failed };
}

/**
 * Adds a card by hand for today: the chosen item (a product's lead image for prints), with captions when Claude is
 * available, plus any extra images to start the carousel with (a saved mockup, say). Rest rules do not apply, since
 * someone chose it, but a card already waiting in the roster is never doubled.
 * Returns { ok: true, date, warning? } or { ok: false, error, date? }.
 */
export async function addManualCard(deps, input) {
  const today = sydneyDate(deps.now());
  const [item] = await deps.db.getItems([input.itemId]);
  if (!item || item.status !== 'active') return { ok: false, error: 'That one is not available any more.' };
  if (item.kind === 'product' && item.position !== 0) return { ok: false, error: 'Pick the print itself, not one of its extra images.' };
  const cfg = (await deps.db.brandConfigs()).find((c) => c.brand === item.brand);
  if (!cfg) return { ok: false, error: 'This brand has no accounts set up.' };
  const recent = await deps.db.recentSuggestions(ROSTER_DAYS, today);
  const waiting = recent.find((s) => s.itemId === item.id && s.decision === 'pending' && daysBetween(s.forDate, today) < ROSTER_DAYS);
  if (waiting) return { ok: false, error: 'It is already waiting in Socials.', date: waiting.forDate };
  if (recent.some((s) => s.itemId === item.id && s.forDate === today)) return { ok: false, error: 'It was already on today\'s list.', date: today };
  const extras = input.extraItemIds?.length ? (await deps.db.getItems(input.extraItemIds)).filter((i) => i.status === 'active' && i.parentId === item.parentId && i.id !== item.id) : [];
  let baseCaption = null;
  let variants = {};
  if (deps.captions) {
    try {
      const set = await generateCaptions(deps.captions, { brand: cfg, item, siblings: [], recentCaptions: await deps.db.recentCaptions(cfg.brand, 3) });
      baseCaption = set.base;
      variants = set.variants;
    } catch (err) {
      deps.log('manual:captions-failed', describeError(err));
    }
  }
  const s = await deps.db.insertSuggestion({ itemId: item.id, forDate: today, recipient: deps.recipient, baseCaption, manual: true });
  const post = await deps.db.createPost({ suggestionId: s.id, brand: cfg.brand, itemIds: [item.id, ...extras.map((e) => e.id)], baseCaption: baseCaption ?? '' });
  await deps.db.upsertVariants(post.id, cfg.accounts.map((a) => ({ accountId: a.accountId, platform: a.platform, caption: variants[a.accountId] ?? '' })));
  deps.log('manual:added', { brand: cfg.brand });
  const lastPosted = item.lastPostedAt?.slice(0, 10);
  const warnings = [
    baseCaption === null && deps.captions ? 'Claude could not write the captions just now; the next caption run fills them, or write them yourself.' : null,
    lastPosted && daysBetween(lastPosted, today) < 90 ? `It was last posted on ${ddmmyyyy(lastPosted)}.` : null,
  ].filter(Boolean);
  return { ok: true, date: today, ...(warnings.length ? { warning: warnings.join(' ') } : {}) };
}
