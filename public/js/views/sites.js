import { api, html, raw, render, money, pill, ago, date, modal, field, toast, fail, confirmBox, isAgency, isOwner, state, bars, esc } from '../lib.js';

export async function list(el, _p, q) {
  const sites = await api('/api/sites');
  const stage = q.get('stage');
  const shown = stage ? sites.filter((s) => s.stage === stage) : sites.filter((s) => s.stage !== 'archived');
  const agency = isAgency();
  render(el, html`<div class="page-head"><div><h1>${agency ? 'Sites' : 'My websites'}</h1><p>${agency ? `${sites.length} sites across all clients` : 'Preview, approve and track your websites.'}</p></div>
    ${agency ? html`<div class="row"><select class="i" id="stage" style="width:auto"><option value="">All active</option>${state.meta.stages.map((s) => html`<option ${s === stage ? 'selected' : ''}>${s}</option>`)}</select><button class="btn primary" id="new">+ New site</button></div>` : ''}</div>
    <div class="card table-wrap">${shown.length ? html`<table class="t"><thead><tr><th>Site</th>${agency ? html`<th>Client</th>` : ''}<th>Stage</th><th>Live</th><th>Uptime 30d</th><th class="n">Views 30d</th><th class="n">New leads</th>${agency ? html`<th>Plan</th>` : ''}</tr></thead><tbody>
      ${shown.map((s) => html`<tr class="click" data-id="${s.id}"><td><strong>${s.name}</strong><div class="muted small">${s.domain || `/s/${s.slug}`}</div></td>${agency ? html`<td>${s.client_name}</td>` : ''}
        <td>${pill(s.stage)}${s.pending_reviews ? html` ${pill('pending', 'review')}` : ''}</td><td>${s.live_version ? `v${s.live_version}` : html`<span class="muted">not yet</span>`}</td>
        <td>${s.uptime?.uptime_pct != null ? html`<span class="dot ${s.uptime.last?.ok ? 'up' : 'down'}"></span> ${s.uptime.uptime_pct}%` : html`<span class="muted">—</span>`}</td>
        <td class="n">${s.views_30d.toLocaleString()}</td><td class="n">${s.new_leads || '—'}</td>${agency ? html`<td class="small">${s.plan_name || '—'}</td>` : ''}</tr>`)}
      </tbody></table>` : html`<div class="empty"><h3>No sites${stage ? ` in ${stage}` : ''}</h3>${agency ? html`<p>Start a new client website from a template.</p>` : ''}</div>`}</div>`);
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/sites/${tr.dataset.id}`; });
  if (!agency) return;
  el.querySelector('#stage').onchange = (e) => { location.hash = '#/sites' + (e.target.value ? `?stage=${e.target.value}` : ''); };
  el.querySelector('#new').onclick = () => newSite(q.get('client'));
  if (q.get('new')) newSite(q.get('client'));
}

async function newSite(clientId) {
  const [clients, plans] = await Promise.all([api('/api/clients'), api('/api/plans')]);
  if (!clients.length) { toast('Add a client first'); location.hash = '#/clients'; return; }
  const tpls = state.meta.templates;
  const v = await modal({ title: 'New client website', submit: 'Create site', wide: true, body: html`
    <div class="two">${field('Client', 'client_id', { type: 'select', value: clientId || '', options: clients.map((c) => [c.id, c.name]), required: true })}${field('Site name', 'name', { required: true, placeholder: 'e.g. Harbour Physio' })}</div>
    <label class="f">Starting template</label><div class="grid g2" style="gap:10px">${tpls.map((t, i) => html`<label class="theme-card ${i === 0 ? 'on' : ''}"><input type="radio" name="template" value="${t.key}" ${i === 0 ? 'checked' : ''} class="hide"><strong>${t.label}</strong><div class="muted small">${t.description}</div>
      <div class="sw">${Object.values(state.meta.presets[t.theme].colors).slice(0, 6).map((c) => html`<span style="background:${c}"></span>`)}</div></label>`)}</div>
    <div class="two">${field('Domain', 'domain', { placeholder: 'example.com.au', hint: 'optional, add later' })}${field('Care plan', 'plan_id', { type: 'select', options: [['', 'None yet'], ...plans.filter((p) => p.active).map((p) => [p.id, `${p.name} (${money(p.price_cents)}/mo)`])] })}</div>
    ${field('Stage', 'stage', { type: 'select', value: 'design', options: state.meta.stages.filter((s) => s !== 'archived') })}`,
    onOpen: (f) => f.querySelectorAll('.theme-card').forEach((c) => c.addEventListener('click', () => { f.querySelectorAll('.theme-card').forEach((x) => x.classList.remove('on')); c.classList.add('on'); })) });
  if (!v) { if (location.hash.includes('new=1')) history.replaceState(null, '', '#/sites'); return; }
  try {
    const s = await api('/api/sites', { method: 'POST', body: { ...v, client_id: Number(v.client_id), plan_id: v.plan_id ? Number(v.plan_id) : null } });
    toast('Site created from template');
    location.hash = `#/sites/${s.id}/pages`;
  } catch (e) { fail(e); }
}

