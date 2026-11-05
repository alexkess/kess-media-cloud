import { api, state, html, raw, render, isAgency, ago, LOGO_SVG, fail } from './lib.js';

const ROUTES = [
  ['/login', () => import('./views/auth.js').then((m) => m.login), { bare: true }],
  ['/invite/:token', () => import('./views/auth.js').then((m) => m.invite), { bare: true }],
  ['/', () => import('./views/dashboard.js').then((m) => m.default)],
  ['/clients', () => import('./views/clients.js').then((m) => m.list), { agency: true }],
  ['/clients/:id', () => import('./views/clients.js').then((m) => m.detail), { agency: true }],
  ['/sites', () => import('./views/sites.js').then((m) => m.list)],
  ['/sites/:id', () => import('./views/sites.js').then((m) => m.detail)],
  ['/sites/:id/:tab', () => import('./views/sites.js').then((m) => m.detail)],
  ['/sites/:id/:tab/:pageId', () => import('./views/sites.js').then((m) => m.detail)],
  ['/requests', () => import('./views/requests.js').then((m) => m.list)],
  ['/requests/:id', () => import('./views/requests.js').then((m) => m.detail)],
  ['/invoices', () => import('./views/billing.js').then((m) => m.invoices)],
  ['/invoices/:id', () => import('./views/billing.js').then((m) => m.invoice)],
  ['/plans', () => import('./views/billing.js').then((m) => m.plans)],
  ['/estimates', () => import('./views/estimates.js').then((m) => m.list), { agency: true }],
  ['/estimates/:id', () => import('./views/estimates.js').then((m) => m.detail), { agency: true }],
  ['/studio', () => import('./views/studio.js').then((m) => m.overview), { agency: true }],
  ['/studio/calendar', () => import('./views/studio.js').then((m) => m.calendar), { agency: true }],
  ['/studio/setup', () => import('./views/studio-setup.js').then((m) => m.default), { agency: true }],
  ['/studio/jobs/:id', () => import('./views/job.js').then((m) => m.default), { agency: true }],
  ['/socials', () => import('./views/socials.js').then((m) => m.roster), { agency: true }],
  ['/socials/ledger', () => import('./views/socials.js').then((m) => m.ledger), { agency: true }],
  ['/files', () => import('./views/files.js').then((m) => m.default)],
  ['/activity', () => import('./views/settings.js').then((m) => m.activity), { agency: true }],
  ['/settings', () => import('./views/settings.js').then((m) => m.settings)],
];

