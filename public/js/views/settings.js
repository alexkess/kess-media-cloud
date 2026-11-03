import { api, html, render, ago, modal, field, toast, fail, isAgency, isOwner, state, centsToDollars, dollarsToCents } from '../lib.js';
import { activityLine } from './dashboard.js';
import { showLink } from './clients.js';

export async function activity(el) {
  const rows = await api('/api/activity');
  render(el, html`<div class="page-head"><div><h1>Activity</h1><p>Everything that happened across clients and sites. Latest 200.</p></div></div><div class="card">${rows.map(activityLine)}</div>`);
}

export async function settings(el) {
  const owner = isOwner();
  const [s, team] = isAgency() ? await Promise.all([api('/api/settings'), api('/api/team')]) : [null, []];
  render(el, html`<div class="page-head"><div><h1>${isAgency() ? 'Settings' : 'Account'}</h1><p>${state.user.email}</p></div></div>
    <div class="grid g2">
      ${s ? html`<form class="card form" id="agency"><h2>Agency</h2>
        <div class="two">${field('Agency name', 'agency_name', { value: s.agency_name })}${field('ABN', 'agency_abn', { value: s.agency_abn })}</div>
        <div class="two">${field('Email', 'agency_email', { value: s.agency_email })}${field('Address', 'agency_address', { value: s.agency_address })}</div>
        <div class="two">${field('Invoice prefix', 'invoice_prefix', { value: s.invoice_prefix })}${field('Payment terms (days)', 'payment_terms_days', { type: 'number', value: s.payment_terms_days })}</div>
        <div class="two">${field('GST rate', 'gst_rate', { type: 'number', value: s.gst_rate, attrs: 'step="0.01" min="0" max="1"' })}${owner ? field('Internal hourly rate ($)', 'internal_rate', { type: 'number', value: centsToDollars(Number(s.internal_rate_cents)), hint: 'estimates only, never shown to clients' }) : ''}</div>
        ${field('Bank details for invoices', 'bank_details', { type: 'textarea', value: s.bank_details, placeholder: 'BSB 000-000\nAccount 12345678\nName: Kess Media' })}
        ${field('Public URL of this Kess Cloud', 'public_base_url', { value: s.public_base_url, placeholder: 'https://cloud.kess.media', hint: 'used for links, forms and analytics in exported sites' })}
        ${field('Team webhook (Slack, Make, Zapier)', 'webhook_url', { value: s.webhook_url, placeholder: 'https://hooks.slack.com/services/…', hint: 'agency notifications are posted here' })}
        ${owner ? html`<div class="row end"><button class="btn primary">Save</button></div>` : html`<p class="muted small">Only the owner can change agency settings.</p>`}</form>` : ''}
      <div>
        <form class="card form" id="pw"><h2>Change password</h2>${field('Current password', 'current', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}${field('New password', 'next', { type: 'password', required: true, hint: 'at least 10 characters', attrs: 'minlength="10" autocomplete="new-password"' })}<div class="row end"><button class="btn primary">Update password</button></div></form>
        ${isAgency() ? html`<div class="card"><div class="card-head"><h2>Team</h2>${owner ? html`<button class="btn sm" id="inv">+ Invite</button>` : ''}</div>
          ${team.map((u) => html`<div class="row between" style="padding:6px 0;border-bottom:1px solid #f1efea"><span><strong>${u.name}</strong> <span class="pill grey">${u.role}</span><div class="muted small">${u.email} · ${u.pending ? 'invite pending' : u.last_login_at ? `active ${ago(u.last_login_at)}` : 'never signed in'}</div></span>${owner && u.id !== state.user.id ? html`<button class="btn sm" data-reset="${u.id}">Link</button>` : ''}</div>`)}</div>` : ''}
      </div></div>`);
  el.querySelector('#agency')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    if ('internal_rate' in body) { body.internal_rate_cents = String(dollarsToCents(body.internal_rate) || 0); delete body.internal_rate; }
    try { const r = await api('/api/settings', { method: 'PATCH', body }); state.agencyName = r.agency_name; toast('Settings saved'); } catch (err) { fail(err); }
  });
  el.querySelector('#pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/auth/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); toast('Password updated'); e.target.reset(); } catch (err) { fail(err); }
  });
  el.querySelector('#inv')?.addEventListener('click', async () => {
    const v = await modal({ title: 'Invite a team member', submit: 'Create invite', body: html`${field('Name', 'name', { required: true })}${field('Email', 'email', { type: 'email', required: true })}${field('Role', 'role', { type: 'select', options: [['staff', 'Staff (no rates, no deletes)'], ['owner', 'Owner (full access)']] })}` });
    if (!v) return;
    try { const r = await api('/api/team', { method: 'POST', body: v }); await showLink(r.invite_url, v.name); settings(el); } catch (err) { fail(err); }
  });
  el.querySelectorAll('[data-reset]').forEach((b) => b.onclick = async () => { try { const r = await api(`/api/users/${b.dataset.reset}/reset`, { method: 'POST', body: {} }); await showLink(r.invite_url); } catch (err) { fail(err); } });
}
