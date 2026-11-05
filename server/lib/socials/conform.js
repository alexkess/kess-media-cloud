// "Use for the other N accounts". Ported exactly from kess-socials src/lib/conform.ts.
/**
 * Carries a caption Alex wrote to the brand's other accounts without rewriting it.
 * Only the hashtag line, Instagram handles and length change per platform. No model involved: his words win.
 */
const DEFAULT_HASHTAGS = { instagram: 30, threads: 2, bluesky: 2, twitter: 2, mastodon: 3, facebook: 0, linkedin: 0, google: 0, pinterest: 0 };
const BRAND_HASHTAGS = { kessmedia: { linkedin: 5, instagram: 8 }, gallery: { facebook: 2 } };
/** Platforms where an Instagram @handle links to the right account. */
const HANDLES_LINK = ['instagram', 'threads'];

export function hashtagLimit(brand, platform) {
  return BRAND_HASHTAGS[brand]?.[platform] ?? DEFAULT_HASHTAGS[platform];
}

const isTagLine = (line) => /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(line);

export function conformText({ text, brand, target, handles }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const tags = lines.filter(isTagLine).flatMap((l) => l.match(/#[\p{L}\p{N}_]+/gu) ?? []);
  let body = lines.filter((l) => !isTagLine(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!HANDLES_LINK.includes(target.platform)) {
    body = body.replace(/@([A-Za-z0-9_.]+)/g, (m, h) => handles[h.toLowerCase()] ?? m);
  }
  const keep = tags.slice(0, hashtagLimit(brand, target.platform));
  const limit = target.charLimit;
  const withTags = keep.length ? `${body}\n\n${keep.join(' ')}` : body;
  if (withTags.length <= limit) return withTags;
  if (body.length <= limit) return body;
  const cut = body.slice(0, limit - 1);
  // Keep the last word only if it was not cut through.
  const whole = /\s/.test(body[limit - 1] ?? ' ') ? cut : cut.slice(0, Math.max(cut.lastIndexOf(' '), 1));
  return `${whole.trimEnd()}…`;
}
