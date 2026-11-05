// Which items are suggested, and in what order. Ported exactly from kess-socials src/lib/rotation.ts.
import { daysBetween, ROSTER_DAYS } from './dates.js';
import { BRANDS } from './types.js';

export const LATER_DAYS = 14;
/** A post saved only as a draft rests its images this long: the app cannot see whether the draft was ever published. */
export const DRAFT_REST_DAYS = 14;
export const REST_DAYS = 90;
export const NEW_DAYS = 7;
export const PER_BRAND = 3;
export const SIBLING_LIMIT = 8;

const isoDate = (iso) => iso.slice(0, 10);

export function eligible(items, suggestions, today) {
  const laterUntil = new Map();
  const suggestedToday = new Set();
  for (const s of suggestions) {
    if (s.decision === 'later') laterUntil.set(s.itemId, Math.max(laterUntil.get(s.itemId) ?? -1, LATER_DAYS - daysBetween(s.forDate, today)));
    if (s.forDate === today) suggestedToday.add(s.itemId);
    // A card still waiting in the 7 day roster cannot be suggested again, or it could be posted twice.
    const age = daysBetween(s.forDate, today);
    if (s.decision === 'pending' && age >= 0 && age < ROSTER_DAYS) suggestedToday.add(s.itemId);
  }
  return items.filter((i) => {
    if (i.status !== 'active') return false;
    if (suggestedToday.has(i.id)) return false;
    if ((laterUntil.get(i.id) ?? 0) > 0) return false;
    if (i.lastPostedAt && daysBetween(isoDate(i.lastPostedAt), today) < REST_DAYS) return false;
    if (i.restUntil && isoDate(i.restUntil) > today) return false;
    return true;
  });
}

/** Deterministic 32-bit hash so the day's ordering is stable across reruns. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rank(today, shown) {
  return (a, b) => {
    const newA = daysBetween(isoDate(a.createdAt), today) <= NEW_DAYS ? 0 : 1;
    const newB = daysBetween(isoDate(b.createdAt), today) <= NEW_DAYS ? 0 : 1;
    if (newA !== newB) return newA - newB;
    const postedA = a.lastPostedAt ? 1 : 0;
    const postedB = b.lastPostedAt ? 1 : 0;
    if (postedA !== postedB) return postedA - postedB;
    if (a.timesPosted !== b.timesPosted) return a.timesPosted - b.timesPosted;
    // Work through the pile evenly: images shown less often come first.
    const shownA = shown.get(a.id) ?? 0;
    const shownB = shown.get(b.id) ?? 0;
    if (shownA !== shownB) return shownA - shownB;
    return hash(today + a.id) - hash(today + b.id);
  };
}

export function pick({ items, suggestions, today, perBrand }) {
  const per = perBrand ?? PER_BRAND;
  // A product leads with its first image; its other images (mockups, frame options) are carousel siblings only.
  const shown = new Map();
  for (const s of suggestions) shown.set(s.itemId, (shown.get(s.itemId) ?? 0) + 1);
  const pool = eligible(items, suggestions, today).filter((i) => i.kind !== 'product' || i.position === 0).sort(rank(today, shown));
  const out = Object.fromEntries(BRANDS.map((b) => [b, []]));
  const usedParents = new Set();
  const usedClients = new Set();
  for (const i of pool) {
    if (!out[i.brand] || out[i.brand].length >= per) continue;
    const parentKey = `${i.brand}:${i.parentId}`;
    if (usedParents.has(parentKey)) continue;
    // One post per client a day: Austrade alone has dozens of location folders and would otherwise fill the roster.
    const client = typeof i.context.client === 'string' && i.context.client.trim() ? `${i.brand}:${i.context.client.trim().toLowerCase()}` : null;
    if (client && usedClients.has(client)) continue;
    usedParents.add(parentKey);
    if (client) usedClients.add(client);
    out[i.brand].push(i);
  }
  return out;
}

export function siblings(item, items, suggestions, today, limit = SIBLING_LIMIT) {
  return eligible(items.filter((i) => i.parentId === item.parentId && i.id !== item.id), suggestions, today)
    .sort((a, b) => a.position - b.position)
    .slice(0, limit);
}
