// Public endpoints used by hosted / exported client sites. No auth, CORS open, rate limited.
import { HttpError, rateLimiter, clientIp, send } from '../lib/http.js';
import { notify, logActivity } from '../lib/services.js';
import { getSettings } from '../db.js';

const formLimit = rateLimiter({ windowMs: 10 * 60_000, max: 8 });
const hitLimit = rateLimiter({ windowMs: 60_000, max: 120 });
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };

export default function register(r) {
  r.add('OPTIONS', '/api/public/*', async (ctx) => { send(ctx.res, 204, null, CORS); });

  r.post('/api/public/forms/:slug', async (ctx) => {
    for (const [k, v] of Object.entries(CORS)) ctx.setHeader(k, v);
    const site = ctx.db.get('SELECT id, name, client_id FROM sites WHERE slug = ?', ctx.params.slug);
    if (!site) throw new HttpError(404, 'Unknown site');
    if (!formLimit(`${clientIp(ctx.req)}:${site.id}`)) throw new HttpError(429, 'Too many messages. Please try again later.');
    const b = await ctx.body(50_000);
    if (b._hp) return { ok: true }; // honeypot: pretend success
    const data = {};
    for (const [k, v] of Object.entries(b)) if (!k.startsWith('_') && Object.keys(data).length < 20) data[k.slice(0, 40)] = String(v ?? '').slice(0, 5000);
    if (!data.email || !/^\S+@\S+\.\S+$/.test(data.email)) throw new HttpError(400, 'Please enter a valid email');
    if (!String(data.message || '').trim()) throw new HttpError(400, 'Please enter a message');
    const spammy = (String(data.message).match(/https?:\/\//g) || []).length > 3;
    const { id } = ctx.db.run('INSERT INTO submissions (site_id, page_slug, data, status) VALUES (?, ?, ?, ?)', site.id, String(b._page || '').slice(0, 100), JSON.stringify(data), spammy ? 'spam' : 'new');
    if (!spammy) {
      notify(ctx.db, { audience: 'client', client_id: site.client_id, title: `New enquiry from ${data.name || data.email}`, body: String(data.message).slice(0, 200), link: `#/sites/${site.id}/leads` });
      logActivity(ctx.db, { client_id: site.client_id, site_id: site.id, action: 'lead.received', detail: data.email });
    }
    return { ok: true, id };
  });

  // Caddy on-demand TLS asks this before issuing a certificate for a hostname.
  // 200 only for the platform's own host and client domains (with or without www).
  r.get('/api/public/tls-check', async (ctx) => {
    const d = String(ctx.query.get('domain') || '').toLowerCase().replace(/\.$/, '');
    const platform = [getSettings(ctx.db).public_base_url, process.env.PUBLIC_URL].map((u) => { try { return new URL(u).hostname; } catch { return null; } });
    const bare = d.replace(/^www\./, '');
    const ok = d && (platform.includes(d) || ctx.db.get('SELECT 1 FROM sites WHERE domain = ? OR domain = ?', d, bare));
    if (!ok) throw new HttpError(404, 'Unknown domain');
    return { ok: true };
  });

  // Cookieless page-view counter: aggregates per day/path, stores no IP or user id.
  r.post('/api/public/hit/:slug', async (ctx) => {
    for (const [k, v] of Object.entries(CORS)) ctx.setHeader(k, v);
    if (!hitLimit(clientIp(ctx.req))) return { ok: false };
    if (/bot|crawl|spider|preview|monitor/i.test(ctx.req.headers['user-agent'] || '')) return { ok: true };
    const site = ctx.db.get('SELECT id, slug FROM sites WHERE slug = ?', ctx.params.slug);
    if (!site) return { ok: false };
    let b = {};
    try { b = JSON.parse((await ctx.rawBody(4000)).toString() || '{}'); } catch {}
    let path = String(b.p || '/').slice(0, 200).replace(new RegExp(`^/s/${site.slug}`), '') || '/';
    path = path.replace(/\/+$/, '') || '/';
    const day = new Date().toISOString().slice(0, 10);
    ctx.db.run('INSERT INTO pageviews (site_id, day, path, views) VALUES (?, ?, ?, 1) ON CONFLICT(site_id, day, path) DO UPDATE SET views = views + 1', site.id, day, path);
    let host = '';
    try { host = b.r ? new URL(b.r).hostname : ''; } catch {}
    if (host && host !== ctx.req.headers.host) ctx.db.run('INSERT INTO referrers (site_id, day, host, views) VALUES (?, ?, ?, 1) ON CONFLICT(site_id, day, host) DO UPDATE SET views = views + 1', site.id, day, host.slice(0, 120));
    return { ok: true };
  });
}
