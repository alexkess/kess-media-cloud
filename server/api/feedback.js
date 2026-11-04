// Live site feedback: pins, highlights and drawings on preview/live pages, with threads.
// Signed-in users comment through /api/sites/:id/feedback; people without an account
// comment through a review link (/review/<token>/...) using /api/public/review/<token>/feedback.
import { randomBytes } from 'node:crypto';
import { HttpError, bad, notFound, forbidden, rateLimiter, clientIp } from '../lib/http.js';
import { requireAgency, assertClientAccess, isAgency } from '../lib/auth.js';
import { getSite, j, logActivity, notify } from '../lib/services.js';

const postLimit = rateLimiter({ windowMs: 10 * 60_000, max: 40 });
const KINDS = ['pin', 'text', 'draw'];
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10000) / 10000)) : 0; };
const str = (v, max) => String(v ?? '').slice(0, max);

export function cleanAnchor(a = {}) {
  const sel = str(a.selector, 400);
  return {
    selector: /^[a-z0-9\s>:().#_-]*$/i.test(sel) ? sel : '',
    section: Number.isInteger(a.section) && a.section >= -1 && a.section < 200 ? a.section : -1,
    fx: num(a.fx, 0, 1), fy: num(a.fy, 0, 1),
    docX: num(a.docX, 0, 1), docY: num(a.docY, 0, 1e6),
    quote: str(a.quote, 500), tag: str(a.tag, 20).replace(/[^a-z0-9]/gi, ''),
  };
}

export function cleanShape(s = {}, kind) {
  if (kind !== 'draw' && kind !== 'text') return {};
  const out = {};
  if (Array.isArray(s.points)) out.points = s.points.slice(0, 600).filter((p) => Array.isArray(p) && p.length === 2).map(([x, y]) => [num(x, -0.5, 1.5), num(y, -0.5, 1.5)]);
  if (s.box) out.box = { x: num(s.box.x, -0.5, 1.5), y: num(s.box.y, -0.5, 1.5), w: num(s.box.w, 0, 2), h: num(s.box.h, 0, 2) };
  if (kind === 'draw' && !(out.points?.length > 1)) throw bad('Drawing is empty');
  return out;
}

function shapeFeedback(row, { agency, publicView, me }) {
  const replies = row.replies || [];
  return {
    id: row.id, page_slug: row.page_slug, version: row.version, kind: row.kind, status: row.status,
    anchor: j(row.anchor, {}), shape: j(row.shape, {}), viewport_w: row.viewport_w, body: row.body,
    author: row.user_name || row.guest_name || 'Someone', author_kind: row.user_role ? (row.user_role === 'client' ? 'client' : 'agency') : 'guest',
    ...(publicView ? {} : { guest_email: row.guest_email }),
    request_id: agency ? row.request_id : undefined,
    mine: !!me && row.user_id === me,
    resolved_at: row.resolved_at, created_at: row.created_at,
    replies: replies.map((r) => ({ id: r.id, body: r.body, author: r.user_name || r.guest_name || 'Someone', author_kind: r.user_role ? (r.user_role === 'client' ? 'client' : 'agency') : 'guest', created_at: r.created_at })),
  };
}

export function listFeedback(db, siteId, { page, status } = {}) {
  const conds = ['f.site_id = ?'], args = [siteId];
  if (page !== undefined && page !== null) { conds.push('f.page_slug = ?'); args.push(page); }
  if (status === 'open' || status === 'resolved') { conds.push('f.status = ?'); args.push(status); }
  const rows = db.all(`SELECT f.*, u.name user_name, u.role user_role FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE ${conds.join(' AND ')} ORDER BY f.id`, ...args);
  if (!rows.length) return rows;
  const replies = db.all(`SELECT r.*, u.name user_name, u.role user_role FROM feedback_replies r LEFT JOIN users u ON u.id = r.user_id WHERE r.feedback_id IN (${rows.map(() => '?').join(',')}) ORDER BY r.id`, ...rows.map((r) => r.id));
  for (const r of rows) r.replies = replies.filter((x) => x.feedback_id === r.id);
  return rows;
}

function createFeedback(db, site, b, { user = null, guest = null, linkId = null }) {
  const body = str(b.body, 5000).trim();
  if (!body) throw bad('Write a comment first');
  const kind = KINDS.includes(b.kind) ? b.kind : 'pin';
  const page = str(b.page_slug, 100);
  if (page && !/^[a-z0-9-]+$/.test(page)) throw bad('Invalid page');
  const { id } = db.run(`INSERT INTO feedback (site_id, page_slug, version, kind, anchor, shape, viewport_w, body, user_id, guest_name, guest_email, review_link_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, site.id, page, str(b.version || 'draft', 20).replace(/[^a-z0-9:]/gi, ''), kind,
  JSON.stringify(cleanAnchor(b.anchor)), JSON.stringify(cleanShape(b.shape, kind)), Math.min(10000, Math.max(0, Number(b.viewport_w) || 0)) || null,
  body, user?.id ?? null, guest?.name ?? null, guest?.email ?? null, linkId);
  // One notification per burst: skip if the same person commented on this site in the last 10 minutes.
  const who = user ? ['user_id = ?', user.id] : ['guest_name = ? AND review_link_id IS ?', guest.name, linkId];
  const recent = db.get(`SELECT 1 FROM feedback WHERE site_id = ? AND id != ? AND ${who[0]} AND created_at > datetime('now', '-10 minutes')`, site.id, id, ...who.slice(1));
  const name = user?.name || `${guest.name} (review link)`;
  if (!recent && (!user || !isAgency(user))) notify(db, { audience: 'agency', client_id: site.client_id, title: `${name} left feedback on ${site.name}`, body: body.slice(0, 200), link: `#/sites/${site.id}/feedback` });
  logActivity(db, { user, client_id: site.client_id, site_id: site.id, action: 'feedback.created', detail: `${guest ? guest.name + ': ' : ''}/${page} ${body.slice(0, 60)}` });
  return id;
}

function addReply(db, site, fb, body, { user = null, guest = null }) {
  const text = str(body, 5000).trim();
  if (!text) throw bad('Reply is empty');
  db.run('INSERT INTO feedback_replies (feedback_id, user_id, guest_name, body) VALUES (?, ?, ?, ?)', fb.id, user?.id ?? null, guest?.name ?? null, text);
  if (fb.status === 'resolved' && !(user && isAgency(user))) db.run("UPDATE feedback SET status = 'open', resolved_at = NULL WHERE id = ?", fb.id);
  const fromAgency = user && isAgency(user);
  notify(db, { audience: fromAgency ? 'client' : 'agency', client_id: site.client_id, title: `${user?.name || guest.name} replied to feedback on ${site.name}`, body: text.slice(0, 200), link: `#/sites/${site.id}/feedback` });
}

function getFb(db, siteId, fid) {
  const fb = db.get('SELECT * FROM feedback WHERE id = ? AND site_id = ?', Number(fid), siteId);
  if (!fb) throw notFound('Comment not found');
  return fb;
}

export function reviewLinkFor(db, token) {
  const link = /^[A-Za-z0-9_-]{16,64}$/.test(token || '') && db.get("SELECT * FROM review_links WHERE token = ? AND revoked = 0 AND (expires_at IS NULL OR expires_at > datetime('now'))", token);
  if (!link) throw notFound('This review link has expired or was turned off');
  return link;
}

function guestFrom(b) {
  const name = str(b.guest_name, 80).trim();
  const email = str(b.guest_email, 200).trim();
  if (!name) throw bad('Add your name so we know who the comment is from');
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('That email looks wrong');
  return { name, email: email || null };
}

export default function register(r) {
  const siteFor = (ctx) => { const s = getSite(ctx.db, Number(ctx.params.id)); assertClientAccess(ctx, s.client_id); return s; };

  r.get('/api/sites/:id/feedback', async (ctx) => {
    const site = siteFor(ctx);
    const agency = isAgency(ctx.user);
    return listFeedback(ctx.db, site.id, { page: ctx.query.get('page'), status: ctx.query.get('status') }).map((row) => shapeFeedback(row, { agency, me: ctx.user.id }));
  });
  r.post('/api/sites/:id/feedback', async (ctx) => {
    const site = siteFor(ctx);
    if (!postLimit(`u${ctx.user.id}`)) throw new HttpError(429, 'Slow down a little and try again shortly');
    const id = createFeedback(ctx.db, site, await ctx.body(100_000), { user: ctx.user });
    return shapeFeedback(listFeedback(ctx.db, site.id).find((f) => f.id === id), { agency: isAgency(ctx.user), me: ctx.user.id });
  });
  r.patch('/api/sites/:id/feedback/:fid', async (ctx) => {
    const site = siteFor(ctx);
    const fb = getFb(ctx.db, site.id, ctx.params.fid);
    const { status, body } = await ctx.body();
    if (status) {
      if (!['open', 'resolved'].includes(status)) throw bad('Invalid status');
      if (!isAgency(ctx.user) && status === 'resolved' && fb.user_id !== ctx.user.id) throw forbidden('Only Kess Media or the person who left it can resolve this');
      ctx.db.run('UPDATE feedback SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?', status, status === 'resolved' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null, status === 'resolved' ? ctx.user.id : null, fb.id);
    }
    if (body !== undefined) {
      if (fb.user_id !== ctx.user.id) throw forbidden('You can only edit your own comments');
      if (!String(body).trim()) throw bad('Comment is empty');
      ctx.db.run('UPDATE feedback SET body = ? WHERE id = ?', str(body, 5000).trim(), fb.id);
    }
    return { ok: true };
  });
  r.delete('/api/sites/:id/feedback/:fid', async (ctx) => {
    const site = siteFor(ctx);
    const fb = getFb(ctx.db, site.id, ctx.params.fid);
    if (!isAgency(ctx.user) && fb.user_id !== ctx.user.id) throw forbidden('You can only delete your own comments');
    ctx.db.run('DELETE FROM feedback WHERE id = ?', fb.id);
    return { ok: true };
  });
  r.post('/api/sites/:id/feedback/:fid/replies', async (ctx) => {
    const site = siteFor(ctx);
    const fb = getFb(ctx.db, site.id, ctx.params.fid);
    addReply(ctx.db, site, fb, (await ctx.body()).body, { user: ctx.user });
    return { ok: true };
  });
  // Turn a comment into a change request on the requests board.
  r.post('/api/sites/:id/feedback/:fid/request', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const fb = getFb(ctx.db, site.id, ctx.params.fid);
    if (fb.request_id) return { request_id: fb.request_id };
    const who = fb.guest_name ? `${fb.guest_name} (review link)` : ctx.db.get('SELECT name FROM users WHERE id = ?', fb.user_id)?.name || 'Someone';
    const anchor = j(fb.anchor, {});
    const where = `Page: /${fb.page_slug}${anchor.quote ? `\nHighlighted: "${anchor.quote}"` : ''}\nOpen on the page: ${ctx.baseUrl}/preview/${site.id}/${fb.page_slug}?feedback=1&fb=${fb.id}`;
    const { id } = ctx.db.run("INSERT INTO requests (client_id, site_id, title, body, kind, created_by) VALUES (?, ?, ?, ?, 'feedback', ?)",
      site.client_id, site.id, `Feedback: ${fb.body.slice(0, 80)}${fb.body.length > 80 ? '…' : ''}`, `${who} wrote:\n${fb.body}\n\n${where}`, ctx.user.id);
    ctx.db.run('UPDATE feedback SET request_id = ? WHERE id = ?', id, fb.id);
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'request.created', detail: `#${id} from feedback` });
    return { request_id: id };
  });

  // ----- review links (share with people who have no account) -----
  r.get('/api/sites/:id/review-links', async (ctx) => {
    const site = siteFor(ctx);
    return ctx.db.all(`SELECT l.*, u.name created_by_name, (SELECT COUNT(*) FROM feedback f WHERE f.review_link_id = l.id) comments
      FROM review_links l LEFT JOIN users u ON u.id = l.created_by WHERE l.site_id = ? ORDER BY l.id DESC`, site.id)
      .map((l) => ({ ...l, url: `${ctx.baseUrl}/review/${l.token}/` }));
  });
  r.post('/api/sites/:id/review-links', async (ctx) => {
    const site = siteFor(ctx);
    const b = await ctx.body();
    const target = b.target === 'live' ? 'live' : 'draft';
    if (target === 'live' && !site.published_version_id) throw bad('The site has not been published yet. Share the draft instead.');
    const days = Math.min(365, Math.max(0, Number(b.days) || 0));
    const token = randomBytes(18).toString('base64url');
    ctx.db.run(`INSERT INTO review_links (site_id, token, label, target, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ${days ? `datetime('now', '+${days} days')` : 'NULL'})`, site.id, token, str(b.label, 100), target, ctx.user.id);
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'review_link.created', detail: `${target}${b.label ? `: ${b.label}` : ''}` });
    return { token, url: `${ctx.baseUrl}/review/${token}/` };
  });
  r.delete('/api/sites/:id/review-links/:lid', async (ctx) => {
    const site = siteFor(ctx);
    const { changes } = ctx.db.run('UPDATE review_links SET revoked = 1 WHERE id = ? AND site_id = ?', Number(ctx.params.lid), site.id);
    if (!changes) throw notFound();
    return { ok: true };
  });

  // ----- public (review link) endpoints -----
  r.get('/api/public/review/:token/feedback', async (ctx) => {
    const link = reviewLinkFor(ctx.db, ctx.params.token);
    return listFeedback(ctx.db, link.site_id, { page: ctx.query.get('page') }).map((row) => shapeFeedback(row, { publicView: true }));
  });
  r.post('/api/public/review/:token/feedback', async (ctx) => {
    const link = reviewLinkFor(ctx.db, ctx.params.token);
    if (!postLimit(clientIp(ctx.req))) throw new HttpError(429, 'Slow down a little and try again shortly');
    const b = await ctx.body(100_000);
    const site = getSite(ctx.db, link.site_id);
    const id = createFeedback(ctx.db, site, b, { guest: guestFrom(b), linkId: link.id });
    return shapeFeedback(listFeedback(ctx.db, site.id).find((f) => f.id === id), { publicView: true });
  });
  r.post('/api/public/review/:token/feedback/:fid/replies', async (ctx) => {
    const link = reviewLinkFor(ctx.db, ctx.params.token);
    if (!postLimit(clientIp(ctx.req))) throw new HttpError(429, 'Slow down a little and try again shortly');
    const b = await ctx.body();
    const site = getSite(ctx.db, link.site_id);
    addReply(ctx.db, site, getFb(ctx.db, site.id, ctx.params.fid), b.body, { guest: guestFrom(b) });
    return { ok: true };
  });
}
