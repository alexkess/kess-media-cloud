/** Display-only resize. Posts always use the original URL. Ported from kess-socials src/lib/thumb.ts. */
export function thumb(url, w) {
  if (url.startsWith('https://cdn.sanity.io/')) return `${url}${url.includes('?') ? '&' : '?'}w=${w}&auto=format`;
  if (url.startsWith('https://cdn.shopify.com/')) return `${url}${url.includes('?') ? '&' : '?'}width=${w}`;
  return url;
}