const TABS_AGENCY = [['', 'Overview'], ['pages', 'Pages'], ['design', 'Design'], ['settings', 'Settings'], ['versions', 'Versions'], ['seo', 'SEO check'], ['analytics', 'Analytics'], ['report', 'Monthly report'], ['feedback', 'Feedback'], ['leads', 'Enquiries'], ['uptime', 'Uptime']];
const TABS_CLIENT = [['', 'Overview'], ['pages', 'Edit content'], ['feedback', 'Feedback'], ['versions', 'Versions'], ['analytics', 'Analytics'], ['report', 'Monthly report'], ['leads', 'Enquiries'], ['seo', 'Health'], ['uptime', 'Uptime']];

export async function detail(el, { id, tab = '', pageId }, query = new URLSearchParams()) {
  const site = await api(`/api/sites/${id}`);
  const agency = isAgency();
  let tabs = agency ? TABS_AGENCY : TABS_CLIENT;
  if (!agency && !site.client_can_edit) tabs = tabs.filter(([t]) => t !== 'pages');
  const pending = site.versions.filter((v) => v.status === 'pending').length;
  render(el, html`<div class="crumbs"><a href="#/sites">${agency ? 'Sites' : 'My websites'}</a> / ${agency ? html`<a href="#/clients/${site.client.id}">${site.client.name}</a> /` : ''}</div>
    <div class="page-head"><div><h1>${site.name}</h1><p>${pill(site.stage)} ${site.published_version_id ? html`· live <a href="${site.urls.domain || site.urls.hosted}" target="_blank" rel="noopener">${site.domain || `/s/${site.slug}/`} ↗</a>` : '· not published yet'}</p></div>
      <div class="row"><a class="btn" href="${site.urls.preview}" target="_blank" rel="noopener">Preview draft ↗</a><a class="btn" href="${site.urls.preview}?feedback=1" target="_blank" rel="noopener" title="Pin comments, highlight text or draw on the page">💬 Comment on draft ↗</a>${agency ? html`<button class="btn" id="review">Send for approval</button><button class="btn primary" id="publish">Publish now</button>` : ''}</div></div>
    <nav class="tabs">${tabs.map(([t, l]) => html`<a href="#/sites/${id}${t ? '/' + t : ''}" class="${t === tab ? 'on' : ''}">${l}${t === 'versions' && pending ? html`<span class="count">${pending}</span>` : ''}</a>`)}</nav>
    <div id="tab"></div>`);
  el.querySelector('#review')?.addEventListener('click', () => sendVersion(site, 'review', el));
  el.querySelector('#publish')?.addEventListener('click', () => sendVersion(site, 'publish', el));
  const t = el.querySelector('#tab');
  const views = { '': overview, pages: (t, s) => import('./editor.js').then((m) => m.default(t, s, pageId)), design, settings, versions, seo, analytics, report: (t, s) => report(t, s, query.get('month')), feedback: (t, s) => import('./feedback.js').then((m) => m.default(t, s)), leads, uptime };
  await (views[tab] || overview)(t, site);
}

async function sendVersion(site, mode, el) {
  const v = await modal({
    title: mode === 'publish' ? `Publish ${site.name}` : 'Send for client approval',
    submit: mode === 'publish' ? 'Publish live' : 'Send to client',
    body: html`<p class="muted" style="margin:0">${mode === 'publish' ? 'This snapshots the current draft as a new version and makes it live straight away.' : 'This snapshots the current draft. The client gets a notification to preview and approve it. Approving publishes it.'}</p>
      ${field('What changed?', 'note', { type: 'textarea', placeholder: 'e.g. New About page copy and team photos', hint: 'the client sees this' })}`,
  });
  if (!v) return;
  try {
    const r = await api(`/api/sites/${site.id}/versions`, { method: 'POST', body: { mode, note: v.note } });
    toast(mode === 'publish' ? `v${r.number} is live` : `v${r.number} sent to client`);
    location.hash = `#/sites/${site.id}/versions`;
    if (location.hash === `#/sites/${site.id}/versions`) detail(el, { id: site.id, tab: 'versions' });
  } catch (e) { fail(e); }
}

