// Kess Gallery products from Shopify (client credentials). Ported from kess-socials src/lib/sources/shopify.ts.
export const SHOPIFY_API = '2026-07';

export async function shopifyToken(fetch, cfg) {
  const res = await fetch(`https://${cfg.store}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`shopify:token:${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('shopify:token:empty');
  return json.access_token;
}

const QUERY = `query Products($after: String) {
  products(first: 25, after: $after, query: "status:active") {
    nodes {
      id handle title productType tags descriptionHtml
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      options { name values }
      media(first: 10) { nodes { id ... on MediaImage { image { url width height altText } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const gidNum = (gid) => gid.split('/').pop() ?? gid;
const stripHtml = (s) => (s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function mapProduct(p) {
  const pid = gidNum(p.id);
  const parentUrl = p.onlineStoreUrl || `https://kess.gallery/products/${p.handle}`;
  const price = p.priceRangeV2?.minVariantPrice?.amount;
  const printTypes = p.options?.find((o) => /print|style|material/i.test(o.name))?.values ?? [];
  // Size values such as "100w x 150h" (cm), used by the Studio to make mockups at true size.
  const sizes = p.options?.find((o) => /size/i.test(o.name))?.values ?? [];
  const context = { handle: p.handle, priceFrom: price ? String(Math.round(Number(price))) : null, printTypes, sizes, tags: p.tags ?? [], productType: p.productType ?? null, description: stripHtml(p.descriptionHtml) };
  const images = (p.media?.nodes ?? []).filter((m) => m.image?.url);
  return images.map((m, position) => ({
    brand: 'gallery', source: 'shopify', sourceId: `${pid}:${gidNum(m.id)}`, parentId: pid, parentTitle: p.title, parentUrl, kind: 'product',
    imageUrl: m.image.url, imageW: m.image.width ?? null, imageH: m.image.height ?? null, title: p.title,
    context: { ...context, alt: m.image.altText ?? null }, position,
  }));
}

/** Shopify's machine code for a GraphQL error (for example MAX_COST_EXCEEDED). Never the message. */
function errorCode(e) {
  const code = typeof e?.extensions?.code === 'string' && /^[A-Z_]+$/.test(e.extensions.code) ? e.extensions.code : 'UNKNOWN';
  // Field path only (schema names such as products-nodes-media), never values.
  const path = Array.isArray(e?.path) ? e.path.filter((p) => typeof p === 'string' && /^[A-Za-z0-9_]+$/.test(p)).join('-') : '';
  return path ? `${code}:${path}` : code;
}

/** Scope handles the current token carries (for example read_products). Names only; used to explain ACCESS_DENIED. */
async function grantedScopes(fetch, store, token) {
  try {
    const res = await fetch(`https://${store}/admin/api/${SHOPIFY_API}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query: '{ currentAppInstallation { accessScopes { handle } } }' }),
    });
    const json = await res.json();
    const handles = (json.data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle).filter((h) => typeof h === 'string' && /^[a-z_]+$/.test(h));
    return handles.length ? handles.join('_and_') : 'none';
  } catch {
    return 'unreadable';
  }
}

/** Map posters sit after a product's own images and before Studio mockups. Never a lead image. */
export const MAP_POSTER_POSITION = 50;
export const MAP_POSTER_SUFFIX = ':map-poster';

/** The store's Files folder on the CDN, read from any product image URL. */
export function filesBase(imageUrl) {
  const m = imageUrl.match(/^(https:\/\/cdn\.shopify\.com\/s\/files\/1\/\d+\/\d+\/\d+\/)/);
  return m ? `${m[1]}files/` : null;
}

/**
 * Map posters are uploaded to Shopify Files as <handle>-map-poster.jpg (1080 x 1350). One HEAD request each tells
 * which prints have one. If any answer is unclear the whole set is skipped, so a bad night never retires posters.
 */
export async function findMapPosters(fetch, products, concurrency = 8) {
  const leads = products.flatMap((p) => mapProduct(p).filter((i) => i.position === 0).map((lead) => ({ p, lead })));
  const base = leads.map(({ lead }) => filesBase(lead.imageUrl)).find(Boolean);
  if (!base) return [];
  const found = [];
  let unclear = false;
  for (let n = 0; n < leads.length && !unclear; n += concurrency) {
    await Promise.all(leads.slice(n, n + concurrency).map(async ({ p, lead }) => {
      const url = `${base}${p.handle}-map-poster.jpg`;
      try {
        // A hung request must not stall the whole nightly sync; a timeout counts as unclear.
        const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if (res.status === 404) return;
        if (!res.ok || !/^image\//.test(res.headers.get('content-type') ?? '')) { unclear = true; return; }
        found.push({
          ...lead, sourceId: `${lead.parentId}${MAP_POSTER_SUFFIX}`, imageUrl: url, imageW: 1080, imageH: 1350, position: MAP_POSTER_POSITION,
          context: { ...lead.context, alt: `Map poster: where ${p.title} was taken`, mapPoster: true },
        });
      } catch {
        unclear = true;
      }
    }));
  }
  return unclear ? [] : found;
}

export async function fetchShopifyItems(fetch, cfg) {
  const token = await shopifyToken(fetch, cfg);
  const out = [];
  const products = [];
  let after = null;
  for (let page = 0; page < 80; page++) {
    const res = await fetch(`https://${cfg.store}/admin/api/${SHOPIFY_API}/graphql.json`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query: QUERY, variables: { after } }),
    });
    if (!res.ok) throw new Error(`shopify:graphql:${res.status}`);
    const json = await res.json();
    if (json.errors?.length) {
      const code = errorCode(json.errors[0]);
      throw new Error(`shopify:graphql:errors:${code}${code.startsWith('ACCESS_DENIED') ? `:scopes-${await grantedScopes(fetch, cfg.store, token)}` : ''}`);
    }
    if (!json.data) throw new Error('shopify:graphql:errors');
    for (const p of json.data.products.nodes) { products.push(p); out.push(...mapProduct(p)); }
    if (!json.data.products.pageInfo.hasNextPage) break;
    after = json.data.products.pageInfo.endCursor;
  }
  out.push(...await findMapPosters(fetch, products));
  return out;
}
