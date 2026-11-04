import { api, html, raw, render, ago, date, modal, field, toast, fail, isAgency, isOwner, state, centsToDollars, dollarsToCents, pill } from '../lib.js';
import { activityLine } from './dashboard.js';
import { showLink } from './clients.js';

export async function activity(el) {
  const rows = await api('/api/activity');
  render(el, html`<div class="page-head"><div><h1>Activity</h1><p>Everything that happened across clients and sites. Latest 200.</p></div></div><div class="card">${rows.map(activityLine)}</div>`);
}

const kb = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// QR code for authenticator setup, drawn by the bundled qrcode-generator (MIT); falls back to the text key.
async function qrSvg(text) {
  try {
    if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
  } catch { return ''; }
}

export async function settings(el) {
  const owner = isOwner();
  const me = (await api('/api/auth/me')).user;
  const [s, team, integ, outbox, backups] = isAgency()
    ? await Promise.all([api('/api/settings'), api('/api/team'), owner ? api('/api/integrations') : null, owner ? api('/api/outbox') : [], owner ? api('/api/backups') : []])
    : [null, [], null, [], []];
  const ok = (b, yes, no) => html`<span class="pill ${b ? '' : 'grey'}">${b ? yes : no}</span>`;
  render(el, html`<div class="page-head"><div><h1>${isAgency() ? 'Settings' : 'Account'}</h1><p>${state.user.email}</p></div></div>
    <div class="grid g2">
      <div>
        <div class="card form"><h2>Your account</h2>
          ${field('Email me notifications', 'email_notify', { type: 'checkbox', value: me.email_notify, attrs: 'id="en"' })}
          <p class="muted small" style="margin:0">${isAgency() ? 'New requests, client approvals, payments, enquiries and downtime alerts.' : 'New versions to approve, replies to your requests, invoices, website enquiries and your monthly report.'}</p>
          <div class="row between" style="border-top:1px solid var(--line);padding-top:12px"><span><strong>Two-factor sign-in</strong> ${ok(me.totp_enabled, 'on', 'off')}<div class="muted small">A 6-digit code from an authenticator app each time you sign in.</div></span>
            ${me.totp_enabled ? html`<button class="btn sm" id="tfa-off">Turn off</button>` : html`<button class="btn sm primary" id="tfa-on">Set up</button>`}</div></div>
        ${isAgency() ? html`<form class="card form" id="sending"><h2>Sending emails as you</h2>
          <p class="muted small" style="margin:0">Quotes, agreements, invoices and reminders for your shoots go out under your name, and clients' replies come straight to you.</p>
          <div class="two">${field('Your name on emails', 'send_as_name', { value: me.send_as_name, placeholder: me.name })}${field('Your email address', 'send_as_email', { type: 'email', value: me.send_as_email, placeholder: me.email })}</div>
          ${field('Signature', 'email_signature', { type: 'textarea', rows: 3, value: me.email_signature, placeholder: `${me.name}\nKess Media\n0400 000 000` })}
          <div class="callout small"><strong>Clients will see:</strong> <span class="mono">${me.from_preview}</span>${me.reply_to ? html`<br><strong>Replies go to:</strong> <span class="mono">${me.reply_to}</span>` : ''}
            ${me.verified ? html`<br>✓ Sent from your own address (domain verified).` : html`<br>Sent from the shared address with your name. To send from your own address, verify its domain with the email provider and add it to <span class="mono">MAIL_VERIFIED_DOMAINS</span>${me.verified_domains.length ? ` (verified now: ${me.verified_domains.join(', ')})` : ''}.`}</div>
          <div class="row end"><button class="btn primary">Save</button></div></form>` : ''}
        <form class="card form" id="pw"><h2>Change password</h2>${field('Current password', 'current', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}${field('New password', 'next', { type: 'password', required: true, hint: 'at least 10 characters', attrs: 'minlength="10" autocomplete="new-password"' })}<div class="row end"><button class="btn primary">Update password</button></div></form>
        ${isAgency() ? html`<div class="card"><div class="card-head"><h2>Team</h2>${owner ? html`<button class="btn sm" id="inv">+ Invite</button>` : ''}</div>
          ${team.map((u) => html`<div class="row between" style="padding:6px 0;border-bottom:1px solid #f1efea"><span><strong>${u.name}</strong> <span class="pill grey">${u.role}</span><div class="muted small">${u.email} · ${u.pending ? 'invite pending' : u.last_login_at ? `active ${ago(u.last_login_at)}` : 'never signed in'}</div></span>${owner && u.id !== state.user.id ? html`<button class="btn sm" data-reset="${u.id}">Link</button>` : ''}</div>`)}</div>` : ''}
      </div>
      ${s ? html`<form class="card form" id="agency"><h2>Agency</h2>
        <div class="two">${field('Agency name', 'agency_name', { value: s.agency_name })}${field('ABN', 'agency_abn', { value: s.agency_abn })}</div>
        <div class="two">${field('Email', 'agency_email', { value: s.agency_email })}${field('Address', 'agency_address', { value: s.agency_address })}</div>
        <div class="two">${field('Invoice prefix', 'invoice_prefix', { value: s.invoice_prefix })}${field('Payment terms (days)', 'payment_terms_days', { type: 'number', value: s.payment_terms_days })}</div>
        <div class="two">${field('GST rate', 'gst_rate', { type: 'number', value: s.gst_rate, attrs: 'step="0.01" min="0" max="1"' })}${owner ? field('Internal hourly rate ($)', 'internal_rate', { type: 'number', value: centsToDollars(Number(s.internal_rate_cents)), hint: 'estimates only, never shown to clients' }) : ''}</div>
        ${field('Bank details for invoices', 'bank_details', { type: 'textarea', value: s.bank_details, placeholder: 'BSB 000-000\nAccount 12345678\nName: Kess Media' })}
        ${field('Public URL of this Kess Cloud', 'public_base_url', { value: s.public_base_url, placeholder: 'https://cloud.kess.media', hint: 'used in emails, forms and analytics of exported sites' })}
        ${field('Team webhook (Slack, Make, Zapier)', 'webhook_url', { value: s.webhook_url, placeholder: 'https://hooks.slack.com/services/…', hint: 'agency notifications are posted here' })}
        ${field('Send clients their monthly website report on the 1st', 'email_reports', { type: 'checkbox', value: s.email_reports !== '0' })}
        ${field('Remind clients about overdue invoices (weekly)', 'email_reminders', { type: 'checkbox', value: s.email_reminders !== '0' })}
        ${owner ? html`<div class="row end"><button class="btn primary">Save</button></div>` : html`<p class="muted small">Only the owner can change agency settings.</p>`}</form>` : ''}
    </div>
    ${integ ? html`<h2 class="mt" style="margin:26px 0 12px">Integrations <em>and backups</em></h2>
    <div class="grid g3">
      <div class="card"><div class="card-head"><h2>Email</h2>${ok(integ.email.provider !== 'log', integ.email.provider, 'not connected')}</div>
        <p class="small muted" style="margin-top:0">${integ.email.provider === 'log' ? html`Emails are saved to the outbox below but not sent. Set <code>MAIL_PROVIDER</code> (resend or postmark), <code>MAIL_API_KEY</code> and <code>MAIL_FROM</code> on the server to send them.` : html`Sending from ${integ.email.from}.`}</p>
        <button class="btn sm" id="testmail">Send me a test email</button></div>
      <div class="card"><div class="card-head"><h2>Card payments</h2>${ok(integ.stripe.enabled, 'Stripe on', 'not connected')}</div>
        <p class="small muted" style="margin-top:0">${integ.stripe.enabled ? 'Clients see “Pay by card” on sent invoices.' : html`Set <code>STRIPE_SECRET_KEY</code> to add a “Pay by card” button to invoices.`}
        ${integ.stripe.enabled && !integ.stripe.webhook ? html`<br><strong style="color:var(--danger)">Set STRIPE_WEBHOOK_SECRET</strong> so payments mark invoices paid automatically.` : ''}</p>
        <label class="f small">Stripe webhook URL (event: checkout.session.completed)<input class="i mono" readonly value="${integ.stripe.webhook_url}"></label></div>
      <div class="card"><div class="card-head"><h2>Backups</h2>${ok(integ.backups.offsite, 'off-site on', 'local only')}</div>
        <p class="small muted" style="margin-top:0">Nightly database + files, newest ${integ.backups.keep} kept on the server.${integ.backups.offsite ? ' Each one is also copied to your S3/R2 bucket.' : html` Set <code>BACKUP_S3_*</code> to copy them to Cloudflare R2 or S3 too.`}</p>
        <div class="row"><button class="btn sm primary" id="backup">Back up now</button><button class="btn sm" id="jobs" title="Backups, overdue reminders, monthly reports">Run daily jobs now</button></div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Recent backups</h2></div>${backups.length ? html`<table class="t small">${backups.map((b) => html`<tr><td class="mono">${b.name}</td><td>${kb(b.size)}</td><td class="right"><a class="btn sm" href="/api/backups/${b.name}">Download</a></td></tr>`)}</table>` : html`<div class="empty">No backups yet. The first runs within a minute of starting the server.</div>`}</div>
      <div class="card"><div class="card-head"><h2>Email outbox</h2><span class="muted small">last 100</span></div>${outbox.length ? html`<table class="t small">${outbox.slice(0, 25).map((m) => html`<tr class="click" data-mail="${m.id}"><td><strong>${m.subject}</strong><div class="muted">${m.to_addr} · ${ago(m.created_at)}</div></td><td class="right">${pill(m.status === 'sent' ? 'paid' : m.status === 'failed' ? 'overdue' : 'draft', m.status)}</td></tr>`)}</table>` : html`<div class="empty">No emails yet.</div>`}</div>
    </div>` : ''}`);

  el.querySelector('#en').addEventListener('change', async (e) => { try { await api('/api/auth/prefs', { method: 'PATCH', body: { email_notify: e.target.checked } }); toast(e.target.checked ? 'Email notifications on' : 'Email notifications off'); } catch (err) { fail(err); } });
  el.querySelector('#tfa-on')?.addEventListener('click', async () => {
    const r = await api('/api/auth/2fa/setup', { method: 'POST', body: {} });
    const svg = await qrSvg(r.uri);
    const v = await modal({ title: 'Set up two-factor sign-in', submit: 'Turn on', body: html`<p class="muted" style="margin:0">1. Open an authenticator app (Google Authenticator, 1Password, Microsoft Authenticator) and scan this code, or type in the key.</p>
      ${svg ? html`<div style="width:190px;margin:0 auto">${raw(svg)}</div>` : ''}
      <div class="mono" style="text-align:center;font-size:14px;letter-spacing:.08em;word-break:break-all">${r.secret.match(/.{1,4}/g).join(' ')}</div>
      <p class="muted" style="margin:0">2. Enter the 6-digit code it shows.</p>${field('Code', 'code', { required: true, attrs: 'inputmode="numeric" autocomplete="one-time-code"' })}` });
    if (!v) return;
    try { await api('/api/auth/2fa/enable', { method: 'POST', body: v }); toast('Two-factor sign-in is on'); settings(el); } catch (err) { fail(err); }
  });
  el.querySelector('#tfa-off')?.addEventListener('click', async () => {
    const v = await modal({ title: 'Turn off two-factor sign-in?', submit: 'Turn off', body: field('Your password', 'password', { type: 'password', required: true }) });
    if (!v) return;
    try { await api('/api/auth/2fa/disable', { method: 'POST', body: v }); toast('Two-factor sign-in is off'); settings(el); } catch (err) { fail(err); }
  });
  el.querySelector('#agency')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    body.email_reports = e.target.elements.email_reports.checked ? '1' : '0';
    body.email_reminders = e.target.elements.email_reminders.checked ? '1' : '0';
    if ('internal_rate' in body) { body.internal_rate_cents = String(dollarsToCents(body.internal_rate) || 0); delete body.internal_rate; }
    try { const r = await api('/api/settings', { method: 'PATCH', body }); state.agencyName = r.agency_name; toast('Settings saved'); } catch (err) { fail(err); }
  });
  el.querySelector('#sending')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/api/auth/prefs', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); toast('Saved'); settings(el); } catch (err) { fail(err); }
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
  el.querySelector('#testmail')?.addEventListener('click', async () => { try { const r = await api('/api/outbox/test', { method: 'POST', body: {} }); toast(r.status === 'sent' ? `Test email sent to ${state.user.email}` : r.status === 'logged' ? 'Saved to the outbox (no email provider connected)' : 'Sending failed: see the outbox', r.status === 'failed'); settings(el); } catch (err) { fail(err); } });
  el.querySelector('#backup')?.addEventListener('click', async (e) => { e.target.disabled = true; try { const r = await api('/api/backups', { method: 'POST', body: {} }); toast(`Backup ${r.name} (${kb(r.size)})${r.offsite ? `, off-site ${r.offsite}` : ''}`); settings(el); } catch (err) { fail(err); e.target.disabled = false; } });
  el.querySelector('#jobs')?.addEventListener('click', async () => { try { const r = await api('/api/jobs/run', { method: 'POST', body: {} }); toast(`Done. Reminders: ${r.reminders?.length ?? 0}, reports: ${r.reports?.length ?? 0}${r.backup ? ', backup made' : ''}`); settings(el); } catch (err) { fail(err); } });
  el.querySelectorAll('[data-mail]').forEach((tr) => tr.onclick = () => {
    const m = outbox.find((x) => String(x.id) === tr.dataset.mail);
    modal({ title: m.subject, submit: '', cancel: 'Close', wide: true, body: html`<div class="muted small">To ${m.to_addr} · ${date(m.created_at)} · ${m.provider} · ${m.status}${m.error ? ` · ${m.error}` : ''}</div><div class="pre card">${m.body}</div>` });
  });
}