async function overview(t, site) {
  const agency = isAgency();
  const live = site.versions.find((v) => v.status === 'published');
  const pend = site.versions.filter((v) => v.status === 'pending');
  render(t, html`<div class="grid g-side"><div>
    ${pend.length && !agency ? html`<div class="callout dark" style="margin-bottom:16px"><h2>v${pend[0].number} is <em>ready for you.</em></h2><p>${pend[0].note || 'Have a look and approve it, or tell us what to change.'}</p><a class="btn mint" href="#/sites/${site.id}/versions">Review now</a></div>` : ''}
    <div class="card"><h2>Where it lives</h2><table class="t mt"><tbody>
      <tr><td class="muted">Hosted on Kess Cloud</td><td><a href="${site.urls.hosted}" target="_blank" rel="noopener">${site.urls.hosted}</a></td></tr>
      <tr><td class="muted">Custom domain</td><td>${site.domain ? html`<a href="https://${site.domain}" target="_blank" rel="noopener">${site.domain}</a>` : html`<span class="muted">Not set${agency ? html` · <a href="#/sites/${site.id}/settings">add one</a>` : ''}</span>`}</td></tr>
      <tr><td class="muted">Live version</td><td>${live ? html`v${live.number} · published ${ago(live.published_at)}` : 'Not published yet'}</td></tr>
      <tr><td class="muted">Draft</td><td>${site.pages.length} pages · last edited ${ago(site.updated_at)}</td></tr>
    </tbody></table>
    ${agency && site.domain ? html`<div class="callout mt small"><strong>DNS for ${site.domain}</strong><br>Point a CNAME (or ALIAS/A record at the apex) to this Kess Cloud server. Visitors to ${site.domain} get the live version, with sitemap.xml and robots.txt served automatically.</div>` : ''}</div>
    ${agency ? html`<div class="card"><div class="card-head"><h2>Build and export</h2></div>
      <p class="muted" style="margin-top:0">Download the site as an Astro + Sanity project, the Kess Media standard stack. It uses the same renderer as Kess Cloud, so what the client approved is what Astro builds. Forms keep posting to this portal.</p>
      <div class="row"><a class="btn" href="/api/sites/${site.id}/export">Export draft (.tar.gz)</a>${live ? html`<a class="btn" href="/api/sites/${site.id}/export?version=${live.number}">Export live v${live.number}</a>` : ''}<button class="btn" id="dup">Duplicate as new site</button></div>
      ${site.deploys.length ? html`<h3 class="mt">Deploy log</h3><table class="t small">${site.deploys.slice(0, 6).map((d) => html`<tr><td>${d.target}</td><td>${d.version ? `v${d.version}` : 'draft'}</td><td class="pre muted">${d.log}</td><td class="nowrap muted">${ago(d.created_at)}</td></tr>`)}</table>` : ''}</div>` : ''}
    </div><div>
    <div class="card"><h2>Health</h2><div class="stack mt">
      <div class="row between"><span class="muted">Uptime, 30 days</span><strong>${site.uptime.uptime_pct != null ? site.uptime.uptime_pct + '%' : '—'}</strong></div>
      <div class="row between"><span class="muted">Response time</span><strong>${site.uptime.avg_ms ? site.uptime.avg_ms + ' ms' : '—'}</strong></div>
      <div class="row between"><span class="muted">SSL certificate</span><strong>${site.uptime.last?.cert_expires ? `to ${date(site.uptime.last.cert_expires)}` : '—'}</strong></div>
      <a class="small" href="#/sites/${site.id}/seo">Run SEO and accessibility check →</a></div></div>
    <div class="card"><h2>Care plan</h2>${site.plan ? html`<p style="margin:8px 0 4px"><strong>${site.plan.name}</strong>${agency ? ` · ${money(site.plan.price_cents)}/mo ex GST` : ''}</p><ul class="small" style="padding-left:18px;margin:0">${site.plan.features.map((f) => html`<li>${f}</li>`)}</ul>` : html`<p class="muted">No care plan${agency ? html` · <a href="#/sites/${site.id}/settings">choose one</a>` : ''}</p>`}</div>
    ${agency ? html`<div class="card"><h2>Stage</h2><select class="i mt" id="stage">${state.meta.stages.map((s) => html`<option ${s === site.stage ? 'selected' : ''}>${s}</option>`)}</select><p class="muted small">The client is notified when the stage changes.</p></div>` : ''}
    </div></div>`);
  t.querySelector('#stage')?.addEventListener('change', async (e) => { try { await api(`/api/sites/${site.id}`, { method: 'PATCH', body: { stage: e.target.value } }); toast('Stage updated'); } catch (err) { fail(err); } });
  t.querySelector('#dup')?.addEventListener('click', async () => {
    const clients = await api('/api/clients');
    const v = await modal({ title: 'Duplicate site', submit: 'Duplicate', body: html`${field('New site name', 'name', { value: `${site.name} copy`, required: true })}${field('For client', 'client_id', { type: 'select', value: site.client.id, options: clients.map((c) => [c.id, c.name]) })}<p class="muted small" style="margin:0">Copies pages, design and settings. Not versions, leads or analytics. Handy for reusing a build as a template.</p>` });
    if (!v) return;
    try { const s = await api(`/api/sites/${site.id}/duplicate`, { method: 'POST', body: v }); location.hash = `#/sites/${s.id}`; } catch (e) { fail(e); }
  });
}

