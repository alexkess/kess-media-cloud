import { api, html, render, ago, date, toast, fail, confirmBox, field, esc } from '../lib.js';

const ok = (b, yes, no) => html`<span class="pill ${b ? '' : 'grey'}">${b ? yes : no}</span>`;
const code = (s) => html`<span class="mono">${s}</span>`;

export async function appsPanel(el) {
  const a = await api('/api/integrations/apps');
  const x = a.xero, d = a.dropbox, v = a.vimeo;
  render(el, html`<div class="grid g3">
    <div class="card"><div class="card-head"><h2>Xero</h2>${ok(x.connected, 'connected', x.configured ? 'not connected' : 'not set up')}</div>
      ${x.connected ? html`<p class="small" style="margin-top:0"><strong>${x.account_name}</strong><br><span class="muted">Last sync ${x.last_sync_at ? ago(x.last_sync_at) : 'not yet'} · connected ${date(x.connected_at)}</span></p>
        ${x.last_error ? html`<div class="callout warn small" style="margin-bottom:10px">${x.last_error}</div>` : ''}
        <form class="form" id="xform">
          ${field('Send new invoices to Xero automatically', 'auto_push', { type: 'checkbox', value: x.settings.auto_push !== false })}
          ${field('Only invoices issued from', 'push_from', { type: 'date', value: x.settings.push_from || '', hint: 'older invoices are already in Xero' })}
          <div class="two">${field('Sales account code', 'sales_account_code', { value: x.settings.sales_account_code || '200' })}${field('Tax type', 'tax_type', { value: x.settings.tax_type || 'OUTPUT', hint: 'OUTPUT = GST on income' })}</div>
          <label class="f">Record payments in <span class="hint">card payments and invoices you mark paid</span><select class="i" name="payment_account_id" id="xbank"><option value="">Don't record payments (reconcile in Xero)</option>${x.settings.payment_account_id ? html`<option value="${x.settings.payment_account_id}" selected>Current bank account</option>` : ''}</select></label>
          <div class="row between"><span class="row"><button type="button" class="btn sm" id="xsync">Sync now</button><a class="btn sm ghost" href="/oauth/xero/start">Reconnect</a><button type="button" class="btn sm ghost danger" id="xoff">Disconnect</button></span><button class="btn sm primary">Save</button></div>
        </form>
        <p class="muted small">Invoices go to Xero when sent (numbers stay the same). When you reconcile a payment in Xero, the invoice is marked paid here within the hour and reminders stop.</p>`
      : x.configured ? html`<p class="muted small" style="margin-top:0">Sends invoices to Xero as they're issued and brings payments back.</p><a class="btn primary" href="/oauth/xero/start">Connect Xero</a>`
        : html`<p class="small" style="margin-top:0">To set up: at <strong>developer.xero.com</strong> create a <em>Web app</em> with redirect URI ${code(x.redirect_uri)}, then add ${code('XERO_CLIENT_ID')} and ${code('XERO_CLIENT_SECRET')} to the server's <span class="mono">.env</span> and run the update script.</p>`}
    </div>
    <div class="card"><div class="card-head"><h2>Dropbox</h2>${ok(d.connected, 'connected', d.configured ? 'not connected' : 'not set up')}</div>
      ${d.connected ? html`<p class="small" style="margin-top:0"><strong>${d.account_name}</strong></p>${d.last_error ? html`<div class="callout warn small" style="margin-bottom:10px">${d.last_error}</div>` : ''}
        <form class="form" id="dform">
          ${field('Shoot folder', 'folder_template', { value: d.settings.folder_template, hint: '{client} {job} {year} {month} {day}' })}
          <div class="muted small" style="margin-top:-8px">e.g. ${code(d.example_folder)}</div>
          ${field('Subfolders', 'subfolders', { value: d.settings.subfolders, hint: 'comma separated' })}
          ${field('Client uploads go to', 'request_folder', { value: d.settings.request_folder })}
          <div class="row between"><span class="row"><a class="btn sm ghost" href="/oauth/dropbox/start">Reconnect</a><button type="button" class="btn sm ghost danger" id="doff">Disconnect</button></span><button class="btn sm primary">Save</button></div></form>
        <p class="muted small">On each shoot: create its folders, give the client an upload link (on their booking page), and deliver any folder as a link.</p>`
      : d.configured ? html`<p class="muted small" style="margin-top:0">Shoot folders, client upload links and delivery links, including your team folders.</p><a class="btn primary" href="/oauth/dropbox/start">Connect Dropbox</a>`
        : html`<p class="small" style="margin-top:0">To set up: at <strong>dropbox.com/developers</strong> create an app (Scoped access, Full Dropbox) with redirect URI ${code(d.redirect_uri)} and permissions <span class="mono">account_info.read files.metadata.read files.content.write sharing.read sharing.write file_requests.read file_requests.write</span>. Then add ${code('DROPBOX_APP_KEY')} and ${code('DROPBOX_APP_SECRET')} to the server's <span class="mono">.env</span>.</p>`}
    </div>
    <div class="card"><div class="card-head"><h2>Vimeo</h2>${ok(v.configured, 'connected', 'not set up')}</div>
      ${v.configured ? html`<p class="muted small" style="margin-top:0" id="vacct">Checking…</p><p class="muted small">On each shoot, “Add from Vimeo” picks a video from your library, plays it on the client's booking page, and can add Vimeo's review page for timecoded comments.</p>`
        : html`<p class="small" style="margin-top:0">To set up: at <strong>developer.vimeo.com</strong> create an app, generate an <em>Authenticated</em> access token with scopes <span class="mono">public private video_files</span>, and add it as ${code('VIMEO_TOKEN')} to the server's <span class="mono">.env</span>.</p>`}
    </div></div>`);

  const reload = () => appsPanel(el);
  const save = (provider, form) => async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    if (form.elements.auto_push) body.auto_push = form.elements.auto_push.checked;
    try { await api(`/api/integrations/${provider}/settings`, { method: 'PATCH', body }); toast('Saved'); reload(); } catch (err) { fail(err); }
  };
  const xf = el.querySelector('#xform');
  if (xf) {
    xf.onsubmit = save('xero', xf);
    api('/api/integrations/xero/accounts').then((accts) => {
      const sel = el.querySelector('#xbank');
      const cur = x.settings.payment_account_id;
      sel.innerHTML = '<option value="">Don\'t record payments (reconcile in Xero)</option>' + accts.filter((ac) => ac.bank).map((ac) => `<option value="${esc(ac.id)}" ${ac.id === cur ? 'selected' : ''}>${esc(ac.name)}${ac.code ? ` (${esc(ac.code)})` : ''}</option>`).join('');
      const sales = xf.elements.sales_account_code;
      const list = document.createElement('datalist'); list.id = 'xsales';
      list.innerHTML = accts.filter((ac) => ac.class === 'REVENUE' && ac.code).map((ac) => `<option value="${esc(ac.code)}">${esc(ac.name)}</option>`).join('');
      xf.appendChild(list); sales.setAttribute('list', 'xsales');
    }).catch(() => {});
    el.querySelector('#xsync').onclick = async () => { try { const r = await api('/api/integrations/xero/sync', { method: 'POST', body: {} }); toast(`Synced: ${r.pushed || 0} sent to Xero, ${r.paid || 0} marked paid${r.errors ? `, ${r.errors} problems` : ''}`, !!r.errors); reload(); } catch (err) { fail(err); } };
    el.querySelector('#xoff').onclick = async () => { if (await confirmBox('Disconnect Xero?', 'Invoices stop going to Xero. Nothing already in Xero is changed.', 'Disconnect')) { await api('/api/integrations/xero/disconnect', { method: 'POST', body: {} }); reload(); } };
  }
  const df = el.querySelector('#dform');
  if (df) {
    df.onsubmit = save('dropbox', df);
    el.querySelector('#doff').onclick = async () => { if (await confirmBox('Disconnect Dropbox?', 'Existing links keep working. New folders and links can’t be made until you reconnect.', 'Disconnect')) { await api('/api/integrations/dropbox/disconnect', { method: 'POST', body: {} }); reload(); } };
  }
  const va = el.querySelector('#vacct');
  if (va) api('/api/vimeo/account').then((acct) => { va.innerHTML = ''; const s = document.createElement('strong'); s.textContent = acct.name; va.append(s, document.createTextNode(` · ${acct.plan || ''} plan`)); }).catch((e) => { va.textContent = e.message; });
}
