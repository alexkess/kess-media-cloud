// Vimeo: pick videos from your library for client delivery, with Vimeo's review page for
// timecoded feedback. Uses a personal access token (no OAuth dance needed for one account).
//   VIMEO_TOKEN  from developer.vimeo.com > your app > Generate access token (Authenticated, scopes: public private video_files)
import { fetchJson } from './integrations.js';

const API = 'https://api.vimeo.com';
const FIELDS = 'uri,name,link,duration,created_time,pictures.base_link,pictures.sizes,privacy.view,review_page.link,review_page.active';
export const vimeoConfigured = () => !!process.env.VIMEO_TOKEN;

const call = (path) => fetchJson(`${API}${path}`, { headers: { Authorization: `bearer ${process.env.VIMEO_TOKEN}`, Accept: 'application/vnd.vimeo.*+json;version=3.4' } });

function shape(v) {
  const id = (v.uri || '').split('/').pop();
  const thumb = (v.pictures?.sizes || []).find((p) => p.width >= 295)?.link || v.pictures?.base_link || null;
  return {
    id, name: v.name, link: v.link, duration: v.duration, created: v.created_time, thumb,
    privacy: v.privacy?.view || null, review_link: v.review_page?.active ? v.review_page.link : null,
  };
}

export async function vimeoAccount() {
  const me = await call('/me?fields=name,link,account');
  return { name: me.name, link: me.link, plan: me.account };
}

export async function vimeoVideos({ query = '', page = 1 } = {}) {
  const q = new URLSearchParams({ per_page: '24', page: String(Math.max(1, Number(page) || 1)), sort: 'date', direction: 'desc', fields: FIELDS });
  if (query) q.set('query', String(query).slice(0, 100));
  const r = await call(`/me/videos?${q}`);
  return { total: r.total || 0, page: r.page || 1, per_page: r.per_page || 24, videos: (r.data || []).map(shape) };
}

export async function vimeoVideo(id) {
  if (!/^\d{3,15}$/.test(String(id))) throw new Error('Invalid Vimeo video id');
  return shape(await call(`/videos/${id}?fields=${FIELDS}`));
}
