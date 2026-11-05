// Posting windows. Ported exactly from kess-socials src/lib/slots.ts.
import { shiftDate, sydneyDate, sydneyLocalToIso } from './dates.js';

export const DAYPARTS = ['morning', 'midday', 'night'];

/**
 * When each platform goes out inside a part of the day, Sydney wall-clock time, before the brand offset.
 * Off the hour and half hour on purpose: most schedulers default to those minutes and feeds spike there.
 * LinkedIn and Google Business follow the working day; Instagram, Facebook and Pinterest peak after dinner.
 * Starting point from platform norms. Revisit once the ledger holds a couple of months of real results.
 */
export const PLATFORM_TIMES = {
  threads: { morning: '07:08', midday: '12:36', night: '20:11' },
  twitter: { morning: '07:16', midday: '12:43', night: '20:34' },
  bluesky: { morning: '07:23', midday: '13:09', night: '20:26' },
  mastodon: { morning: '07:31', midday: '13:17', night: '20:42' },
  linkedin: { morning: '07:47', midday: '12:07', night: '17:36' },
  instagram: { morning: '08:12', midday: '12:24', night: '19:18' },
  facebook: { morning: '08:38', midday: '12:51', night: '19:47' },
  pinterest: { morning: '09:13', midday: '13:42', night: '20:53' },
  google: { morning: '09:26', midday: '13:54', night: '17:12' },
};

/** The brands share followers, so they never post to the same platform in the same minute. */
const BRAND_OFFSET_MINUTES = { gallery: 0, alexkess: 11, kessmedia: 23 };
/** A second account on one platform (company page and personal profile) follows the first by this much. */
const SAME_PLATFORM_GAP_MINUTES = 6;
const LEAD_MINUTES = 15;
const LOOKAHEAD_DAYS = 30;

const toMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toClock = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** Step off any quarter mark (:00, :15, :30, :45). */
const offGrid = (m) => (m % 15 === 0 ? m + 2 : m);

export function platformTime(platform, daypart, brand) {
  return toClock(offGrid(toMinutes(PLATFORM_TIMES[platform][daypart]) + BRAND_OFFSET_MINUTES[brand]));
}

/** Sydney wall-clock HH:mm per account for one part of the day. */
function accountClocks(brand, accounts, daypart) {
  const seen = new Map();
  const out = {};
  for (const a of accounts) {
    const nth = seen.get(a.platform) ?? 0;
    seen.set(a.platform, nth + 1);
    out[a.accountId] = toClock(offGrid(toMinutes(platformTime(a.platform, daypart, brand)) + nth * SAME_PLATFORM_GAP_MINUTES));
  }
  return out;
}

/** UTC instants per account for a date and part of the day. */
export function accountTimes(brand, accounts, date, daypart) {
  return Object.fromEntries(Object.entries(accountClocks(brand, accounts, daypart)).map(([id, clock]) => [id, sydneyLocalToIso(`${date}T${clock}`)]));
}

const twelveHour = (clock) => { const h = Number(clock.slice(0, 2)); return `${h % 12 === 0 ? 12 : h % 12}:${clock.slice(3)} ${h < 12 ? 'am' : 'pm'}`; };

function dayLabel(date, today) {
  if (date === today) return 'Today';
  if (date === shiftDate(today, 1)) return 'Tomorrow';
  return new Date(date + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '');
}

export function windowFor(brand, accounts, date, daypart, today) {
  const clocks = Object.values(accountClocks(brand, accounts, daypart)).sort();
  if (!clocks.length) return null;
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return {
    key: `${date}:${daypart}`, date, daypart, label: `${dayLabel(date, today)} ${daypart}`,
    range: clocks.length === 1 ? twelveHour(clocks[0]) : `${twelveHour(clocks[0])} to ${twelveHour(clocks[clocks.length - 1])}`,
    startIso: sydneyLocalToIso(`${date}T${clocks[0]}`), endIso: sydneyLocalToIso(`${date}T${clocks[clocks.length - 1]}`), weekend: dow === 0 || dow === 6,
  };
}

/**
 * The coming parts of the day for a brand: `count` free ones, plus any taken ones that fall between them, marked with
 * what holds them so the rhythm stays visible. Free means not started yet and holding no scheduled post of that brand.
 */
export function freeWindows({ brand, accounts, taken: takenIn, now, count }) {
  const taken = takenIn.map((t) => ({ at: Date.parse(t.at), title: t.title }));
  const earliest = now.getTime() + LEAD_MINUTES * 60_000;
  const today = sydneyDate(now);
  const out = [];
  let free = 0;
  for (let d = 0; d < LOOKAHEAD_DAYS && free < count; d++) {
    for (const daypart of DAYPARTS) {
      if (free >= count) break;
      const w = windowFor(brand, accounts, shiftDate(today, d), daypart, today);
      if (!w) continue;
      const start = Date.parse(w.startIso);
      const end = Date.parse(w.endIso);
      if (start < earliest) continue;
      const holder = taken.find((t) => t.at >= start && t.at <= end);
      if (holder) out.push({ ...w, takenBy: holder.title });
      else { out.push(w); free++; }
    }
  }
  return out;
}

/** Whether a window already holds a scheduled post. Used server-side at send time, when the page may be stale. */
export function windowTakenBy(brand, accounts, date, daypart, taken) {
  const w = windowFor(brand, accounts, date, daypart, date);
  if (!w) return null;
  const start = Date.parse(w.startIso);
  const end = Date.parse(w.endIso);
  return taken.find((t) => Date.parse(t.at) >= start && Date.parse(t.at) <= end)?.title ?? null;
}

export function parseWindowKey(key) {
  const m = /^(\d{4}-\d{2}-\d{2}):(morning|midday|night)$/.exec(String(key ?? ''));
  if (!m || Number.isNaN(Date.parse(m[1] + 'T00:00:00Z'))) return null;
  return { date: m[1], daypart: m[2] };
}
