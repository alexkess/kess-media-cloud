import { api, html, render, money, pill, ago, date, modal, field, toast, fail, confirmBox, isOwner } from '../lib.js';
import { activityLine } from './dashboard.js';

const clientForm = (c = {}) => html`${field('Business name', 'name', { value: c.name, required: true })}
  <div class="two">${field('Contact name', 'contact_name', { value: c.contact_name })}${field('Email', 'email', { type: 'email', value: c.email })}</div>
  <div class="two">${field('Phone', 'phone', { value: c.phone })}${field('ABN', 'abn', { value: c.abn })}</div>
  ${field('Address', 'address', { value: c.address })}
  ${field('Status', 'status', { type: 'select', value: c.status || 'active', options: [['lead', 'Lead'], ['active', 'Active'], ['paused', 'Paused'], ['past', 'Past client']] })}
  ${field('Internal notes', 'notes', { type: 'textarea', value: c.notes, hint: 'never shown to the client' })}`;

export async function list(el, _p, q) {
  const rows = await api('/api/clients');
  const filter = q.get('status');
  const shown = filter ? rows.filter((r) => r.status === filter) : rows;
  render(el, html`<div class="page-head"><div><h1>Clients</h1><p>${rows.filter((r) => r.status === 'active').length} active · ${rows.filter((r) => r.status === 'lead').length} leads</p></div>
    <div class="row"><select class="i" id="flt" style="width:auto">${[['', 'All'], ['active', 'Active'], ['lead', 'Leads'], ['paused', 'Paused'], ['past', 'Past']].map(([v, l]) => html`<option value="${v}" ${v === (filter || '') ? 'selected' : ''}>${l}</option>`)}</select><button class="btn primary" id="add">+ Add client</button></div></div>
    <div class="card table-wrap">${shown.length ? html`<table class="t"><thead><tr><th>Client</th><th>Status</th><th>Sites</th><th>Open requests</th><th class="n">Care plans / mo</th></tr></thead><tbody>
      ${shown.map((c) => html`<tr class="click" data-id="${c.id}"><td><strong>${c.name}</strong><div class="muted small">${c.contact_name || ''}${c.email ? ` · ${c.email}` : ''}</div></td><td>${pill(c.status)}</td><td>${c.site_count}</td><td>${c.open_requests || '—'}</td><td class="n">${c.mrr_cents ? money(c.mrr_cents) : '—'}</td></tr>`)}
      </tbody></table>` : html`<div class="empty"><h3>No clients yet</h3><p>Add your first client to start a site.</p></div>`}</div>`);
  el.querySelector('#flt').onchange = (e) => { location.hash = '#/clients' + (e.target.value ? `?status=${e.target.value}` : ''); };
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/clients/${tr.dataset.id}`; });
  el.querySelector('#add').onclick = async () => {
    const v = await modal({ title: 'Add client', body: clientForm(), submit: 'Add client' });
    if (!v) return;
    try { const c = await api('/api/clients', { method: 'POST', body: v }); location.hash = `#/clients/${c.id}`; } catch (e) { fail(e); }
  };
}

