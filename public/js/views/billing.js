import { api, html, render, money, pill, date, modal, field, toast, fail, confirmBox, isAgency, isOwner, dollarsToCents, centsToDollars, esc } from '../lib.js';

export async function invoices(el, _p, q) {
  const agency = isAgency();
  const status = q.get('status') || '';
  const client = q.get('client') || '';
  const params = new URLSearchParams(); if (status) params.set('status', status); if (client) params.set('client_id', client);
  const [rows, clients] = await Promise.all([api(`/api/invoices?${params}`), agency ? api('/api/clients') : Promise.resolve([])]);
  const total = (f) => rows.filter(f).reduce((n, i) => n + i.total_cents, 0);
  render(el, html`<div class="page-head"><div><h1>Invoices</h1><p>${agency ? html`Outstanding ${money(total((i) => i.status === 'sent'))} · overdue ${money(total((i) => i.overdue))}` : 'All amounts include GST.'}</p></div>
    ${agency ? html`<div class="row"><select class="i" id="cl" style="width:auto"><option value="">All clients</option>${clients.map((c) => html`<option value="${c.id}" ${String(c.id) === client ? 'selected' : ''}>${c.name}</option>`)}</select>
      <select class="i" id="st" style="width:auto">${[['', 'Any status'], ['draft', 'Draft'], ['sent', 'Sent'], ['paid', 'Paid'], ['void', 'Void']].map(([v, l]) => html`<option value="${v}" ${v === status ? 'selected' : ''}>${l}</option>`)}</select>
      <button class="btn" id="care">Generate care invoices</button><button class="btn primary" id="new">+ New invoice</button></div>` : ''}</div>
    <div class="card table-wrap">${rows.length ? html`<table class="t"><thead><tr><th>Number</th>${agency ? html`<th>Client</th>` : ''}<th>Issued</th><th>Due</th><th>Status</th><th class="n">Total inc GST</th><th></th></tr></thead><tbody>
      ${rows.map((i) => html`<tr class="click" data-id="${i.id}"><td><strong>${i.number}</strong><div class="muted small">${i.notes || ''}</div></td>${agency ? html`<td>${i.client_name}</td>` : ''}<td>${date(i.issue_date)}</td><td>${date(i.due_date)}</td><td>${pill(i.overdue ? 'overdue' : i.status)}</td><td class="n">${money(i.total_cents, { cents: true })}</td><td class="right"><a class="btn sm" href="/invoices/${i.id}/print" target="_blank" rel="noopener" onclick="event.stopPropagation()">PDF</a></td></tr>`)}
      </tbody></table>` : html`<div class="empty"><h3>No invoices</h3></div>`}</div>`);
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/invoices/${tr.dataset.id}`; });
  if (!agency) return;
  const go = () => { const p = new URLSearchParams(); const c = el.querySelector('#cl').value, s = el.querySelector('#st').value; if (c) p.set('client', c); if (s) p.set('status', s); location.hash = `#/invoices${p.toString() ? '?' + p : ''}`; };
  el.querySelector('#cl').onchange = go; el.querySelector('#st').onchange = go;
  el.querySelector('#new').onclick = () => newInvoice(clients, client);
  el.querySelector('#care').onclick = async () => {
    const v = await modal({ title: 'Generate care plan invoices', submit: 'Generate drafts', body: html`<p class="muted" style="margin:0">Creates one draft invoice per client for every live site on a care plan, plus any approved, billable requests finished that month. Clients already invoiced for the period are skipped.</p>${field('Month', 'period', { type: 'month', value: new Date().toISOString().slice(0, 7), required: true })}` });
    if (!v) return;
    try { const r = await api('/api/invoices/generate-care', { method: 'POST', body: v }); toast(r.created.length ? `${r.created.length} draft invoice${r.created.length > 1 ? 's' : ''} created` : 'Nothing new to invoice for that month'); invoices(el, _p, new URLSearchParams('status=draft')); } catch (e) { fail(e); }
  };
  if (q.get('new')) { history.replaceState(null, '', '#/invoices'); newInvoice(clients, client); }
}

async function newInvoice(clients, clientId) {
  const v = await modal({ title: 'New invoice', submit: 'Create draft', body: html`${field('Client', 'client_id', { type: 'select', value: clientId, options: clients.map((c) => [c.id, c.name]), required: true })}${field('Note', 'notes', { placeholder: 'e.g. Website build, 50% deposit' })}` });
  if (!v) return;
  try { const inv = await api('/api/invoices', { method: 'POST', body: { client_id: Number(v.client_id), notes: v.notes, items: [] } }); location.hash = `#/invoices/${inv.id}`; } catch (e) { fail(e); }
}