async function design(t, site) {
  const { presets } = state.meta;
  const { FONT_CHOICES } = await import('/shared/sections.js');
  let theme = structuredClone(site.theme);
  const draw = () => {
    render(t, html`<div class="grid g-side"><div class="card"><h2>Theme</h2>
      <div class="grid g4 mt" style="gap:10px">${Object.entries(presets).map(([k, p]) => html`<button type="button" class="theme-card ${theme.preset === k ? 'on' : ''}" data-preset="${k}"><strong>${p.label}</strong><div class="muted small">${p.fonts.body}${p.fonts.accent !== 'none' ? ' + ' + p.fonts.accent : ''}</div><div class="sw">${Object.values(p.colors).slice(0, 6).map((c) => html`<span style="background:${c}"></span>`)}</div></button>`)}</div>
      <h3 class="mt">Colours</h3><div class="grid g4 mt" style="gap:10px">${Object.entries(theme.colors).map(([k, c]) => html`<label class="f">${({ bg: 'Background', soft: 'Soft panels', text: 'Text', muted: 'Muted text', primary: 'Primary', accent: 'Accent', dark: 'Dark panels', onDark: 'Text on dark' })[k] || k}<span class="row"><input type="color" class="swatch" data-color="${k}" value="${c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c}"><span class="mono">${c}</span></span></label>`)}</div>
      <div class="grid g3 mt"><label class="f">Body font<select class="i" data-font="body">${FONT_CHOICES.body.map((f) => html`<option ${f === theme.fonts.body ? 'selected' : ''}>${f}</option>`)}</select></label>
        <label class="f">Accent font (italic headings)<select class="i" data-font="accent">${FONT_CHOICES.accent.map((f) => html`<option ${f === theme.fonts.accent ? 'selected' : ''}>${f}</option>`)}</select></label>
        <label class="f">Corner radius <span class="hint">${theme.radius}px</span><input type="range" min="0" max="24" value="${theme.radius}" data-radius></label></div>
      <div class="row end mt"><button class="btn" id="reset">Reset</button><button class="btn primary" id="save">Save design</button></div>
      <p class="muted small">Design changes update the draft. Send for approval or publish to put them live.</p></div>
      <div class="pv"><iframe id="pv" title="Preview" src="${site.urls.preview}"></iframe></div></div>`);
    t.querySelectorAll('[data-preset]').forEach((b) => b.onclick = () => { const p = presets[b.dataset.preset]; theme = { preset: b.dataset.preset, colors: { ...p.colors }, fonts: { ...p.fonts }, radius: p.radius }; draw(); });
    t.querySelectorAll('[data-color]').forEach((i) => i.oninput = () => { theme.colors[i.dataset.color] = i.value; i.nextElementSibling.textContent = i.value; });
    t.querySelectorAll('[data-font]').forEach((s) => s.onchange = () => { theme.fonts[s.dataset.font] = s.value; });
    t.querySelector('[data-radius]').oninput = (e) => { theme.radius = Number(e.target.value); e.target.previousElementSibling.textContent = theme.radius + 'px'; };
    t.querySelector('#reset').onclick = () => { theme = structuredClone(site.theme); draw(); };
    t.querySelector('#save').onclick = async () => { try { site.theme = (await api(`/api/sites/${site.id}`, { method: 'PATCH', body: { theme } })).theme; toast('Design saved'); t.querySelector('#pv').contentWindow.location.reload(); } catch (e) { fail(e); } };
  };
  draw();
}

