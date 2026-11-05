// Cards for one roster day. Ported from kess-socials src/app/review/load.ts.
import { siblings } from './rotation.js';
import { mentionText, suggestMentions } from './mentions.js';
import { cleanName } from './names.js';
import { freeWindows } from './slots.js';
import { thumb } from './thumb.js';
import { BRAND_LABEL } from './types.js';

export function contextLine(i) {
  const c = i.context;
  const parts = [i.parentTitle];
  // Shopify prices are retail, inc GST. Kess Cloud says so (CLAUDE.md: prices ex GST unless shown as inc GST).
  if (i.kind === 'product') { if (c.priceFrom) parts.push(`from $${c.priceFrom} inc GST`); if (Array.isArray(c.printTypes) && c.printTypes.length) parts.push(c.printTypes.slice(0, 3).join(', ')); }
  else if (i.kind === 'essay') { parts.push(c.category, 'essay'); }
  else { parts.push(c.locationOrTitle, c.focalLength, c.exposure, c.client); }
  return parts.filter((p) => typeof p === 'string' && p.trim()).join(' · ');
}

/** Dropbox photos carry no page of their own; Alex decides from the client whether it can be published. */
function dropboxLine(i) {
  if (i.source !== 'dropbox') return null;
  const client = typeof i.context.client === 'string' && i.context.client.trim() ? i.context.client.trim() : null;
  const possible = Array.isArray(i.context.possibleClients) ? i.context.possibleClients.filter((c) => typeof c === 'string') : [];
  return { client, folder: typeof i.context.folder === 'string' ? i.context.folder : '', possible };
}

export const toCardItem = (i) => ({
  id: i.id, title: i.title, parentTitle: i.parentTitle, parentUrl: i.parentUrl, imageUrl: i.imageUrl, thumb: thumb(i.imageUrl, 1200), small: thumb(i.imageUrl, 240),
  imageW: i.imageW, imageH: i.imageH, contextLine: contextLine(i), dropbox: dropboxLine(i), source: i.source, mapPoster: Boolean(i.context.mapPoster), position: i.position,
});

export function buildCards({ suggestions, posts, variants: allVariants, items, accounts, today, recentSuggestions, mentions = [] }) {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const out = [];
  for (const s of suggestions) {
    const item = itemById.get(s.itemId);
    const post = posts.filter((p) => p.suggestionId === s.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!item || !post) continue;
    const vs = allVariants.filter((v) => v.postId === post.id);
    const variants = accounts.flatMap((a) => { const v = vs.find((x) => x.accountId === a.accountId); return v ? [{ id: v.id, accountId: a.accountId, platform: a.platform, label: a.label, charLimit: a.charLimit, caption: v.caption, enabled: v.enabled, edited: v.edited }] : []; });
    // The primary is whatever sits first in the post, which Make primary can change.
    const primary = itemById.get(post.itemIds[0]) ?? item;
    const sibs = siblings(primary, items, recentSuggestions, today);
    out.push({
      suggestionId: s.id, postId: post.id, item: toCardItem(item), primary: toCardItem(primary), decision: s.decision, manual: s.manual, state: post.state, mode: post.mode,
      scheduledAt: post.scheduledAt, scheduledUntil: post.scheduledUntil, error: post.error, publerJobId: Boolean(post.publerJobId), lockedAt: post.lockedAt,
      dryRun: post.dryRun, dryRunAt: post.dryRunAt,
      baseCaption: s.baseCaption, variants, siblings: sibs.map(toCardItem), selectedSiblingIds: post.itemIds.slice(1), brief: item.brief,
      mentions: suggestMentions(mentions, { brand: primary.brand, texts: [item.brief, cleanName(primary.title, primary.parentTitle), primary.parentTitle, ...['client', 'excerpt', 'description', 'descriptor', 'caption', 'category', 'locationOrTitle'].map((k) => primary.context[k])] })
        .map((m) => ({ id: m.id, name: m.name, added: variants.length > 0 && variants.every((v) => v.caption.includes(mentionText(m, v.platform))) })),
    });
  }
  return out;
}

/** Cards for one roster day. Sibling eligibility is always judged against the real today. */
export function loadRoster(store, date, today = date, now = new Date()) {
  const configs = store.brandConfigs();
  const suggestions = store.suggestionsForDate(date);
  const recent = store.recentSuggestions(120, today);
  const mentions = store.listMentions();
  const suggested = store.getItems([...new Set(suggestions.map((s) => s.itemId))]);
  const posts = store.postsForSuggestions(suggestions.map((s) => s.id));
  // Siblings only ever come from the same product or project, so load those parents rather than the whole brand.
  const pool = store.listItemsByParents([...new Set(suggested.map((i) => i.parentId))]);
  const variants = store.variantsForPosts(posts.map((p) => p.id));
  const suggestedById = new Map(suggested.map((i) => [i.id, i]));
  const poolIds = new Set(pool.map((i) => i.id));
  // A card retired since it was suggested is not in the active pool but must still render.
  const items = [...pool, ...suggested.filter((i) => !poolIds.has(i.id))];
  const brands = configs.map((cfg) => {
    const mine = suggestions.filter((s) => suggestedById.get(s.itemId)?.brand === cfg.brand);
    const mineIds = new Set(mine.map((s) => s.id));
    const myPosts = posts.filter((p) => mineIds.has(p.suggestionId));
    const myPostIds = new Set(myPosts.map((p) => p.id));
    const cards = buildCards({ suggestions: mine, posts: myPosts, variants: variants.filter((v) => myPostIds.has(v.postId)), items: items.filter((i) => i.brand === cfg.brand), accounts: cfg.accounts, today, recentSuggestions: recent, mentions });
    const windows = freeWindows({ brand: cfg.brand, accounts: cfg.accounts, taken: store.scheduledAhead(cfg.brand, now.toISOString()), now, count: 6 });
    return { brand: cfg.brand, label: BRAND_LABEL[cfg.brand], accounts: cfg.accounts, cards: cards.sort((a, b) => a.item.title.localeCompare(b.item.title)), windows };
  });
  return { date, brands };
}
