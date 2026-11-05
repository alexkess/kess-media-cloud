// Sydney calendar maths for Socials. Ported from kess-socials src/lib/dates.ts.
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar date in Sydney as YYYY-MM-DD. */
export function sydneyDate(now) {
  return fmt.format(now);
}

/** Days between two YYYY-MM-DD dates (b - a). */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}

const offsetFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Sydney', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** The Sydney offset in minutes that applies at a given instant. */
function sydneyOffsetMinutes(at) {
  const p = Object.fromEntries(offsetFmt.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** Converts a YYYY-MM-DDTHH:mm wall-clock value in Australia/Sydney to a UTC ISO string. */
export function sydneyLocalToIso(local) {
  const naive = Date.parse(`${local.length === 16 ? local : local.slice(0, 16)}:00Z`);
  if (Number.isNaN(naive)) throw new Error('dates:bad-local');
  // Guess with the offset at the naive instant, then correct once for a DST boundary crossing.
  let utc = naive - sydneyOffsetMinutes(new Date(naive)) * 60_000;
  utc = naive - sydneyOffsetMinutes(new Date(utc)) * 60_000;
  return new Date(utc).toISOString();
}

/** Sydney wall-clock hour and minute at an instant, e.g. { hour: 20, minute: 5 }. */
export function sydneyClock(now) {
  const p = Object.fromEntries(offsetFmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

/** How many days a suggested card stays reachable before it returns to the pile. */
export const ROSTER_DAYS = 7;

/** YYYY-MM-DD shifted by whole days. */
export function shiftDate(date, days) {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);
}

/** A requested roster date, or today when it is missing, malformed, in the future or older than the roster. */
export function clampRosterDate(requested, today) {
  if (!requested || !/^\d{4}-\d{2}-\d{2}$/.test(requested) || Number.isNaN(Date.parse(requested + 'T00:00:00Z'))) return today;
  const age = daysBetween(requested, today);
  return age >= 0 && age < ROSTER_DAYS ? requested : today;
}

/** YYYY-MM-DD to DD/MM/YYYY. */
export const ddmmyyyy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/');