async function settings(t, site) {
  const plans = await api('/api/plans');
  const s = site.settings;
  render(t, html`<form class="grid g2" id="f"><div class="card form"><h2>Site</h2>
      ${field('Site name', 'name', { value: site.name, required: true })}
      <div class="two">${field('URL slug', 'slug', { value: site.slug, hint: `/s/${site.slug}/` })}${field('Custom domain', 'domain', { value: site.domain || '', placeholder: 'example.com.au' })}</div>
      ${field('Care plan', 'plan_id', { type: 'select', value: site.plan_id || '', options: [['', 'None'], ...plans.map((p) => [p.id, `${p.name} (${money(p.price_cents)}/mo)${p.active ? '' : ' (retired)'}`])] })}
      ${field('Client can edit content in the portal', 'client_can_edit', { type: 'checkbox', value: site.client_can_edit })}
      ${field('Publish automatically when the client approves a version', 'autoPublishOnApproval', { type: 'checkbox', value: s.autoPublishOnApproval !== false })}
      ${isOwner() ? html`<div class="mt"><button type="button" class="btn sm danger" id="del">Delete site</button></div>` : ''}</div>
    <div class="card form"><h2>Search and contact</h2>
      ${field('Tagline', 'tagline', { value: s.tagline, hint: 'shown in the home page title' })}
      ${field('Default meta description', 'description', { type: 'textarea', value: s.description, hint: '120 to 160 characters' })}
      <div class="two">${field('Email', 'email', { value: s.email })}${field('Phone', 'phone', { value: s.phone })}</div>
      ${field('Address', 'address', { value: s.address })}
      <div class="two">${field('Logo URL', 'logo', { value: s.logo, hint: 'upload in Files' })}${field('Social share image URL', 'ogImage', { value: s.ogImage })}</div>
      <div class="two">${field('Language', 'lang', { value: s.lang || 'en-AU' })}${field('Schema.org type', 'schemaType', { type: 'select', value: s.schemaType || 'Organization', options: ['Organization', 'LocalBusiness', 'MedicalBusiness', 'ProfessionalService', 'NGO', 'Store', 'Restaurant', 'Person'] })}</div>
      <div class="row end"><button class="btn primary">Save settings</button></div></div></form>`);
  t.querySelector('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    const settings = Object.fromEntries(['tagline', 'description', 'email', 'phone', 'address', 'logo', 'ogImage', 'lang', 'schemaType'].map((k) => [k, f[k].value]));
    settings.autoPublishOnApproval = f.autoPublishOnApproval.checked;
    try {
      await api(`/api/sites/${site.id}`, { method: 'PATCH', body: { name: f.name.value, slug: f.slug.value, domain: f.domain.value, plan_id: f.plan_id.value || null, client_can_edit: f.client_can_edit.checked, settings } });
      toast('Settings saved');
    } catch (err) { fail(err); }
  };
  t.querySelector('#del')?.addEventListener('click', async () => {
    if (!await confirmBox(`Delete ${site.name}?`, 'The hosted site goes offline and all pages, versions, enquiries and analytics are deleted.', 'Delete site')) return;
    try { await api(`/api/sites/${site.id}`, { method: 'DELETE' }); location.hash = '#/sites'; } catch (e) { fail(e); }
  });
}

