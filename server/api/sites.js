import { bad, notFound, forbidden, HttpError } from '../lib/http.js';
import { requireAgency, requireOwner, assertClientAccess, isAgency } from '../lib/auth.js';
import { getSite, hydratePage, j, slugify, logActivity, notify, createVersion, publishVersion, buildSnapshot } from '../lib/services.js';
import { TEMPLATES } from '../../shared/templates.js';
import { SECTION_TYPES, defaultTheme, auditPage, THEME_PRESETS } from '../../shared/sections.js';
import { astroProjectFiles } from '../lib/astro-export.js';
import { tarGz } from '../lib/tar.js';
import { checkSite, uptimeSummary } from '../lib/monitor.js';

export const STAGES = ['lead', 'proposal', 'design', 'build', 'review', 'live', 'care', 'archived'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_RE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function validateSections(sections) {
  if (!Array.isArray(sections)) throw bad('sections must be an array');
  if (sections.length > 40) throw bad('Too many sections on one page');
  for (const s of sections) {
    if (!s || !SECTION_TYPES[s.type]) throw bad(`Unknown section type: ${s?.type}`);
  }
  return sections.map((s) => {
    const def = SECTION_TYPES[s.type];
    const clean = { type: s.type };
    for (const f of def.fields) {
      const v = s[f.key];
      if (f.type === 'list') {
        clean[f.key] = (Array.isArray(v) ? v : []).slice(0, 60).map((it) => Object.fromEntries(f.fields.map((sf) => [sf.key, String(it?.[sf.key] ?? '').slice(0, 5000)])));
      } else if (f.type === 'boolean') clean[f.key] = v === true || v === 'true';
      else if (f.type === 'select') clean[f.key] = f.options.includes(v) ? v : f.default ?? f.options[0];
      else clean[f.key] = String(v ?? '').slice(0, 20000);
    }
    return clean;
  });
}

function validateTheme(t) {
  const base = defaultTheme(THEME_PRESETS[t?.preset] ? t.preset : 'kess');
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  const colors = { ...base.colors };
  for (const k of Object.keys(colors)) if (hex.test(t?.colors?.[k] || '')) colors[k] = t.colors[k];
  const font = (v, d) => (typeof v === 'string' && /^[\w ]{2,40}$/.test(v) ? v : d);
  return { preset: base.preset, colors, fonts: { body: font(t?.fonts?.body, base.fonts.body), accent: font(t?.fonts?.accent, base.fonts.accent) }, radius: Math.min(40, Math.max(0, Number(t?.radius ?? base.radius) || 0)) };
}

const SETTINGS_KEYS = ['tagline', 'description', 'email', 'phone', 'address', 'logo', 'ogImage', 'lang', 'schemaType', 'notifyEmail', 'autoPublishOnApproval'];
function validateSettings(s, prev = {}) {
  const out = { ...prev };
  for (const k of SETTINGS_KEYS) if (s && k in s) out[k] = k === 'autoPublishOnApproval' ? !!s[k] : String(s[k] ?? '').slice(0, 1000);
  return out;
}

function siteAccess(ctx, siteId) {
  const site = getSite(ctx.db, siteId);
  assertClientAccess(ctx, site.client_id);
  return site;
}

export function createSiteFromTemplate(db, { client_id, name, template = 'service', slug, domain, plan_id, user, stage = 'design' }) {
  const tpl = TEMPLATES[template];
  if (!tpl) throw bad('Unknown template');
  let base = slugify(slug || name) || 'site';
  let s = base, n = 2;
  while (db.get('SELECT 1 FROM sites WHERE slug = ?', s)) s = `${base}-${n++}`;
  return db.tx(() => {
    const { id } = db.run('INSERT INTO sites (client_id, name, slug, domain, stage, template, theme, settings, plan_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      client_id, name, s, domain || null, stage, template, JSON.stringify(defaultTheme(tpl.theme)), JSON.stringify({ lang: 'en-AU', autoPublishOnApproval: true }), plan_id || null);
    tpl.pages(name).forEach((p, i) => db.run('INSERT INTO pages (site_id, slug, title, description, sections, sort) VALUES (?, ?, ?, ?, ?, ?)', id, p.slug, p.title, p.description, JSON.stringify(p.sections), i));
    logActivity(db, { user, client_id, site_id: id, action: 'site.created', detail: `${name} from ${tpl.label} template` });
    return id;
  });
}

export default function register(r) {
  r.get('/api/templates', async (ctx) => {
    return { templates: Object.entries(TEMPLATES).map(([key, t]) => ({ key, label: t.label, description: t.description, theme: t.theme })), sections: SECTION_TYPES, presets: THEME_PRESETS, stages: STAGES };
  });

  r.get('/api/sites', async (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Please sign in');
    const where = isAgency(ctx.user) ? '' : 'WHERE s.client_id = ?';
    const args = isAgency(ctx.user) ? [] : [ctx.user.client_id];
    const rows = ctx.db.all(`SELECT s.id, s.name, s.slug, s.domain, s.stage, s.client_id, s.updated_at, s.launch_date, s.published_version_id, c.name client_name, p.name plan_name, p.price_cents,
      (SELECT number FROM versions v WHERE v.id = s.published_version_id) live_version,
      (SELECT COUNT(*) FROM versions v WHERE v.site_id = s.id AND v.status = 'pending') pending_reviews,
      (SELECT COUNT(*) FROM submissions m WHERE m.site_id = s.id AND m.status = 'new') new_leads,
      (SELECT COALESCE(SUM(views),0) FROM pageviews pv WHERE pv.site_id = s.id AND pv.day >= date('now','-30 days')) views_30d
      FROM sites s JOIN clients c ON c.id = s.client_id LEFT JOIN plans p ON p.id = s.plan_id ${where} ORDER BY s.updated_at DESC`, ...args);
    return rows.map((s) => ({ ...s, uptime: s.domain ? uptimeSummary(ctx.db, s.id) : null }));
  });

  r.post('/api/sites', async (ctx) => {
    requireAgency(ctx);
    const b = await ctx.body();
    if (!b.client_id || !ctx.db.get('SELECT 1 FROM clients WHERE id = ?', b.client_id)) throw bad('Choose a client');
    if (!b.name?.trim()) throw bad('Site name is required');
    if (b.domain && !DOMAIN_RE.test(b.domain)) throw bad('Domain looks invalid (e.g. example.com.au)');
    if (b.domain && ctx.db.get('SELECT 1 FROM sites WHERE domain = ?', b.domain)) throw bad('Another site already uses that domain');
    const id = createSiteFromTemplate(ctx.db, { ...b, name: b.name.trim(), user: ctx.user });
    return getSite(ctx.db, id);
  });

  r.get('/api/sites/:id', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const agency = isAgency(ctx.user);
    const pages = ctx.db.all('SELECT * FROM pages WHERE site_id = ? ORDER BY sort, id', site.id).map(hydratePage);
    const versions = ctx.db.all(`SELECT v.id, v.number, v.note, v.status, v.created_at, v.reviewed_at, v.review_note, v.published_at, u.name created_by_name, r.name reviewed_by_name
      FROM versions v LEFT JOIN users u ON u.id = v.created_by LEFT JOIN users r ON r.id = v.reviewed_by WHERE v.site_id = ? ORDER BY v.number DESC LIMIT 50`, site.id);
    const deploys = agency ? ctx.db.all('SELECT d.*, v.number version FROM deploys d LEFT JOIN versions v ON v.id = d.version_id WHERE d.site_id = ? ORDER BY d.id DESC LIMIT 20', site.id) : [];
    const plan = site.plan_id ? ctx.db.get('SELECT * FROM plans WHERE id = ?', site.plan_id) : null;
    const client = ctx.db.get('SELECT id, name FROM clients WHERE id = ?', site.client_id);
    const checks = ctx.db.all('SELECT ok, status_code, ms, error, cert_expires, created_at FROM checks WHERE site_id = ? ORDER BY id DESC LIMIT 48', site.id);
    return { ...site, client, pages, versions, deploys, plan: plan ? { ...plan, features: j(plan.features, []) } : null, uptime: uptimeSummary(ctx.db, site.id), checks,
      urls: { hosted: `${ctx.baseUrl}/s/${site.slug}/`, preview: `${ctx.baseUrl}/preview/${site.id}/`, domain: site.domain ? `https://${site.domain}/` : null } };
  });

  r.patch('/api/sites/:id', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const next = { name: site.name, domain: site.domain, stage: site.stage, plan_id: site.plan_id, client_can_edit: site.client_can_edit, theme: site.theme, settings: site.settings, slug: site.slug };
    if ('name' in b) { if (!String(b.name).trim()) throw bad('Name is required'); next.name = String(b.name).trim(); }
    if ('slug' in b) {
      if (!SLUG_RE.test(b.slug)) throw bad('Slug can only use lowercase letters, numbers and dashes');
      if (b.slug !== site.slug && ctx.db.get('SELECT 1 FROM sites WHERE slug = ?', b.slug)) throw bad('Slug already in use');
      next.slug = b.slug;
    }
    if ('domain' in b) {
      const d = String(b.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (d && !DOMAIN_RE.test(d)) throw bad('Domain looks invalid');
      if (d && ctx.db.get('SELECT 1 FROM sites WHERE domain = ? AND id != ?', d, site.id)) throw bad('Another site already uses that domain');
      next.domain = d || null;
    }
    if ('stage' in b) { if (!STAGES.includes(b.stage)) throw bad('Invalid stage'); next.stage = b.stage; }
    if ('plan_id' in b) next.plan_id = b.plan_id ? Number(b.plan_id) : null;
    if ('client_can_edit' in b) next.client_can_edit = !!b.client_can_edit;
    if ('theme' in b) next.theme = validateTheme(b.theme);
    if ('settings' in b) next.settings = validateSettings(b.settings, site.settings);
    ctx.db.run("UPDATE sites SET name=?, slug=?, domain=?, stage=?, plan_id=?, client_can_edit=?, theme=?, settings=?, updated_at=datetime('now') WHERE id=?",
      next.name, next.slug, next.domain, next.stage, next.plan_id, next.client_can_edit ? 1 : 0, JSON.stringify(next.theme), JSON.stringify(next.settings), site.id);
    if (b.stage && b.stage !== site.stage) {
      logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'site.stage', detail: `${site.stage} → ${b.stage}` });
      notify(ctx.db, { audience: 'client', client_id: site.client_id, title: `${next.name} moved to ${b.stage}`, link: `#/sites/${site.id}` });
    }
    return getSite(ctx.db, site.id);
  });

  r.delete('/api/sites/:id', async (ctx) => {
    requireOwner(ctx);
    const { changes } = ctx.db.run('DELETE FROM sites WHERE id = ?', Number(ctx.params.id));
    if (!changes) throw notFound('Site not found');
    return { ok: true };
  });

  r.post('/api/sites/:id/duplicate', async (ctx) => {
    requireAgency(ctx);
    const src = getSite(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const clientId = Number(b.client_id || src.client_id);
    const name = String(b.name || `${src.name} copy`).trim();
    let base = slugify(name), s = base, n = 2;
    while (ctx.db.get('SELECT 1 FROM sites WHERE slug = ?', s)) s = `${base}-${n++}`;
    const id = ctx.db.tx(() => {
      const { id } = ctx.db.run("INSERT INTO sites (client_id, name, slug, stage, template, theme, settings, plan_id) VALUES (?, ?, ?, 'design', ?, ?, ?, ?)", clientId, name, s, src.template, JSON.stringify(src.theme), JSON.stringify(src.settings), src.plan_id);
      for (const p of ctx.db.all('SELECT * FROM pages WHERE site_id = ? ORDER BY sort', src.id)) ctx.db.run('INSERT INTO pages (site_id, slug, title, nav_label, description, in_nav, sections, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, p.slug, p.title, p.nav_label, p.description, p.in_nav, p.sections, p.sort);
      return id;
    });
    logActivity(ctx.db, { user: ctx.user, client_id: clientId, site_id: id, action: 'site.duplicated', detail: `from ${src.name}` });
    return getSite(ctx.db, id);
  });

  // ----- pages -----
  r.post('/api/sites/:id/pages', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const b = await ctx.body();
    const title = String(b.title || '').trim();
    if (!title) throw bad('Page title is required');
    const slug = b.slug === '' ? '' : slugify(b.slug || title);
    if (slug && !SLUG_RE.test(slug)) throw bad('Invalid slug');
    if (ctx.db.get('SELECT 1 FROM pages WHERE site_id = ? AND slug = ?', site.id, slug)) throw bad('A page with that slug already exists');
    const sort = (ctx.db.get('SELECT MAX(sort) m FROM pages WHERE site_id = ?', site.id)?.m ?? -1) + 1;
    const sections = validateSections(b.sections || [{ type: 'hero', style: 'light', heading: title }]);
    const { id } = ctx.db.run('INSERT INTO pages (site_id, slug, title, description, sections, sort, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', site.id, slug, title, b.description || '', JSON.stringify(sections), sort, ctx.user.id);
    ctx.db.run("UPDATE sites SET updated_at = datetime('now') WHERE id = ?", site.id);
    return hydratePage(ctx.db.get('SELECT * FROM pages WHERE id = ?', id));
  });

  r.patch('/api/sites/:id/pages/:pageId', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const page = ctx.db.get('SELECT * FROM pages WHERE id = ? AND site_id = ?', Number(ctx.params.pageId), site.id);
    if (!page) throw notFound('Page not found');
    const b = await ctx.body();
    const agency = isAgency(ctx.user);
    const cur = hydratePage(page);
    const next = { slug: cur.slug, title: cur.title, nav_label: cur.nav_label, description: cur.description, in_nav: cur.in_nav, sections: cur.sections };
    if (!agency) {
      if (!site.client_can_edit) throw forbidden('Editing is turned off for this site. Send a change request instead.');
      // Clients edit content only: same sections, same order, same types.
      if ('sections' in b) {
        const incoming = validateSections(b.sections);
        if (incoming.length !== cur.sections.length || incoming.some((s, i) => s.type !== cur.sections[i].type)) throw forbidden('You can edit text and images. Ask Kess Media to add or remove sections.');
        next.sections = incoming.map((s, i) => (s.type === 'hero' ? { ...s, style: cur.sections[i].style } : s));
      }
      if ('description' in b) next.description = String(b.description || '').slice(0, 300);
      if ('title' in b && String(b.title).trim()) next.title = String(b.title).trim().slice(0, 120);
    } else {
      if ('title' in b) { if (!String(b.title).trim()) throw bad('Title is required'); next.title = String(b.title).trim(); }
      if ('slug' in b) {
        const s = b.slug === '' ? '' : String(b.slug);
        if (s && !SLUG_RE.test(s)) throw bad('Slug can only use lowercase letters, numbers and dashes');
        if (s !== cur.slug && ctx.db.get('SELECT 1 FROM pages WHERE site_id = ? AND slug = ?', site.id, s)) throw bad('A page with that slug already exists');
        next.slug = s;
      }
      if ('nav_label' in b) next.nav_label = String(b.nav_label || '') || null;
      if ('description' in b) next.description = String(b.description || '');
      if ('in_nav' in b) next.in_nav = !!b.in_nav;
      if ('sections' in b) next.sections = validateSections(b.sections);
    }
    ctx.db.run("UPDATE pages SET slug=?, title=?, nav_label=?, description=?, in_nav=?, sections=?, updated_at=datetime('now'), updated_by=? WHERE id=?",
      next.slug, next.title, next.nav_label, next.description, next.in_nav ? 1 : 0, JSON.stringify(next.sections), ctx.user.id, page.id);
    ctx.db.run("UPDATE sites SET updated_at = datetime('now') WHERE id = ?", site.id);
    if (!agency) {
      logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'page.client_edit', detail: next.title });
    }
    return hydratePage(ctx.db.get('SELECT * FROM pages WHERE id = ?', page.id));
  });

  r.post('/api/sites/:id/pages/reorder', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const { ids } = await ctx.body();
    if (!Array.isArray(ids)) throw bad('ids must be an array');
    ctx.db.tx(() => ids.forEach((pid, i) => ctx.db.run('UPDATE pages SET sort = ? WHERE id = ? AND site_id = ?', i, Number(pid), site.id)));
    return { ok: true };
  });

  r.delete('/api/sites/:id/pages/:pageId', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const page = ctx.db.get('SELECT slug FROM pages WHERE id = ? AND site_id = ?', Number(ctx.params.pageId), site.id);
    if (!page) throw notFound('Page not found');
    if (page.slug === '') throw bad('The home page cannot be deleted');
    ctx.db.run('DELETE FROM pages WHERE id = ?', Number(ctx.params.pageId));
    return { ok: true };
  });

  // ----- versions, approvals, publishing -----
  r.post('/api/sites/:id/versions', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const b = await ctx.body();
    const agency = isAgency(ctx.user);
    const mode = b.mode === 'publish' ? 'publish' : 'review';
    if (mode === 'publish' && !agency) throw forbidden('Only Kess Media can publish directly');
    if (!agency && !site.client_can_edit) throw forbidden();
    const v = createVersion(ctx.db, { siteId: site.id, user: ctx.user, note: b.note, status: mode === 'publish' ? 'approved' : 'pending' });
    if (mode === 'publish') {
      publishVersion(ctx.db, { siteId: site.id, versionId: v.id, user: ctx.user });
      logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'site.published', detail: `v${v.number}${b.note ? ': ' + b.note : ''}` });
      notify(ctx.db, { audience: 'client', client_id: site.client_id, title: `${site.name} was updated (v${v.number})`, body: b.note || '', link: `#/sites/${site.id}` });
    } else if (agency) {
      ctx.db.run("UPDATE sites SET stage = CASE WHEN stage IN ('design','build') THEN 'review' ELSE stage END WHERE id = ?", site.id);
      logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'version.sent_for_review', detail: `v${v.number}` });
      notify(ctx.db, { audience: 'client', client_id: site.client_id, title: `v${v.number} of ${site.name} is ready for your review`, body: b.note || '', link: `#/sites/${site.id}` });
    } else {
      // Client submitted their own edits for Kess Media to check and publish.
      logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'version.client_submitted', detail: `v${v.number}` });
      notify(ctx.db, { audience: 'agency', client_id: site.client_id, title: `${ctx.user.name} submitted edits to ${site.name}`, body: b.note || '', link: `#/sites/${site.id}` });
    }
    return { ...v, mode };
  });

  r.get('/api/sites/:id/versions/:vid', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const v = ctx.db.get('SELECT * FROM versions WHERE id = ? AND site_id = ?', Number(ctx.params.vid), site.id);
    if (!v) throw notFound('Version not found');
    return { ...v, snapshot: j(v.snapshot, {}) };
  });

  r.post('/api/sites/:id/versions/:vid/approve', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const v = ctx.db.get('SELECT * FROM versions WHERE id = ? AND site_id = ?', Number(ctx.params.vid), site.id);
    if (!v) throw notFound('Version not found');
    if (v.status !== 'pending') throw bad('This version is not waiting for approval');
    const agency = isAgency(ctx.user);
    const createdByClient = ctx.db.get('SELECT role FROM users WHERE id = ?', v.created_by)?.role === 'client';
    if (!agency && createdByClient) throw forbidden('Kess Media will review and publish your edits');
    const { note } = await ctx.body();
    ctx.db.run("UPDATE versions SET status = 'approved', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?", ctx.user.id, note || '', v.id);
    let published = false;
    if (agency || site.settings.autoPublishOnApproval !== false) { publishVersion(ctx.db, { siteId: site.id, versionId: v.id, user: ctx.user }); published = true; }
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'version.approved', detail: `v${v.number}${published ? ' (published)' : ''}` });
    notify(ctx.db, { audience: agency ? 'client' : 'agency', client_id: site.client_id, title: `v${v.number} of ${site.name} approved${published ? ' and live' : ''}`, body: note || '', link: `#/sites/${site.id}` });
    return { ok: true, published };
  });

  r.post('/api/sites/:id/versions/:vid/request-changes', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const v = ctx.db.get('SELECT * FROM versions WHERE id = ? AND site_id = ?', Number(ctx.params.vid), site.id);
    if (!v) throw notFound('Version not found');
    if (v.status !== 'pending') throw bad('This version is not waiting for approval');
    const { note } = await ctx.body();
    if (!String(note || '').trim()) throw bad('Tell us what needs to change');
    ctx.db.run("UPDATE versions SET status = 'changes_requested', reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?", ctx.user.id, note, v.id);
    let requestId = null;
    if (!isAgency(ctx.user)) {
      requestId = ctx.db.run("INSERT INTO requests (client_id, site_id, title, body, kind, created_by) VALUES (?, ?, ?, ?, 'feedback', ?)", site.client_id, site.id, `Feedback on v${v.number}`, note, ctx.user.id).id;
      notify(ctx.db, { audience: 'agency', client_id: site.client_id, title: `Changes requested on ${site.name} v${v.number}`, body: note, link: `#/requests/${requestId}` });
    } else {
      notify(ctx.db, { audience: 'client', client_id: site.client_id, title: `Kess Media reviewed your edits to ${site.name}`, body: note, link: `#/sites/${site.id}` });
    }
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'version.changes_requested', detail: `v${v.number}` });
    return { ok: true, request_id: requestId };
  });

  r.post('/api/sites/:id/versions/:vid/publish', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const out = publishVersion(ctx.db, { siteId: site.id, versionId: Number(ctx.params.vid), user: ctx.user });
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'site.published', detail: `v${out.version} (manual / rollback)` });
    return out;
  });

  // Load a version back into the draft (agency).
  r.post('/api/sites/:id/versions/:vid/restore', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const v = ctx.db.get('SELECT * FROM versions WHERE id = ? AND site_id = ?', Number(ctx.params.vid), site.id);
    if (!v) throw notFound('Version not found');
    const snap = j(v.snapshot, null);
    ctx.db.tx(() => {
      ctx.db.run('DELETE FROM pages WHERE site_id = ?', site.id);
      snap.pages.forEach((p, i) => ctx.db.run('INSERT INTO pages (site_id, slug, title, nav_label, description, in_nav, sections, sort, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', site.id, p.slug, p.title, p.navLabel || null, p.description, p.inNav === false ? 0 : 1, JSON.stringify(p.sections), i, ctx.user.id));
      ctx.db.run("UPDATE sites SET theme = ?, settings = ?, updated_at = datetime('now') WHERE id = ?", JSON.stringify(snap.theme), JSON.stringify(snap.site.settings || {}), site.id);
    });
    logActivity(ctx.db, { user: ctx.user, client_id: site.client_id, site_id: site.id, action: 'draft.restored', detail: `from v${v.number}` });
    return { ok: true };
  });

  r.get('/api/sites/:id/audit', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const snap = buildSnapshot(ctx.db, site.id);
    const pages = snap.pages.map((p) => auditPage(snap, p));
    const siteIssues = [];
    if (!snap.site.settings.description) siteIssues.push({ level: 'warn', msg: 'No default meta description in site settings' });
    if (!snap.site.settings.email && !snap.site.settings.phone) siteIssues.push({ level: 'warn', msg: 'No contact email or phone in the footer' });
    if (!site.domain) siteIssues.push({ level: 'info', msg: 'No custom domain yet' });
    if (!snap.pages.some((p) => p.sections.some((s) => s.type === 'contact'))) siteIssues.push({ level: 'warn', msg: 'No contact form on any page' });
    const score = Math.round(pages.reduce((n, p) => n + p.score, 0) / (pages.length || 1));
    return { score, pages, site: siteIssues };
  });

  r.get('/api/sites/:id/export', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    const vid = ctx.query.get('version');
    let snap;
    if (vid) {
      const v = ctx.db.get('SELECT snapshot FROM versions WHERE site_id = ? AND number = ?', site.id, Number(vid));
      if (!v) throw notFound('Version not found');
      snap = j(v.snapshot, null);
    } else snap = buildSnapshot(ctx.db, site.id);
    const files = astroProjectFiles(snap, {
      formAction: `${ctx.baseUrl}/api/public/forms/${site.slug}`,
      hitUrl: `${ctx.baseUrl}/api/public/hit/${site.slug}`,
      siteUrl: site.domain ? `https://${site.domain}` : '',
    });
    const buf = tarGz(files, `${site.slug}-website`);
    ctx.db.run("INSERT INTO deploys (site_id, target, status, log, created_by) VALUES (?, 'astro-export', 'success', ?, ?)", site.id, `Exported Astro + Sanity project (${files.length} files)${vid ? ` from v${vid}` : ' from draft'}`, ctx.user.id);
    ctx.res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="${site.slug}-website.tar.gz"`, 'Content-Length': buf.length });
    ctx.res.end(buf);
  });

  r.post('/api/sites/:id/check', async (ctx) => {
    requireAgency(ctx);
    const site = getSite(ctx.db, Number(ctx.params.id));
    if (!site.domain) throw bad('Add a domain first');
    return checkSite(ctx.db, site);
  });

  // ----- analytics -----
  r.get('/api/sites/:id/analytics', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    const days = Math.min(365, Math.max(7, Number(ctx.query.get('days')) || 30));
    const since = `-${days - 1} days`;
    const daily = ctx.db.all("SELECT day, SUM(views) views FROM pageviews WHERE site_id = ? AND day >= date('now', ?) GROUP BY day ORDER BY day", site.id, since);
    const pages = ctx.db.all("SELECT path, SUM(views) views FROM pageviews WHERE site_id = ? AND day >= date('now', ?) GROUP BY path ORDER BY views DESC LIMIT 10", site.id, since);
    const refs = ctx.db.all("SELECT host, SUM(views) views FROM referrers WHERE site_id = ? AND day >= date('now', ?) GROUP BY host ORDER BY views DESC LIMIT 10", site.id, since);
    const leads = ctx.db.get("SELECT COUNT(*) n FROM submissions WHERE site_id = ? AND created_at >= datetime('now', ?)", site.id, since).n;
    const map = new Map(daily.map((d) => [d.day, d.views]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); series.push({ day: d, views: map.get(d) || 0 }); }
    const total = series.reduce((n, d) => n + d.views, 0);
    return { days, total, leads, conversion_pct: total ? Math.round((leads / total) * 1000) / 10 : 0, series, pages, referrers: refs };
  });

  // ----- form submissions (leads) -----
  r.get('/api/sites/:id/submissions', async (ctx) => {
    const site = siteAccess(ctx, Number(ctx.params.id));
    return ctx.db.all('SELECT * FROM submissions WHERE site_id = ? ORDER BY id DESC LIMIT 200', site.id).map((s) => ({ ...s, data: j(s.data, {}) }));
  });
  r.patch('/api/submissions/:id', async (ctx) => {
    const s = ctx.db.get('SELECT m.*, s.client_id FROM submissions m JOIN sites s ON s.id = m.site_id WHERE m.id = ?', Number(ctx.params.id));
    if (!s) throw notFound();
    assertClientAccess(ctx, s.client_id);
    const { status } = await ctx.body();
    if (!['new', 'read', 'replied', 'spam', 'archived'].includes(status)) throw bad('Invalid status');
    ctx.db.run('UPDATE submissions SET status = ? WHERE id = ?', status, s.id);
    return { ok: true };
  });
}