export async function invoice(el, { id }) {
  const agency = isAgency();
  const inv = await api(`/api/invoices/${id}`);
  const editable = agency && inv.status === 'draft';
  let items = inv.items.map((i) => ({ ...i }));
  const draw = () => {
    const sub = items.reduce((n, i) => n + Math.round((Number(i.qty) || 0) * (Number(i.unit_cents) || 0)), 0);
    render(el, html`<div class="crumbs"><a href="#/invoices">Invoices</a> /</div>
      <div class="page-head"><div><h1>${inv.number}</h1><p>${pill(inv.overdue ? 'overdue' : inv.status)} · ${inv.client_name} · issued ${date(inv.issue_date)} · due ${date(inv.due_date)}${inv.paid_at ? ` · paid ${date(inv.paid_at)}` : ''}</p></div>
        <div class="row"><a class="btn" href="/invoices/${inv.id}/print" target="_blank" rel="noopener">View / PDF ↗</a>
        ${agency && inv.status === 'draft' ? html`<button class="btn danger" id="del">Delete</button><button class="btn primary" id="send">Mark as sent</button>` : ''}
        ${agency && inv.status === 'sent' ? html`<button class="btn" id="void">Void</button><button class="btn primary" id="paid">Mark paid</button>` : ''}
        ${agency && inv.status === 'paid' ? html`<button class="btn" id="unpaid">Mark unpaid</button>` : ''}</div></div>
      <div class="card table-wrap"><table class="t"><thead><tr><th style="width:55%">Description</th><th class="n">Qty</th><th class="n">Unit ex GST</th><th class="n">Amount</th>${editable ? html`<th></th>` : ''}</tr></thead><tbody>
        ${items.map((i, n) => editable ? html`<tr><td><input class="i" data-k="description" data-n="${n}" value="${i.description}"></td><td><input class="i right" style="width:70px" type="number" step="0.25" data-k="qty" data-n="${n}" value="${i.qty}"></td><td><input class="i right" style="width:110px" type="number" step="0.01" data-k="unit" data-n="${n}" value="${centsToDollars(i.unit_cents)}"></td><td class="n">${money(Math.round(i.qty * i.unit_cents), { cents: true })}</td><td><button class="btn sm ghost danger" data-rm="${n}">✕</button></td></tr>`
          : html`<tr><td>${i.description}</td><td class="n">${i.qty}</td><td class="n">${money(i.unit_cents, { cents: true })}</td><td class="n">${money(Math.round(i.qty * i.unit_cents), { cents: true })}</td></tr>`)}
        ${!items.length ? html`<tr><td colspan="5" class="muted">No line items yet.</td></tr>` : ''}
      </tbody></table>
      ${editable ? html`<div class="row between mt"><div class="row"><button class="btn sm" id="add">+ Line</button><button class="btn sm" id="addplan">+ Care plan</button></div><button class="btn primary" id="save">Save draft</button></div>` : ''}
      <div style="margin-left:auto;width:260px;margin-top:14px" class="stack small"><div class="row between"><span>Subtotal</span><span>${money(sub, { cents: true })}</span></div>
        <div class="row between"><span>GST</span><span>${money(editable ? Math.round(sub * inv.gst_rate) : inv.gst_cents, { cents: true })}</span></div>
        <div class="row between" style="font-size:16px;font-weight:800;color:var(--forest);border-top:1px solid var(--line);padding-top:8px"><span>Total</span><span>${money(editable ? sub + Math.round(sub * inv.gst_rate) : inv.total_cents, { cents: true })}</span></div></div></div>
      ${inv.notes ? html`<p class="muted">${inv.notes}</p>` : ''}`);
    bind();
  };
  const save = async (extra = {}) => { try { await api(`/api/invoices/${id}`, { method: 'PATCH', body: { ...(editable ? { items } : {}), ...extra } }); toast('Saved'); invoice(el, { id }); } catch (e) { fail(e); } };
  function bind() {
    el.querySelectorAll('[data-k]').forEach((inp) => inp.onchange = () => {
      const it = items[inp.dataset.n];
      if (inp.dataset.k === 'unit') it.unit_cents = dollarsToCents(inp.value) || 0; else it[inp.dataset.k] = inp.dataset.k === 'qty' ? Number(inp.value) : inp.value;
      draw();
    });
    el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { items.splice(Number(b.dataset.rm), 1); draw(); });
    el.querySelector('#add')?.addEventListener('click', () => { items.push({ description: '', qty: 1, unit_cents: 0 }); draw(); });
    el.querySelector('#addplan')?.addEventListener('click', async () => {
      const plans = await api('/api/plans');
      const v = await modal({ title: 'Add care plan', submit: 'Add', body: field('Plan', 'plan', { type: 'select', options: plans.map((p) => [p.id, `${p.name} (${money(p.price_cents)})`]) }) });
      if (!v) return;
      const p = plans.find((x) => String(x.id) === v.plan);
      items.push({ description: `${p.name} care plan (${new Date().toISOString().slice(0, 7)})`, qty: 1, unit_cents: p.price_cents }); draw();
    });
    el.querySelector('#save')?.addEventListener('click', () => save());
    el.querySelector('#send')?.addEventListener('click', async () => { if (await confirmBox('Mark as sent?', 'The client can now see it in their portal and gets a notification. Line items lock.', 'Mark sent')) save({ status: 'sent' }); });
    el.querySelector('#paid')?.addEventListener('click', () => save({ status: 'paid' }));
    el.querySelector('#unpaid')?.addEventListener('click', () => save({ status: 'sent' }));
    el.querySelector('#void')?.addEventListener('click', async () => { if (await confirmBox('Void this invoice?', 'It stays on record but is no longer owed.', 'Void')) save({ status: 'void' }); });
    el.querySelector('#del')?.addEventListener('click', async () => { if (!await confirmBox('Delete draft?', '', 'Delete')) return; try { await api(`/api/invoices/${id}`, { method: 'DELETE' }); location.hash = '#/invoices'; } catch (e) { fail(e); } });
  }
  draw();
}