async function versions(t, site) {
  const agency = isAgency();
  const rows = site.versions;
  render(t, html`<div class="card table-wrap">${rows.length ? html`<table class="t"><thead><tr><th>Version</th><th>Status</th><th>Note</th><th>By</th><th></th></tr></thead><tbody>
    ${rows.map((v) => html`<tr><td><strong>v${v.number}</strong><div class="muted small">${date(v.created_at)}</div></td>
      <td>${pill(v.status, v.status === 'changes_requested' ? 'changes requested' : v.status === 'published' ? 'live' : v.status)}${v.review_note ? html`<div class="small muted pre" style="max-width:260px">“${v.review_note}” · ${v.reviewed_by_name}</div>` : ''}</td>
      <td class="small">${v.note || html`<span class="muted">—</span>`}</td><td class="small muted">${v.created_by_name || ''}</td>
      <td class="right"><div class="row end"><a class="btn sm" href="/preview/${site.id}/?v=${v.number}" target="_blank" rel="noopener">Preview ↗</a><a class="btn sm" href="/preview/${site.id}/?v=${v.number}&feedback=1" target="_blank" rel="noopener" title="Pin comments or draw on this version">💬</a>
        ${v.status === 'pending' ? html`<button class="btn sm primary" data-approve="${v.id}">Approve${!agency && site.settings.autoPublishOnApproval !== false ? ' and go live' : ''}</button><button class="btn sm" data-changes="${v.id}">Request changes</button>` : ''}
        ${agency && !['published', 'pending'].includes(v.status) ? html`<button class="btn sm" data-pub="${v.id}" data-n="${v.number}">${v.status === 'superseded' ? 'Roll back to this' : 'Publish'}</button>` : ''}
        ${agency ? html`<button class="btn sm ghost" data-restore="${v.id}" data-n="${v.number}" title="Load into draft">↺ Draft</button>` : ''}</div></td></tr>`)}
    </tbody></table>` : html`<div class="empty"><h3>No versions yet</h3><p>${agency ? 'Send the draft for approval or publish it to create the first version.' : 'Kess Media will send the first version for you to review.'}</p></div>`}</div>
    ${!agency && site.client_can_edit ? html`<div class="callout mt">Made content edits? <button class="btn sm primary" id="submit">Send my edits to Kess Media</button> They'll check and publish them.</div>` : ''}`);
  const reload = () => detail(document.getElementById('view'), { id: site.id, tab: 'versions' });
  t.querySelectorAll('[data-approve]').forEach((b) => b.onclick = async () => {
    const v = await modal({ title: 'Approve this version?', submit: 'Approve', body: html`<p class="muted" style="margin:0">${agency || site.settings.autoPublishOnApproval !== false ? 'It goes live straight away.' : 'Kess Media will publish it.'}</p>${field('Comment', 'note', { type: 'textarea', placeholder: 'optional' })}` });
    if (!v) return;
    try { const r = await api(`/api/sites/${site.id}/versions/${b.dataset.approve}/approve`, { method: 'POST', body: v }); toast(r.published ? 'Approved and live' : 'Approved'); reload(); } catch (e) { fail(e); }
  });
  t.querySelectorAll('[data-changes]').forEach((b) => b.onclick = async () => {
    const v = await modal({ title: 'What should change?', submit: 'Send feedback', body: field('Your feedback', 'note', { type: 'textarea', rows: 6, required: true, placeholder: 'Page, section and what to change. The more specific the better.' }) });
    if (!v) return;
    try { const r = await api(`/api/sites/${site.id}/versions/${b.dataset.changes}/request-changes`, { method: 'POST', body: v }); toast('Feedback sent'); if (r.request_id) location.hash = `#/requests/${r.request_id}`; else reload(); } catch (e) { fail(e); }
  });
  t.querySelectorAll('[data-pub]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox(`Publish v${b.dataset.n}?`, 'This replaces the live site with this version.', 'Publish')) return;
    try { await api(`/api/sites/${site.id}/versions/${b.dataset.pub}/publish`, { method: 'POST', body: {} }); toast(`v${b.dataset.n} is live`); reload(); } catch (e) { fail(e); }
  });
  t.querySelectorAll('[data-restore]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox(`Load v${b.dataset.n} into the draft?`, 'This replaces the current draft pages, design and settings. The live site is not affected.', 'Replace draft')) return;
    try { await api(`/api/sites/${site.id}/versions/${b.dataset.restore}/restore`, { method: 'POST', body: {} }); toast('Draft restored'); } catch (e) { fail(e); }
  });
  t.querySelector('#submit')?.addEventListener('click', async () => {
    const v = await modal({ title: 'Send your edits', submit: 'Send', body: field('What did you change?', 'note', { type: 'textarea', required: true }) });
    if (!v) return;
    try { await api(`/api/sites/${site.id}/versions`, { method: 'POST', body: { mode: 'review', note: v.note } }); toast('Sent to Kess Media'); reload(); } catch (e) { fail(e); }
  });
}

async function seo(t, site) {
  const a = await api(`/api/sites/${site.id}/audit`);
  const icon = { error: '●', warn: '▲', info: '○' };
  const color = { error: 'var(--danger)', warn: 'var(--warn)', info: 'var(--muted)' };
  const issue = (i) => html`<div class="issue"><span style="color:${color[i.level]}">${icon[i.level]}</span><span>${i.msg}</span></div>`;
  render(t, html`<div class="grid g-side"><div>${a.pages.map((p) => html`<div class="card"><div class="card-head"><h2>${p.title} <span class="muted small mono">/${p.slug}</span></h2><span class="score" style="font-size:22px;color:${p.score >= 85 ? 'var(--forest)' : p.score >= 60 ? 'var(--warn)' : 'var(--danger)'}">${p.score}</span></div>
      ${p.issues.length ? p.issues.map(issue) : html`<p class="muted" style="margin:0">No issues found.</p>`}</div>`)}</div>
    <div><div class="card"><h2>Overall</h2><div class="score" style="color:${a.score >= 85 ? 'var(--forest)' : 'var(--warn)'}">${a.score}<span style="font-size:16px">/100</span></div><p class="muted small">Checks titles, meta descriptions, headings, image alt text, links and content depth on the current draft.</p>
      ${a.site.map(issue)}</div></div></div>`);
}

