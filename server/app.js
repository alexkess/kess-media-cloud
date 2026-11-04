import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { openDb, getSettings } from './db.js';
import { Router, HttpError, send, html, readBody, readJson, serveStatic } from './lib/http.js';
import { loadUser, isAgency } from './lib/auth.js';
import { j, buildSnapshot, getSite } from './lib/services.js';
import { renderPage, esc } from '../shared/sections.js';
import { sitemapXml } from './lib/astro-export.js';
import auth from './api/auth.js';
import clients from './api/clients.js';
import sites from './api/sites.js';
import requests from './api/requests.js';
import billing from './api/billing.js';
import misc from './api/misc.js';
import publicApi from './api/public.js';
import feedback, { reviewLinkFor } from './api/feedback.js';
import studio from './api/studio.js';
import studioPublic from './api/studio-public.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const SHARED = join(ROOT, 'shared');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

// Add the feedback overlay (public/feedback/overlay.js) to a rendered page.
function withOverlay(page, cfg) {
  const i = page.lastIndexOf('</body>');
  return `${page.slice(0, i)}<script src="/feedback/overlay.js" data-config="${esc(JSON.stringify(cfg))}" defer></script>${page.slice(i)}`;
}

function notFoundPage(res, msg = 'Page not found') {
  html(res, 404, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Not found</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;color:#1a1a1a"><div style="text-align:center"><h1 style="font-size:64px;margin:0;color:#1E5C34">404</h1><p>${esc(msg)}</p></div></body>`);
}

export function createApp({ dbFile = process.env.DB_FILE || join(ROOT, 'data', 'kess-cloud.db'), dataDir = process.env.DATA_DIR || join(ROOT, 'data'), db: existingDb } = {}) {
  const db = existingDb || openDb(dbFile);
  const router = new Router();
  for (const reg of [auth, clients, sites, requests, billing, misc, publicApi, feedback, studio, studioPublic]) reg(router, { dataDir });

  const platformHosts = () => {
    const s = getSettings(db);
    const hosts = new Set(['localhost', '127.0.0.1']);
    for (const u of [s.public_base_url, process.env.PUBLIC_URL]) { try { if (u) hosts.add(new URL(u).hostname); } catch {} }
    return hosts;
  };

  function baseUrlFor(req) {
    const s = getSettings(db);
    if (s.public_base_url) return s.public_base_url.replace(/\/$/, '');
    if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
    const proto = process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] ? String(req.headers['x-forwarded-proto']).split(',')[0] : 'http';
    return `${proto}://${req.headers.host || 'localhost'}`;
  }

  function servePublished(req, res, site, pagePath, { base, canonicalBase }) {
    if (!site.published_version_id) return notFoundPage(res, 'This site has not been published yet.');
    const v = db.get('SELECT snapshot FROM versions WHERE id = ?', site.published_version_id);
    const snap = j(v?.snapshot, null);
    if (!snap) return notFoundPage(res);
    const appBase = baseUrlFor(req);
    if (pagePath === 'sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(sitemapXml(snap, canonicalBase || appBase + base)); }
    if (pagePath === 'robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${(canonicalBase || appBase + base).replace(/\/$/, '')}/sitemap.xml\n`); }
    const out = renderPage(snap, pagePath, {
      base, canonicalBase: canonicalBase || appBase + base,
      formAction: `${appBase}/api/public/forms/${site.slug}`, hitUrl: `${appBase}/api/public/hit/${site.slug}`,
    });
    if (!out) return notFoundPage(res);
    html(res, 200, out, { 'Cache-Control': 'public, max-age=60', ...SECURITY_HEADERS });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();

    // 1. Custom domains: serve the client's published site at the root.
    if (host && !platformHosts().has(host)) {
      const site = db.get('SELECT * FROM sites WHERE domain = ? OR domain = ?', host, host.replace(/^www\./, ''));
      if (site && !path.startsWith('/api/public/') && !path.startsWith('/assets/')) {
        return servePublished(req, res, site, path.replace(/^\/+|\/+$/g, ''), { base: '', canonicalBase: `https://${site.domain}` });
      }
    }

    const ctx = {
      req, res, db, url, query: url.searchParams, params: {},
      user: loadUser(db, req),
      secure: (process.env.PUBLIC_URL || '').startsWith('https') || req.headers['x-forwarded-proto'] === 'https',
      settings: () => getSettings(db),
      baseUrl: baseUrlFor(req),
      setHeader: (k, v) => res.setHeader(k, v),
      body: (limit) => readJson(req, limit),
      rawBody: (limit) => readBody(req, limit),
    };

    // 2. Hosted sites on the platform domain: /s/<slug>/<page>
    let m = path.match(/^\/s\/([a-z0-9-]+)(?:\/(.*?))?\/?$/);
    if (m && req.method === 'GET') {
      const site = db.get('SELECT * FROM sites WHERE slug = ?', m[1]);
      if (!site) return notFoundPage(res);
      if (!path.endsWith('/') && !m[2]) { res.writeHead(301, { Location: path + '/' }); return res.end(); }
      return servePublished(req, res, site, m[2] || '', { base: `/s/${site.slug}` });
    }

    // 3. Previews (draft or a specific version), signed-in only.
    m = path.match(/^\/preview\/(\d+)(?:\/(.*?))?\/?$/);
    if (m && req.method === 'GET') {
      if (!ctx.user) { res.writeHead(302, { Location: '/#/login' }); return res.end(); }
      let site;
      try { site = getSite(db, Number(m[1])); } catch { return notFoundPage(res); }
      if (!isAgency(ctx.user) && ctx.user.client_id !== site.client_id) return notFoundPage(res);
      const vnum = url.searchParams.get('v');
      const feedbackOn = url.searchParams.get('feedback') === '1';
      let snap, label;
      if (vnum) {
        const v = db.get('SELECT snapshot, status FROM versions WHERE site_id = ? AND number = ?', site.id, Number(vnum));
        if (!v) return notFoundPage(res, 'Version not found');
        snap = j(v.snapshot, null); label = `Preview · v${vnum} (${v.status.replace('_', ' ')})`;
      } else { snap = buildSnapshot(db, site.id); label = 'Preview · draft (not live)'; }
      const qs = new URLSearchParams();
      if (vnum) qs.set('v', vnum);
      if (feedbackOn) qs.set('feedback', '1');
      const page = m[2] || '';
      let out = renderPage(snap, page, { base: `/preview/${site.id}`, formAction: '#', preview: feedbackOn ? '' : label });
      if (!out) return notFoundPage(res);
      // Keep internal links inside the same preview mode.
      if (qs.size) out = out.replace(new RegExp(`href="(/preview/${site.id}/[^"#?]*)"`, 'g'), `href="$1?${qs}"`);
      if (feedbackOn) out = withOverlay(out, { api: `/api/sites/${site.id}`, mode: 'user', page, version: vnum ? `v${vnum}` : 'draft', label, agency: isAgency(ctx.user), me: ctx.user.name, userId: ctx.user.id, focus: Number(url.searchParams.get('fb')) || null });
      return html(res, 200, out, { 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    }

    // 3b. Review links: anyone with the link can view (draft or live) and leave feedback.
    m = path.match(/^\/review\/([A-Za-z0-9_-]{16,64})(?:\/(.*?))?\/?$/);
    if (m && req.method === 'GET') {
      let link;
      try { link = reviewLinkFor(db, m[1]); } catch { return notFoundPage(res, 'This review link has expired or was turned off.'); }
      if (!path.endsWith('/') && !m[2]) { res.writeHead(301, { Location: path + '/' }); return res.end(); }
      const site = getSite(db, link.site_id);
      let snap, version = 'draft';
      if (link.target === 'live') {
        const v = site.published_version_id && db.get('SELECT number, snapshot FROM versions WHERE id = ?', site.published_version_id);
        if (!v) return notFoundPage(res, 'This site has not been published yet.');
        snap = j(v.snapshot, null); version = `v${v.number}`;
      } else snap = buildSnapshot(db, site.id);
      const page = m[2] || '';
      const out = renderPage(snap, page, { base: `/review/${link.token}`, formAction: '#', preview: '' });
      if (!out) return notFoundPage(res);
      return html(res, 200, withOverlay(out, { api: `/api/public/review/${link.token}`, mode: 'guest', page, version, label: `${site.name} · ${link.target === 'live' ? 'live site' : 'draft'}`, agency: false, focus: Number(url.searchParams.get('fb')) || null }),
        { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...SECURITY_HEADERS });
    }

    // 4. API + server-rendered routes
    const match = router.match(req.method, path);
    if (match?.handlers) {
      if (path.startsWith('/api/') && !path.startsWith('/api/public/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-kess'] !== '1') {
        return send(res, 403, { error: 'Missing X-Kess header' });
      }
      ctx.params = match.params;
      for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
      const out = await match.handlers[0](ctx);
      if (!res.writableEnded && !res.headersSent) send(res, 200, out ?? { ok: true });
      return;
    }
    if (match?.methodMismatch) return send(res, 405, { error: 'Method not allowed' });
    if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    // 5. Static files: app shell + shared modules
    if (req.method === 'GET') {
      if (path.startsWith('/shared/') && await serveStatic(res, SHARED, path.slice('/shared'.length))) return;
      if (path === '/' || path === '/index.html') { res.setHeader('X-Frame-Options', 'DENY'); if (await serveStatic(res, PUBLIC, 'index.html')) return; }
      if (await serveStatic(res, PUBLIC, path)) return;
    }
    notFoundPage(res);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.extra || {}) });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side' });
    });
  });
  return { server, db };
}