function matchRoute(path) {
  for (const [pattern, load, opts = {}] of ROUTES) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    const m = re.exec(path);
    if (m) return { load, opts, params: Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}

function navItems() {
  if (isAgency()) return [
    ['/', 'Dashboard', '◧'], ['/clients', 'Clients', '◎'], ['/sites', 'Sites', '▦'], ['/requests', 'Requests', '✎'],
    ['sep', 'Social'], ['/socials', 'Socials', '✺'],
    ['sep', 'Photo + video'], ['/studio', 'Shoots', '◉'], ['/studio/calendar', 'Calendar', '▤'], ['/studio/setup', 'Studio setup', '✦'],
    ['sep', 'Money'], ['/invoices', 'Invoices', '$'], ['/plans', 'Care plans', '♡'], ['/estimates', 'Estimates', '≈'],
    ['sep', 'Studio'], ['/files', 'Files', '⬒'], ['/activity', 'Activity', '↻'], ['/settings', 'Settings', '⚙'],
  ];
  return [['/', 'Overview', '◧'], ['/sites', 'My websites', '▦'], ['/requests', 'Requests', '✎'], ['/invoices', 'Invoices', '$'], ['/files', 'Files', '⬒'], ['/settings', 'Account', '⚙']];
}

function shell() {
  const app = document.getElementById('app');
  const u = state.user;
  render(app, html`<div class="shell">
    <aside class="side" id="side">
      <a class="logo" href="#/">${raw(LOGO_SVG)}<span>KESS <small>Cloud</small></span></a>
      <nav class="nav" id="nav">${navItems().map(([p, l, ic]) => p === 'sep' ? html`<div class="sep">${l}</div>` : html`<a href="#${p}" data-path="${p}"><span aria-hidden="true">${ic}</span>${l}</a>`)}</nav>
      <div class="who"><strong>${u.name}</strong>${u.role === 'client' ? state.client?.name || 'Client' : `${state.agencyName} · ${u.role}`}<br><a href="#" id="logout" style="color:#7BBF9A">Sign out</a></div>
    </aside>
    <div class="main">
      <div class="top"><button class="btn ghost menu" id="menu" aria-label="Menu">☰</button>
        ${isAgency() ? html`<a class="btn sm" href="#/sites?new=1">+ New site</a>` : html`<a class="btn sm primary" href="#/requests?new=1">+ New request</a>`}
        <button class="btn ghost bell" id="bell" aria-label="Notifications">🔔<span class="badge hide" id="badge"></span></button></div>
      <div id="drop" class="drop hide"></div>
      <div class="content" id="view"></div>
    </div></div>`);
  document.getElementById('logout').onclick = async (e) => { e.preventDefault(); await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; location.hash = '#/login'; };
  document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
  document.getElementById('bell').onclick = toggleNotifications;
  document.addEventListener('click', (e) => {
    const d = document.getElementById('drop');
    if (d && !d.classList.contains('hide') && !d.contains(e.target) && !e.target.closest('#bell')) d.classList.add('hide');
  });
  pollNotifications();
}

let notifTimer;
async function pollNotifications() {
  clearTimeout(notifTimer);
  try {
    const n = await api('/api/notifications');
    const b = document.getElementById('badge');
    if (b) { b.textContent = n.unread; b.classList.toggle('hide', !n.unread); }
    state.notifications = n;
  } catch {}
  notifTimer = setTimeout(pollNotifications, 45000);
}
async function toggleNotifications() {
  const d = document.getElementById('drop');
  if (!d.classList.contains('hide')) return d.classList.add('hide');
  await pollNotifications();
  const n = state.notifications || { items: [] };
  render(d, html`<div class="row between" style="padding:10px 14px;border-bottom:1px solid #eee"><strong>Notifications</strong>${n.unread ? html`<button class="btn sm ghost" id="readall">Mark all read</button>` : ''}</div>
    ${n.items.length ? n.items.map((i) => html`<a class="it ${i.read ? '' : 'unread'}" href="${i.link || '#/'}" data-id="${i.id}"><div>${i.title}</div>${i.body ? html`<div class="b">${i.body}</div>` : ''}<div class="b">${ago(i.created_at)}</div></a>`) : html`<div class="empty">Nothing yet.</div>`}`);
  d.classList.remove('hide');
  d.querySelectorAll('a.it').forEach((a) => a.addEventListener('click', () => { api('/api/notifications/read', { method: 'POST', body: { id: a.dataset.id } }).then(pollNotifications); d.classList.add('hide'); }));
  d.querySelector('#readall')?.addEventListener('click', async () => { await api('/api/notifications/read', { method: 'POST', body: {} }); d.classList.add('hide'); pollNotifications(); });
}

let renderSeq = 0;
async function route() {
  const hash = location.hash.slice(1) || '/';
  const [path, qs] = hash.split('?');
  const query = new URLSearchParams(qs || '');
  const r = matchRoute(path);
  if (!state.user && !r?.opts.bare) { location.hash = '#/login'; return; }
  if (!r) { location.hash = '#/'; return; }
  if (r.opts.agency && !isAgency()) { location.hash = '#/'; return; }
  const seq = ++renderSeq;
  let el;
  if (r.opts.bare) { el = document.getElementById('app'); state.shell = false; }
  else {
    if (!state.shell) { shell(); state.shell = true; }
    el = document.getElementById('view');
    const links = [...document.querySelectorAll('#nav a')];
    const best = links.map((a) => a.dataset.path).filter((p) => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/'))).sort((a, b) => b.length - a.length)[0];
    links.forEach((a) => a.classList.toggle('on', a.dataset.path === best));
    document.getElementById('side')?.classList.remove('open');
  }
  try {
    const view = await r.load();
    if (seq !== renderSeq) return;
    await view(el, r.params, query);
    if (!r.opts.bare) window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e.status === 401) return;
    render(el, html`<div class="card empty"><h3>Could not load this page</h3><p>${e.message}</p><a class="btn" href="#/">Back to dashboard</a></div>`);
  }
}
export const refresh = () => route();

async function loadMe() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user; state.client = me.client; state.agencyName = me.agency_name || 'Kess Media';
    if (state.user) state.meta = await api('/api/templates');
  } catch (e) { fail(e); }
  document.title = `${state.agencyName} Cloud`;
}
export async function afterLogin(next = '#/') {
  state.shell = false;
  await loadMe();
  if (location.hash === next) route(); else location.hash = next;
}
window.addEventListener('hashchange', () => { if (location.hash.startsWith('#/login')) state.shell = false; route(); });
loadMe().then(route);
