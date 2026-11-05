// The two public Sanity datasets (kess.media and alexkess.com), as plain HTTPS GROQ queries.
// Ported from kess-socials src/lib/sources/{sanity-query,sanity-image,sanity-kessmedia,sanity-alexkess}.ts.
import { readFileSync } from 'node:fs';

export const SANITY_API = '2026-04-28';

export async function sanityQuery(fetch, projectId, groq) {
  const url = `https://${projectId}.api.sanity.io/v${SANITY_API}/data/query/production?query=${encodeURIComponent(groq)}&perspective=published`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sanity:${projectId}:${res.status}`);
  const json = await res.json();
  return json.result;
}

const REF = /^image-([a-f0-9]+)-(\d+)x(\d+)-(\w+)$/;
export function sanityImage(projectId, ref) {
  if (!ref) return null;
  const m = REF.exec(ref);
  if (!m) return null;
  return { url: `https://cdn.sanity.io/images/${projectId}/production/${m[1]}-${m[2]}x${m[3]}.${m[4]}`, w: Number(m[2]), h: Number(m[3]) };
}

// ---------- kess.media ----------
export const KESSMEDIA_PROJECT = 'sdgel12z';
const KM_GALLERY = `coalesce(mediaGallery[_type == "galleryImage"]{"key": _key, "ref": image.asset._ref, "alt": image.alt, caption}, [])`;
const KM_BODY = `coalesce(body[_type == "image"]{"key": _key, "ref": asset._ref, alt, caption}, [])`;
const LIVE = `defined(slug.current) && !(_id in path("drafts.**"))`;
export const KESSMEDIA_QUERY = `{
  "projects": *[_type == "project" && ${LIVE}]{
    _id, title, client, excerpt, category, link, "slug": slug.current,
    "imgs": [{"key": "hero", "ref": heroImage.asset._ref, "alt": heroImage.alt}] + coalesce(mediaGallery[]{"key": _key, "ref": image.asset._ref, "alt": image.alt, caption}, [])
  },
  "services": *[_type == "service" && ${LIVE}]{
    _id, title, "slug": slug.current, "excerpt": shortDescription,
    "imgs": [{"key": "image", "ref": image.asset._ref, "alt": image.alt}, {"key": "featured", "ref": featuredMedia.image.asset._ref, "alt": featuredMedia.image.alt, "caption": featuredMedia.caption}] + ${KM_GALLERY} + ${KM_BODY}
  },
  "posts": *[_type == "post" && ${LIVE}]{
    _id, title, "slug": slug.current, excerpt, category,
    "imgs": [{"key": "hero", "ref": heroImage.asset._ref, "alt": heroImage.alt}, {"key": "image", "ref": image.asset._ref}] + ${KM_GALLERY} + ${KM_BODY}
  }
}`;

/** Screenshots, graphics and small web images never make a good post. */
const MIN_LONG_EDGE = 1200;

export async function fetchKessMediaItems(fetch) {
  const r = await sanityQuery(fetch, KESSMEDIA_PROJECT, KESSMEDIA_QUERY);
  const out = [];
  // One photo, one item: projects claim an image first, then service pages, then blog posts.
  const seen = new Set();
  const sections = [
    { docs: r.projects, page: 'project', url: (d) => `https://kess.media${d.link && d.link.startsWith('/') ? d.link : `/work/${d.slug}`}` },
    { docs: r.services, page: 'service', url: (d) => `https://kess.media/services/${d.slug}` },
    { docs: r.posts, page: 'blog post', url: (d) => `https://kess.media/blog/${d.slug}` },
  ];
  for (const { docs, page, url } of sections) {
    for (const d of docs ?? []) {
      const base = { client: d.client ?? null, excerpt: d.excerpt ?? null, category: d.category ?? null, ...(page === 'project' ? {} : { page }) };
      let position = 0;
      for (const g of d.imgs ?? []) {
        const img = sanityImage(KESSMEDIA_PROJECT, g.ref ?? undefined);
        if (!img || seen.has(img.url)) continue;
        if (page !== 'project' && (img.url.endsWith('.png') || Math.max(img.w, img.h) < MIN_LONG_EDGE)) continue;
        seen.add(img.url);
        out.push({
          brand: 'kessmedia', source: 'sanity', sourceId: `${d._id}:${g.key}`, parentId: d._id, parentTitle: d.title, parentUrl: url(d), kind: 'image',
          imageUrl: img.url, imageW: img.w, imageH: img.h, title: g.caption || d.title, context: { ...base, alt: g.alt ?? null, caption: g.caption ?? null }, position: position++,
        });
      }
    }
  }
  return out;
}