async function analytics(t, site, days = 30) {
  const a = await api(`/api/sites/${site.id}/analytics?days=${days}`);
  const maxP = Math.max(1, ...a.pages.map((p) => p.views)), maxR = Math.max(1, ...a.referrers.map((p) => p.views));
  render(t, html`<div class="row between" style="margin-bottom:12px"><span class="muted small">Privacy-friendly: no cookies, no personal data, no consent banner needed.</span>
      <select class="i" id="days" style="width:auto">${[7, 30, 90, 365].map((d) => html`<option value="${d}" ${d === days ? 'selected' : ''}>Last ${d} days</option>`)}</select></div>
    <div class="grid g3"><div class="stat"><div class="k">Page views</div><div class="v">${a.total.toLocaleString()}</div></div><div class="stat"><div class="k">Enquiries</div><div class="v">${a.leads}</div></div><div class="stat"><div class="k">Enquiry rate</div><div class="v">${a.conversion_pct}%</div><div class="s">enquiries per 100 views</div></div></div>
    <div class="card mt"><h2>Views per day</h2>${bars(a.series)}<div class="row between small muted"><span>${date(a.series[0]?.day)}</span><span>${date(a.series.at(-1)?.day)}</span></div></div>
    <div class="grid g2 mt"><div class="card"><h2>Top pages</h2><div class="hbar mt">${a.pages.length ? a.pages.map((p) => html`<span class="mono">${p.path}</span><strong>${p.views}</strong><div class="b"><span style="width:${(p.views / maxP) * 100}%"></span></div>`) : html`<span class="muted">No data yet</span>`}</div></div>
      <div class="card"><h2>Where visitors come from</h2><div class="hbar mt">${a.referrers.length ? a.referrers.map((p) => html`<span>${p.host}</span><strong>${p.views}</strong><div class="b"><span style="width:${(p.views / maxR) * 100}%"></span></div>`) : html`<span class="muted">Mostly direct visits</span>`}</div></div></div>`);
  t.querySelector('#days').onchange = (e) => analytics(t, site, Number(e.target.value));
}

async function leads(t, site) {
  const rows = await api(`/api/sites/${site.id}/submissions`);
  const draw = (filter = 'inbox') => {
    const shown = rows.filter((r) => (filter === 'inbox' ? !['spam', 'archived'].includes(r.status) : r.status === filter));
    render(t, html`<div class="row" style="margin-bottom:12px">${[['inbox', 'Inbox'], ['archived', 'Archived'], ['spam', 'Spam']].map(([k, l]) => html`<button class="btn sm ${k === filter ? 'primary' : ''}" data-f="${k}">${l}</button>`)}<a class="btn sm ghost" id="csv" href="#">Download CSV</a></div>
      ${shown.length ? shown.map((r) => html`<div class="card"><div class="card-head"><div><strong>${r.data.name || r.data.email}</strong> ${pill(r.status)}<div class="muted small"><a href="mailto:${r.data.email}">${r.data.email}</a>${r.data.phone ? ` · ${r.data.phone}` : ''} · ${ago(r.created_at)}${r.page_slug ? ` · from /${r.page_slug}` : ''}</div></div>
        <div class="row"><a class="btn sm primary" href="mailto:${r.data.email}?subject=${encodeURIComponent('Re: your enquiry to ' + site.name)}" data-replied="${r.id}">Reply</a>${r.status === 'new' ? html`<button class="btn sm" data-s="read" data-id="${r.id}">Mark read</button>` : ''}<button class="btn sm ghost" data-s="${r.status === 'archived' ? 'read' : 'archived'}" data-id="${r.id}">${r.status === 'archived' ? 'Unarchive' : 'Archive'}</button>${r.status !== 'spam' ? html`<button class="btn sm ghost" data-s="spam" data-id="${r.id}">Spam</button>` : ''}</div></div>
        <div class="pre">${r.data.message}</div>${Object.entries(r.data).filter(([k]) => !['name', 'email', 'phone', 'message'].includes(k)).map(([k, v]) => html`<div class="small"><span class="muted">${k}:</span> ${v}</div>`)}</div>`) : html`<div class="card empty"><h3>No enquiries ${filter === 'inbox' ? 'yet' : 'here'}</h3><p>Messages from the website contact form land here, and you get a notification.</p></div>`}`);
    t.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => draw(b.dataset.f));
    t.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { try { await api(`/api/submissions/${b.dataset.id}`, { method: 'PATCH', body: { status: b.dataset.s } }); rows.find((r) => r.id == b.dataset.id).status = b.dataset.s; draw(filter); } catch (e) { fail(e); } });
    t.querySelectorAll('[data-replied]').forEach((a) => a.addEventListener('click', () => { api(`/api/submissions/${a.dataset.replied}`, { method: 'PATCH', body: { status: 'replied' } }); }));
    t.querySelector('#csv').onclick = (e) => {
      e.preventDefault();
      const cols = ['created_at', 'status', 'name', 'email', 'phone', 'message'];
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => q(c in r ? r[c] : r.data[c])).join(','))].join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `${site.slug}-enquiries.csv`; a.click();
    };
  };
  draw();
}

