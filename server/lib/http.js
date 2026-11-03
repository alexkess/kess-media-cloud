import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (msg) => new HttpError(400, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }).replace(/\/\*$/, '/(.*)') + '/?$');
    if (pattern.endsWith('/*')) keys.push('rest');
    this.routes.push({ method, re, keys, handlers });
    return this;
  }
  get(p, ...h) { return this.add('GET', p, ...h); }
  post(p, ...h) { return this.add('POST', p, ...h); }
  put(p, ...h) { return this.add('PUT', p, ...h); }
  patch(p, ...h) { return this.add('PATCH', p, ...h); }
  delete(p, ...h) { return this.add('DELETE', p, ...h); }
  match(method, path) {
    let methodMismatch = false;
    for (const r of this.routes) {
      const m = r.re.exec(path);
      if (!m) continue;
      if (r.method !== method) { methodMismatch = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handlers: r.handlers, params };
    }
    return methodMismatch ? { methodMismatch } : null;
  }
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  if (body === undefined || body === null) { res.writeHead(status, headers); return res.end(); }
  if (Buffer.isBuffer(body) || typeof body === 'string') {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    return res.end(body);
  }
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(json);
}

export function html(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

export async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Request body too large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw bad('Invalid JSON body'); }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};
export const mimeFor = (p) => MIME[extname(p).toLowerCase()] || 'application/octet-stream';

export async function serveStatic(res, root, urlPath, { cache = 'no-cache' } = {}) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  const full = join(root, rel);
  if (!full.startsWith(root + sep) && full !== root) return false;
  try {
    const st = await stat(full);
    if (!st.isFile()) return false;
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': mimeFor(full), 'Cache-Control': cache, 'Content-Length': body.length });
    res.end(body);
    return true;
  } catch { return false; }
}

// Simple fixed-window rate limiter, in memory.
export function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || now - h.start > windowMs) { h = { start: now, n: 0 }; hits.set(key, h); }
    h.n++;
    if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
    return h.n <= max;
  };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (process.env.TRUST_PROXY && fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}