// ---------- alexkess.com ----------
// Camera and year per iPhoneography image, keyed by Sanity asset. Read from the Flickr originals' EXIF;
// where the EXIF is stripped, the year comes from Flickr upload order and the phone from that date.
const SHOT_ON = JSON.parse(readFileSync(new URL('./iphoneography.json', import.meta.url), 'utf8'));
const shotOn = (ref) => {
  const s = ref ? SHOT_ON[ref] : undefined;
  return s ? { camera: s.camera, year: s.year } : {};
};

export const ALEXKESS_PROJECT = 'gwwzy02m';
const AK_GALLERY = `gallery[]{"key": _key, "ref": image.asset._ref, "alt": alt, caption, locationOrTitle, focalLength, exposure}`;
export const ALEXKESS_QUERY = `{
  "projects": *[_type == "project" && defined(slug.current)]{_id, _type, title, "slug": slug.current, description, "client": null, "cover": {"ref": coverImage.asset._ref, "alt": coverImage.alt}, "gallery": ${AK_GALLERY}},
  "commissions": *[_type == "commission" && defined(slug.current)]{_id, _type, title, "slug": slug.current, "description": brief, client, "cover": {"ref": coverImage.asset._ref, "alt": coverImage.alt}, "gallery": ${AK_GALLERY}},
  "essays": *[_type == "journalPost" && defined(slug.current) && defined(publishedAt)]{_id, title, "slug": slug.current, deck, category, canonicalUrl, "cover": {"ref": coverImage.asset._ref, "alt": coverImage.alt}, "firstParagraph": pt::text(body[_type == "block"][0])}
}`;

export async function fetchAlexKessItems(fetch) {
  const r = await sanityQuery(fetch, ALEXKESS_PROJECT, ALEXKESS_QUERY);
  const out = [];
  for (const w of [...r.projects, ...r.commissions]) {
    // Matches the site's routes: project docs live under /portfolio, commission docs under /projects.
    const parentUrl = `https://alexkess.com/${w._type === 'project' ? 'portfolio' : 'projects'}/${w.slug}`;
    const base = { description: w.description ?? null, client: w.client ?? null };
    const seen = new Set();
    let position = 0;
    const push = (key, ref, title, ctx) => {
      const img = sanityImage(ALEXKESS_PROJECT, ref);
      if (!img || seen.has(img.url)) return;
      seen.add(img.url);
      out.push({ brand: 'alexkess', source: 'sanity', sourceId: `${w._id}:${key}`, parentId: w._id, parentTitle: w.title, parentUrl, kind: 'image', imageUrl: img.url, imageW: img.w, imageH: img.h, title, context: { ...base, ...ctx }, position: position++ });
    };
    push('cover', w.cover?.ref, w.title, { alt: w.cover?.alt ?? null, ...shotOn(w.cover?.ref) });
    for (const g of w.gallery ?? []) push(g.key, g.ref, g.locationOrTitle || g.caption || w.title, { alt: g.alt ?? null, caption: g.caption ?? null, locationOrTitle: g.locationOrTitle ?? null, focalLength: g.focalLength ?? null, exposure: g.exposure ?? null, ...shotOn(g.ref) });
  }
  for (const e of r.essays) {
    const img = sanityImage(ALEXKESS_PROJECT, e.cover?.ref);
    if (!img) continue;
    const siteUrl = `https://alexkess.com/journal/${e.slug}`;
    out.push({ brand: 'alexkess', source: 'sanity', sourceId: e._id, parentId: e._id, parentTitle: e.title, parentUrl: siteUrl, kind: 'essay', imageUrl: img.url, imageW: img.w, imageH: img.h, title: e.title, context: { alt: e.cover?.alt ?? null, deck: e.deck ?? null, category: e.category ?? null, firstParagraph: e.firstParagraph ?? null, canonicalUrl: e.canonicalUrl || siteUrl }, position: 0 });
  }
  return out;
}