async function uptime(t, site) {
  const checks = [...site.checks].reverse();
  render(t, html`<div class="grid g3"><div class="stat"><div class="k">Uptime, 30 days</div><div class="v">${site.uptime.uptime_pct != null ? site.uptime.uptime_pct + '%' : '—'}</div><div class="s">${site.uptime.checks} checks</div></div>
    <div class="stat"><div class="k">Average response</div><div class="v">${site.uptime.avg_ms ? site.uptime.avg_ms + ' ms' : '—'}</div></div>
    <div class="stat"><div class="k">SSL expires</div><div class="v" style="font-size:20px">${site.uptime.last?.cert_expires ? date(site.uptime.last.cert_expires) : '—'}</div></div></div>
    <div class="card mt"><div class="card-head"><h2>Recent checks</h2>${isAgency() && site.domain ? html`<button class="btn sm" id="chk">Check now</button>` : ''}</div>
      ${site.domain ? html`<div class="uptime">${checks.length ? checks.map((c) => html`<span class="${c.ok ? '' : 'd'}" title="${date(c.created_at)} ${c.ok ? c.ms + 'ms' : c.error}"></span>`) : Array.from({ length: 48 }, () => html`<span class="n"></span>`)}</div>
        <p class="muted small">Kess Cloud checks ${site.domain} every 5 minutes and alerts the team if it goes down or the SSL certificate is close to expiring.</p>
        ${checks.length ? html`<table class="t small mt">${site.checks.slice(0, 10).map((c) => html`<tr><td>${c.ok ? html`<span class="dot up"></span> up` : html`<span class="dot down"></span> down`}</td><td>${c.status_code || ''}</td><td>${c.ok ? c.ms + ' ms' : c.error}</td><td class="muted">${ago(c.created_at)}</td></tr>`)}</table>` : ''}`
        : html`<div class="empty">Monitoring starts once the site has a custom domain.</div>`}</div>`);
  t.querySelector('#chk')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api(`/api/sites/${site.id}/check`, { method: 'POST', body: {} }); toast(r.ok ? `Up · ${r.ms} ms` : `Down · ${r.error}`, !r.ok); detail(document.getElementById('view'), { id: site.id, tab: 'uptime' }); } catch (err) { fail(err); e.target.disabled = false; }
  });
}

async function report(t, site, month) {
  const months = [];
  const d = new Date();
  for (let i = 0; i < 13; i++) { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)); months.push(x.toISOString().slice(0, 7)); }
  const m = month && months.includes(month) ? month : months[1];
  const src = `/reports/sites/${site.id}?month=${m}`;
  render(t, html`<div class="row between" style="margin-bottom:12px"><span class="muted small">Traffic, enquiries, uptime and work done. ${isAgency() ? 'Clients get a link to this on the 1st of each month.' : 'We send you a link to this on the 1st of each month.'}</span>
    <span class="row"><select class="i" id="m" style="width:auto">${months.map((x) => html`<option value="${x}" ${x === m ? 'selected' : ''}>${new Date(x + '-01T00:00:00Z').toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' })}${x === months[0] ? ' (so far)' : ''}</option>`)}</select>
    <a class="btn" href="${src}" target="_blank" rel="noopener">Open / PDF ↗</a></span></div>
    <iframe title="Monthly report" src="${src}" style="width:100%;height:calc(100vh - 230px);border:1px solid var(--line);border-radius:10px;background:#fff"></iframe>`);
  t.querySelector('#m').onchange = (e) => { location.hash = `#/sites/${site.id}/report?month=${e.target.value}`; };
}
