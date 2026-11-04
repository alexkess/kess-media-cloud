import { api, html, render, money, pill, ago, date, state, isAgency } from '../lib.js';

const ACTION_LABEL = {
  'site.created': 'created site', 'site.published': 'published', 'site.stage': 'moved stage', 'version.sent_for_review': 'sent for review',
  'version.approved': 'approved', 'version.changes_requested': 'requested changes', 'version.client_submitted': 'submitted edits',
  'request.created': 'opened request', 'request.updated': 'updated request', 'invoice.created': 'created invoice', 'invoice.sent': 'sent invoice',
  'invoice.paid': 'marked paid', 'invoice.generated': 'generated care invoice', 'lead.received': 'new enquiry', 'client.created': 'added client',
  'page.client_edit': 'edited page', 'feedback.created': 'left feedback', 'review_link.created': 'shared a review link', 'user.invited': 'invited user', 'draft.restored': 'restored draft', 'site.duplicated': 'duplicated site',
};
export const activityLine = (a) => html`<div class="row" style="padding:6px 0;border-bottom:1px solid #f1efea;align-items:baseline"><span style="flex:1"><strong>${a.user_name || 'Website'}</strong> ${ACTION_LABEL[a.action] || a.action}${a.detail ? html` · <span class="muted">${a.detail}</span>` : ''}${a.client_name ? html` <span class="muted small">(${a.client_name})</span>` : ''}</span><span class="muted small nowrap">${ago(a.created_at)}</span></div>`;

export default async function dashboard(el) {
  const d = await api('/api/dashboard');
  if (d.kind === 'client') return clientDash(el, d);
  const stages = Object.fromEntries(d.pipeline.map((p) => [p.stage, p.n]));
  const pipe = ['lead', 'proposal', 'design', 'build', 'review', 'live', 'care'];
  render(el, html`<div class="page-head"><div><h1>Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, <em>${state.user.name.split(' ')[0]}.</em></h1><p>What needs attention across ${state.agencyName} today.</p></div>
    <div class="row"><a class="btn" href="#/estimates">New estimate</a><a class="btn primary" href="#/sites?new=1">+ New client site</a></div></div>
    <div class="grid g4">
      <a class="stat dark" href="#/plans"><div class="k">Recurring revenue</div><div class="v">${money(d.mrr_cents)}<span style="font-size:14px">/mo</span></div><div class="s">${d.care_sites} sites on care plans · ex GST</div></a>
      <a class="stat" href="#/invoices?status=sent"><div class="k">Outstanding</div><div class="v">${money(d.outstanding_cents)}</div><div class="s">${d.overdue.length ? html`<span style="color:var(--danger)">${d.overdue.length} overdue</span>` : 'Nothing overdue'} · paid 30d ${money(d.paid_30d_cents)}</div></a>
      <a class="stat" href="#/requests"><div class="k">Open requests</div><div class="v">${d.open_requests}</div><div class="s">${d.hot_requests} high priority</div></a>
      <div class="stat"><div class="k">Client sites, last 30 days</div><div class="v">${d.views_30d.toLocaleString()}</div><div class="s">page views · ${d.leads_7d} enquiries this week</div></div>
    </div>
    ${d.down.length ? html`<div class="callout warn mt"><strong>Down right now:</strong> ${d.down.map((s) => html`<a href="#/sites/${s.id}/uptime">${s.name}</a> (${s.error}) `)}</div>` : ''}
    <div class="card mt"><div class="card-head"><h2>Pipeline</h2><a class="small" href="#/sites">All sites</a></div>
      <div class="row" style="gap:6px;flex-wrap:nowrap;overflow-x:auto">${pipe.map((s) => html`<a href="#/sites?stage=${s}" class="stat" style="flex:1;min-width:96px;padding:10px 12px;box-shadow:none"><div class="k" style="text-transform:capitalize">${s}</div><div class="v" style="font-size:22px">${stages[s] || 0}</div></a>`)}</div></div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Requests to action</h2><a class="small" href="#/requests">Board</a></div>
        ${d.requests.length ? html`<table class="t">${d.requests.map((r) => html`<tr class="click" onclick="location.hash='#/requests/${r.id}'"><td><strong>${r.title}</strong><div class="muted small">${r.client_name} · ${ago(r.updated_at)}</div></td><td class="right">${pill(r.priority)} ${pill(r.status)}</td></tr>`)}</table>` : html`<div class="empty">All clear.</div>`}</div>
      <div class="card"><div class="card-head"><h2>Waiting on approval</h2></div>
        ${d.pending.length ? html`<table class="t">${d.pending.map((v) => html`<tr class="click" onclick="location.hash='#/sites/${v.site_id}/versions'"><td><strong>${v.site_name}</strong> v${v.number}<div class="muted small">${v.creator_role === 'client' ? 'Client edits: you review' : 'Sent to client'} · ${ago(v.created_at)}</div></td><td class="right">${pill('pending', v.creator_role === 'client' ? 'needs review' : 'with client')}</td></tr>`)}</table>` : html`<div class="empty">No versions waiting.</div>`}
        ${d.overdue.length ? html`<h3 class="mt">Overdue invoices</h3><table class="t">${d.overdue.map((i) => html`<tr class="click" onclick="location.hash='#/invoices/${i.id}'"><td>${i.number} · ${i.client_name}<div class="muted small">due ${date(i.due_date)}</div></td><td class="n">${money(i.total_cents)}</td></tr>`)}</table>` : ''}</div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Recent activity</h2><a class="small" href="#/activity">All</a></div>${d.activity.map(activityLine)}</div>`);
}

