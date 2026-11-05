// Link placement per platform. Ported from kess-socials src/lib/links.ts.
/** Anything that reads as a web address: https://..., www..., or a bare domain like kess.gallery/products/x. */
export const LINK = /(https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(?:com\.au|com|gallery|media|au|tv|co)(?:\/\S*)?)/i;

/** Platforms where a link in the caption is dead text or is reported to cut reach. LinkedIn and X get it as the first comment instead. */
export const NO_LINK_IN_CAPTION = ['instagram', 'linkedin', 'twitter'];
export const LINK_AS_FIRST_COMMENT = ['linkedin', 'twitter'];

const bare = (url) => url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();

export function captionHasLink(caption, link) {
  return caption.toLowerCase().includes(bare(link));
}
