// The Vercel crons, as Kess Cloud jobs: sync at 20:00 and suggest at 07:00 Sydney, the caption top-up at 07:20.
// They run only with SOCIALS_JOBS=1, so Kess Cloud and the Vercel app are never both picking cards.
// Each runs at most once per Sydney day (job_runs keys socials-sync:<date> and so on), whatever the restarts.
import { jobsOn } from './config.js';
import { sydneyClock, sydneyDate } from './dates.js';
import { makeStore } from './store.js';
import { log, recaptionNow, suggestNow, syncNow } from './actions.js';

export const SYNC_AT = { hour: 20, minute: 0 };
export const SUGGEST_AT = { hour: 7, minute: 0 };
export const RECAPTION_AT = { hour: 7, minute: 20 };
const reached = (clock, at) => clock.hour > at.hour || (clock.hour === at.hour && clock.minute >= at.minute);

export async function socialsTick(db, now = new Date(), deps = {}) {
  if (!jobsOn()) return { skipped: 'SOCIALS_JOBS is not 1' };
  const store = makeStore(db);
  const date = sydneyDate(now);
  const clock = sydneyClock(now);
  const out = {};
  const once = async (name, at, fn) => {
    const key = `socials-${name}:${date}`;
    if (!reached(clock, at) || store.ranToday(key)) return;
    // Marked even when it fails, like a cron that fired: tomorrow tries again, and a failing source is not hammered.
    store.markRan(key);
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message }; log(`${name}:failed`, { message: e.message }); }
  };
  await once('sync', SYNC_AT, () => syncNow(db, deps.sync));
  await once('suggest', SUGGEST_AT, () => suggestNow(db, { now: () => now, ...deps.suggest }));
  await once('recaption', RECAPTION_AT, () => recaptionNow(db, { now: () => now, ...deps.recaption }));
  return out;
}

export function startSocialsJobs(db) {
  if (!jobsOn()) return null;
  const tick = () => socialsTick(db).catch((e) => console.error('Socials jobs failed:', e));
  setTimeout(tick, 45_000).unref();
  // Every five minutes, so 07:00 and 20:00 land within a few minutes of the hour.
  return setInterval(tick, 5 * 60_000).unref();
}
