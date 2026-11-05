// Alex Kess caption names. Ported exactly from kess-socials src/lib/names.ts.
/**
 * Many Sanity image titles are file names ("Hills Shire Dji 0036 4 Gigapixel Standard Width 8000px").
 * This keeps the meaningful words for a caption and falls back to the series name when nothing is left.
 */

/** Camera, export and editing leftovers that never belong in a caption. */
const JUNK = /^(iphoneography|akp|dji|dsc|dscf|img|mg|edit|edited|enhanced|nr|denoise|gigapixel|standard|width|final|copy|hdr|pano|v\d+|\d+px)$/i;
/** Project and client prefixes that the file names start with. */
const PREFIXES = new Set(['anb', 'austrade', 'austradenetzero', 'iphone', 'iphoneography', 'bestcam', 'photo', 'symmterra', 'northline', 'accenture']);

const words = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
const fixCase = (s) => s.replace(/\biphone/gi, 'iPhone');

/** Whole phrases from the iPhone project file names: "55365", "19 of 366", "Mobile Photography Project", "True HDR". */
const PHRASES = [/\b\d+\s*of\s*36[56]\b/gi, /\b\d+36[56]\b/g, /\b(alexkess\s+)?(daily\s+)?mobile\s+photography(\s+project)?\b/gi, /\btrue\s+hdr\b/gi, /\bremix(\s+using\s+.*)?$/gi];

export function cleanName(title, parentTitle) {
  const series = fixCase(parentTitle.trim().replace(/\.+$/, ''));
  const stripped = PHRASES.reduce((t, re) => t.replace(re, ' '), title);
  let tokens = stripped.trim().split(/\s+/).filter((t) => !/^\d+$/.test(t) && !JUNK.test(t));
  // Leading project words: known prefixes, or the series name itself as a whole phrase.
  while (tokens.length && (PREFIXES.has(tokens[0].toLowerCase()))) tokens = tokens.slice(1);
  while (tokens.length && /^(of|a|the|and)$/i.test(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  if (tokens.length && /^[a-z]/.test(tokens[0])) tokens[0] = tokens[0][0].toUpperCase() + tokens[0].slice(1);
  const seriesWords = words(series);
  if (seriesWords.length && words(tokens.join(' ')).join(' ') === seriesWords.join(' ')) tokens = [];
  const name = tokens.join(' ').trim();
  return name ? fixCase(name) : series;
}

const SMALL = new Set(['the', 'and', 'of', 'at', 'in', 'on']);
const placeWords = (line) => line.replace(/\.$/, '').split(/\s+/).filter(Boolean);

/**
 * Alex Kess captions open "Location." then "Name.". When the name already says the place ("Opera House Sunrise"),
 * the location keeps only what the name does not say ("Sydney Opera House." becomes "Sydney."), or goes entirely.
 */
export function dedupeLocation(caption) {
  const lines = caption.split('\n');
  const [loc, name] = lines;
  if (lines.length < 2 || !loc?.trim().endsWith('.') || !name?.trim().endsWith('.')) return caption;
  if (/https?:|www\.|@|#/.test(loc + name)) return caption;
  const nameWords = new Set(placeWords(name).map((w) => w.toLowerCase()));
  const kept = placeWords(loc).filter((w) => !nameWords.has(w.toLowerCase()));
  if (kept.length === placeWords(loc).length) return caption;
  const rest = kept.filter((w) => !SMALL.has(w.toLowerCase()));
  if (!rest.length) return lines.slice(1).join('\n');
  return [`${kept.join(' ').replace(/^(the|of|at|in|on|and)\s+/i, '')}.`, ...lines.slice(1)].join('\n');
}

const TAGS_OR_LINK = /^\s*#|https?:|www\./;

/** Makes sure a caption says which phone and year, e.g. "iPhone 4S, 2012.", placed under the name and above the hashtags. */
export function withShotOn(caption, camera, year, limit = Infinity) {
  const has = (s) => caption.toLowerCase().includes(s.toLowerCase());
  if (has(camera) && has(year)) return caption;
  const lines = caption.split('\n');
  let at = lines.findIndex((l) => TAGS_OR_LINK.test(l));
  if (at === -1) at = lines.length;
  while (at > 0 && !lines[at - 1].trim()) at--;
  const out = [...lines.slice(0, at), `${camera}, ${year}.`, ...lines.slice(at)];
  // Too long for the platform: drop hashtags from the end until it fits, otherwise leave the caption alone.
  while (out.join('\n').length > limit) {
    const i = out.findLastIndex((l) => /#\w/.test(l));
    if (i === -1) return caption;
    const kept = out[i].replace(/\s*#\w+\s*$/, '');
    if (kept.trim()) out[i] = kept;
    else out.splice(i, 1);
  }
  return out.join('\n').replace(/\n+$/, '');
}
