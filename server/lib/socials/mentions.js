// Curated @mentions. Ported exactly from kess-socials src/lib/mentions.ts.
/**
 * A curated list of organisations and people Alex tags. Only entries in this list are ever suggested:
 * a guessed handle would tag a stranger. Ids per platform come from tags Publer already accepted.
 * Shape: { id, name, keywords[], brands[]|null, always, instagram, facebook, linkedin, twitter, bluesky, mastodon }
 */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function suggestMentions(all, card) {
  const hay = card.texts.filter(Boolean).join(' \n ');
  return all.filter((m) => {
    if (m.brands && !m.brands.includes(card.brand)) return false;
    if (m.always) return true;
    return m.keywords.some((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(k)}($|[^\\p{L}\\p{N}])`, 'iu').test(hay));
  });
}

/** How the mention is written on one platform. A plain name where there is no known id. */
export function mentionText(m, platform) {
  switch (platform) {
    case 'instagram':
    case 'threads':
      return m.instagram ? `@${m.instagram}` : m.name;
    case 'twitter':
      return m.twitter ? `@${m.twitter}` : m.name;
    case 'bluesky':
      return m.bluesky ? `@${m.bluesky}` : m.name;
    case 'mastodon':
      return m.mastodon ? `@${m.mastodon}` : m.name;
    case 'linkedin':
      return m.linkedin ? `@mention[${m.name}](${m.linkedin})` : m.name;
    case 'facebook':
      return m.facebook ? `@mention[${m.name}](${m.facebook})` : m.name;
    default:
      return m.name;
  }
}

const isTagLine = (line) => /^\s*(#[\p{L}\p{N}_]+\s*)+$/u.test(line);
const isMentionLine = (line) => /^\s*(@mention\[[^\]]+\]\([^)]+\)|@[\w.@-]+)(\s+(@mention\[[^\]]+\]\([^)]+\)|@[\w.@-]+))*\s*$/u.test(line);

/** Adds a tag on its own line just above the hashtags, joining an existing tag line. Never adds the same tag twice. */
export function insertMention(caption, tag) {
  if (caption.includes(tag)) return caption;
  const lines = caption.replace(/\r\n/g, '\n').split('\n');
  let tagAt = lines.findIndex(isTagLine);
  if (tagAt === -1) tagAt = lines.length;
  const before = tagAt - 1;
  // Join a line that already holds @tags; a plain name (no id on this platform) gets its own line.
  if (before >= 0 && tag.startsWith('@') && isMentionLine(lines[before])) {
    lines[before] = `${lines[before].trimEnd()} ${tag}`;
    return lines.join('\n');
  }
  lines.splice(tagAt, 0, tag);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