export async function detail(el, { id }) {
  const c = await api(`/api/clients/${id}`);
  render(el, html`<div class="crumbs"><a href="#/clients">Clients</a> /</div>
    <div class="page-head"><div><h1>${c.name}</h1><p>${pill(c.status)} ${c.contact_name ? ` · ${c.contact_name}` : ''}${c.email ? html` · <a href="mailto:${c.email}">${c.email}</a>` : ''}${c.phone ? ` · ${c.phone}` : ''}</p></div>
      <div class="row"><button class="btn" id="edit">Edit</button><a class="btn" href="#/requests?client=${c.id}&new=1">New request</a><a class="btn" href="#/invoices?client=${c.id}&new=1">New invoice</a><a class="btn primary" href="#/sites?new=1&client=${c.id}">+ New site</a></div></div>
    <div class="grid g-side">
      <div>
        <div class="card"><div class="card-head"><h2>Sites</h2></div>
          ${c.sites.length ? html`<table class="t"><tbody>${c.sites.map((s) => html`<tr class="click" onclick="location.hash='#/sites/${s.id}'"><td><strong>${s.name}</strong><div class="muted small">${s.domain || `/s/${s.slug}`}</div></td><td>${pill(s.stage)}</td><td class="muted small">${s.plan_name || 'No care plan'}</td><td class="n">${s.price_cents ? money(s.price_cents) + '/mo' : ''}</td></tr>`)}</tbody></table>` : html`<div class="empty">No sites yet.</div>`}</div>
        <div class="card"><div class="card-head"><h2>Invoices</h2><a class="small" href="#/invoices?client=${c.id}">All</a></div>
          ${c.invoices.length ? html`<table class="t"><tbody>${c.invoices.map((i) => html`<tr class="click" onclick="location.hash='#/invoices/${i.id}'"><td>${i.number}<div class="muted small">${date(i.issue_date)}</div></td><td>${pill(i.overdue ? 'overdue' : i.status)}</td><td class="n">${money(i.total_cents)}</td></tr>`)}</tbody></table>` : html`<div class="empty">No invoices.</div>`}</div>
        <div class="card"><div class="card-head"><h2>Activity</h2></div>${c.activity.length ? c.activity.map(activityLine) : html`<div class="empty">Nothing yet.</div>`}</div>
      </div>
      <div>
        <div class="card"><div class="card-head"><h2>Portal access</h2><button class="btn sm" id="invite">+ Invite</button></div>
          ${c.users.length ? c.users.map((u) => html`<div class="row between" style="padding:6px 0;border-bottom:1px solid #f1efea"><span><strong>${u.name}</strong><div class="muted small">${u.email}<br>${u.pending ? 'Invite not accepted yet' : u.last_login_at ? `Last signed in ${ago(u.last_login_at)}` : 'Never signed in'}</div></span>
            <span class="row"><button class="btn sm" data-reset="${u.id}">Link</button><button class="btn sm danger" data-del="${u.id}">✕</button></span></div>`) : html`<p class="muted">No one from ${c.name} can sign in yet. Invite them so they can approve versions, send requests, see enquiries and pay invoices.</p>`}</div>
        <div class="card"><h2>Details</h2><div class="stack small mt">
          ${c.abn ? html`<div><span class="muted">ABN</span><br>${c.abn}</div>` : ''}${c.address ? html`<div><span class="muted">Address</span><br>${c.address}</div>` : ''}
          <div><span class="muted">Client since</span><br>${date(c.created_at)}</div>
          ${c.notes ? html`<div class="callout warn"><strong>Internal notes</strong><div class="pre">${c.notes}</div></div>` : ''}
          ${isOwner() ? html`<button class="btn sm danger" id="del">Delete client</button>` : ''}</div></div>
      </div></div>`);

  el.querySelector('#edit').onclick = async () => {
    const v = await modal({ title: 'Edit client', body: clientForm(c) });
    if (!v) return;
    try { await api(`/api/clients/${id}`, { method: 'PATCH', body: v }); toast('Saved'); detail(el, { id }); } catch (e) { fail(e); }
  };
  el.querySelector('#invite').onclick = async () => {
    const v = await modal({ title: `Invite someone from ${c.name}`, body: html`${field('Name', 'name', { value: c.contact_name, required: true })}${field('Email', 'email', { type: 'email', value: c.email, required: true })}`, submit: 'Create invite' });
    if (!v) return;
    try { const r = await api(`/api/clients/${id}/users`, { method: 'POST', body: v }); await showLink(r.invite_url, v.name); detail(el, { id }); } catch (e) { fail(e); }
  };
  el.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => {
    try { const r = await api(`/api/users/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); await showLink(r.invite_url); } catch (e) { fail(e); }
  });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!await confirmBox('Remove access?', 'They will no longer be able to sign in.', 'Remove')) return;
    try { await api(`/api/users/${b.dataset.del}`, { method: 'DELETE' }); detail(el, { id }); } catch (e) { fail(e); }
  });
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!await confirmBox(`Delete ${c.name}?`, 'This deletes the client, their sites, requests, invoices and files. It cannot be undone.', 'Delete forever')) return;
    try { await api(`/api/clients/${id}`, { method: 'DELETE' }); location.hash = '#/clients'; } catch (e) { fail(e); }
  });
}

export async function showLink(url, name) {
  await modal({ title: 'Sign-in link ready', submit: '', cancel: 'Done', body: html`<p style="margin:0">Send this link${name ? ` to ${name}` : ''}. It works once and expires. They'll choose their own password.</p>
    <div class="row"><input class="i mono" readonly value="${url}" id="lnk"><button type="button" class="btn" id="cp">Copy</button></div>`,
    onOpen: (f) => { f.querySelector('#cp').onclick = () => { navigator.clipboard?.writeText(url); toast('Copied'); }; f.querySelector('#lnk').select(); } });
}