export async function plans(el) {
  const agency = isAgency();
  const [rows, usage] = await Promise.all([api('/api/plans'), api('/api/care-usage')]);
  const mrr = rows.reduce((n, p) => n + p.price_cents * p.active_sites, 0);
  render(el, html`<div class="page-head"><div><h1>Care <em>plans</em></h1><p>${agency ? html`${money(mrr)}/mo recurring across ${rows.reduce((n, p) => n + p.active_sites, 0)} live sites, ex GST` : 'What is included in your website care.'}</p></div>${isOwner() ? html`<button class="btn primary" id="add">+ New plan</button>` : ''}</div>
    <div class="grid g3">${rows.filter((p) => p.active || agency).map((p) => html`<div class="card" style="${p.active ? '' : 'opacity:.6'}"><div class="card-head"><h2>${p.name}</h2>${isOwner() ? html`<button class="btn sm" data-edit="${p.id}">Edit</button>` : ''}</div>
      <div class="score" style="font-size:28px;color:var(--forest)">${money(p.price_cents)}<span style="font-size:13px;font-family:Inter;font-style:normal;color:var(--muted)">/month ex GST</span></div>
      <p class="muted">${p.description}</p><ul style="padding-left:18px;margin:0">${p.features.map((f) => html`<li>${f}</li>`)}</ul>
      <p class="small muted">${p.hours_included ? `${p.hours_included} h of changes included each month` : 'Changes quoted separately'}${agency ? ` · ${p.active_sites} active site${p.active_sites === 1 ? '' : 's'}` : ''}${p.active ? '' : ' · retired'}</p></div>`)}</div>
    <div class="card mt"><div class="card-head"><h2>Included hours used, ${usage.month}</h2></div>
      ${usage.rows.length ? html`<table class="t"><thead><tr><th>Site</th>${agency ? html`<th>Client</th>` : ''}<th>Plan</th><th class="n">Used</th><th class="n">Included</th><th style="width:30%"></th></tr></thead><tbody>${usage.rows.map((u) => {
        const pct = u.hours_included ? Math.min(100, (u.hours_used / u.hours_included) * 100) : u.hours_used ? 100 : 0;
        return html`<tr><td>${u.site_name}</td>${agency ? html`<td>${u.client_name}</td>` : ''}<td>${u.plan_name}</td><td class="n">${u.hours_used} h</td><td class="n">${u.hours_included} h</td><td><div class="hbar"><div class="b" style="margin:6px 0"><span style="width:${pct}%;background:${u.hours_used > u.hours_included ? 'var(--danger)' : 'var(--forest)'}"></span></div></div></td></tr>`; })}</tbody></table>` : html`<div class="empty">No live sites on care plans.</div>`}</div>`);
  const edit = async (p = { features: [] }) => {
    const v = await modal({ title: p.id ? `Edit ${p.name}` : 'New care plan', body: html`${field('Name', 'name', { value: p.name, required: true })}
      <div class="two">${field('Price per month, ex GST ($)', 'price', { type: 'number', value: centsToDollars(p.price_cents), required: true, attrs: 'step="1" min="0"' })}${field('Hours of changes included', 'hours_included', { type: 'number', value: p.hours_included ?? 0, attrs: 'step="0.5" min="0"' })}</div>
      ${field('Description', 'description', { type: 'textarea', value: p.description })}${field('Features', 'features', { type: 'textarea', rows: 5, value: p.features.join('\n'), hint: 'one per line' })}
      ${p.id ? field('Available for new sites', 'active', { type: 'checkbox', value: p.active }) : ''}` });
    if (!v) return;
    const body = { name: v.name, price_cents: dollarsToCents(v.price), hours_included: Number(v.hours_included), description: v.description, features: v.features.split('\n').map((s) => s.trim()).filter(Boolean), ...(p.id ? { active: v.active } : {}) };
    try { await api(p.id ? `/api/plans/${p.id}` : '/api/plans', { method: p.id ? 'PATCH' : 'POST', body }); toast('Saved'); plans(el); } catch (e) { fail(e); }
  };
  el.querySelector('#add')?.addEventListener('click', () => edit());
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => edit(rows.find((p) => String(p.id) === b.dataset.edit)));
  void esc;
}