function clientDash(el, d) {
  render(el, html`<div class="page-head"><div><h1>Hi ${state.user.name.split(' ')[0]}, <em>welcome back.</em></h1><p>Your websites, requests and invoices with ${state.agencyName}.</p></div>
    <a class="btn primary" href="#/requests?new=1">+ Ask for a change</a></div>
    ${d.pending.length ? html`<div class="callout dark" style="margin-bottom:16px"><h2>${d.pending.length === 1 ? 'A new version is' : `${d.pending.length} new versions are`} <em>ready for you.</em></h2>
      ${d.pending.map((v) => html`<div class="row between mt"><span><strong>${v.site_name}</strong> v${v.number}${v.note ? html` · ${v.note}` : ''}</span><a class="btn mint" href="#/sites/${v.site_id}/versions">Review and approve</a></div>`)}</div>` : ''}
    <div class="grid g4">
      <div class="stat"><div class="k">Visitors, last 30 days</div><div class="v">${d.views_30d.toLocaleString()}</div><div class="s">page views across your sites</div></div>
      <a class="stat" href="#/sites"><div class="k">New enquiries</div><div class="v">${d.new_leads}</div><div class="s">from your contact forms</div></a>
      <a class="stat" href="#/requests"><div class="k">Open requests</div><div class="v">${d.requests.length}</div><div class="s">${d.requests.filter((r) => r.quote_status === 'pending').length} quotes to review</div></a>
      <a class="stat" href="#/invoices"><div class="k">To pay</div><div class="v">${money(d.unpaid.reduce((n, i) => n + i.total_cents, 0))}</div><div class="s">${d.unpaid.length} invoice${d.unpaid.length === 1 ? '' : 's'} inc GST</div></a>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Your websites</h2></div>
        ${d.sites.length ? html`<table class="t">${d.sites.map((s) => html`<tr class="click" onclick="location.hash='#/sites/${s.id}'"><td><strong>${s.name}</strong><div class="muted small">${s.domain || 'No domain yet'}</div></td><td class="right">${pill(s.stage)}</td></tr>`)}</table>` : html`<div class="empty">No sites yet.</div>`}</div>
      <div class="card"><div class="card-head"><h2>Requests</h2><a class="small" href="#/requests">All</a></div>
        ${d.requests.length ? html`<table class="t">${d.requests.map((r) => html`<tr class="click" onclick="location.hash='#/requests/${r.id}'"><td><strong>${r.title}</strong><div class="muted small">${ago(r.updated_at)}</div></td><td class="right">${r.quote_status === 'pending' ? pill('quoted', 'quote to review') : pill(r.status)}</td></tr>`)}</table>` : html`<div class="empty">Nothing open. Need something changed? <a href="#/requests?new=1">Send a request</a>.</div>`}</div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Recent updates</h2></div>${d.activity.length ? d.activity.map(activityLine) : html`<div class="empty">No updates yet.</div>`}</div>`);
}
