import { api, html, render, money, pill, ago, date, modal, field, toast, fail, isAgency, state, dollarsToCents, centsToDollars } from '../lib.js';

const COLS = [['new', 'New'], ['quoted', 'Quoted'], ['in_progress', 'In progress'], ['waiting', 'Waiting on client'], ['done', 'Done']];
const KINDS = [['change', 'Change to the site'], ['content', 'New or updated content'], ['bug', 'Something is broken'], ['new_feature', 'New feature'], ['question', 'Question']];

async function newRequest(prefill = {}) {
  const agency = isAgency();
  const [clients, sites] = await Promise.all([agency ? api('/api/clients') : Promise.resolve([]), api('/api/sites')]);
  const v = await modal({ title: agency ? 'New request' : 'What do you need?', submit: 'Send request', body: html`
    ${agency ? field('Client', 'client_id', { type: 'select', value: prefill.client || '', options: clients.map((c) => [c.id, c.name]), required: true }) : ''}
    ${field('Website', 'site_id', { type: 'select', value: prefill.site || '', options: [['', 'Not about a specific site'], ...sites.map((s) => [s.id, agency ? `${s.name} (${s.client_name})` : s.name])] })}
    ${field('Type', 'kind', { type: 'select', options: KINDS })}
    ${field('Short title', 'title', { required: true, placeholder: 'e.g. Update opening hours' })}
    ${field('Details', 'body', { type: 'textarea', rows: 6, placeholder: 'Which page, what should change, any links or wording. Attach files in Files.' })}
    <div class="two">${field('Priority', 'priority', { type: 'select', value: 'normal', options: [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent: site is broken']] })}${field('Needed by', 'due_date', { type: 'date' })}</div>` });
  if (!v) return null;
  try {
    const r = await api('/api/requests', { method: 'POST', body: { ...v, client_id: Number(v.client_id) || undefined, site_id: Number(v.site_id) || null } });
    toast(agency ? 'Request created' : "Sent. We'll get back to you soon.");
    location.hash = `#/requests/${r.id}`;
    return r;
  } catch (e) { fail(e); return null; }
}

export async function list(el, _p, q) {
  const agency = isAgency();
  const view = q.get('view') || (agency ? 'board' : 'list');
  const rows = await api(`/api/requests${q.get('client') ? `?client_id=${q.get('client')}` : ''}`);
  const open = rows.filter((r) => !['done', 'closed'].includes(r.status));
  render(el, html`<div class="page-head"><div><h1>Requests</h1><p>${open.length} open · ${agency ? 'change requests, bugs and quotes from every client' : 'changes, questions and quotes'}</p></div>
    <div class="row">${agency ? html`<a class="btn sm ${view === 'board' ? 'primary' : ''}" href="#/requests?view=board">Board</a><a class="btn sm ${view === 'list' ? 'primary' : ''}" href="#/requests?view=list">List</a>` : ''}<button class="btn primary" id="new">+ New request</button></div></div>
    ${view === 'board' ? html`<div class="board">${COLS.map(([k, l]) => { const items = rows.filter((r) => r.status === k); return html`<div class="col"><h3><span>${l}</span><span>${items.length}</span></h3>
      ${items.map((r) => html`<a class="tile" href="#/requests/${r.id}"><div class="ttl">${r.title}</div><div class="meta"><span>${r.client_name}</span>${r.priority !== 'normal' ? pill(r.priority) : ''}${r.quote_cents ? pill(r.quote_status === 'approved' ? 'approved' : 'quoted', `${money(r.quote_cents)} ${r.quote_status || ''}`) : ''}</div>
        <div class="meta">#${r.id} · ${ago(r.updated_at)}${r.comments ? ` · 💬 ${r.comments}` : ''}${r.assignee_name ? ` · ${r.assignee_name}` : ''}</div></a>`)}</div>`; })}</div>`
    : html`<div class="card table-wrap">${rows.length ? html`<table class="t"><thead><tr><th>#</th><th>Request</th>${agency ? html`<th>Client</th>` : ''}<th>Status</th><th>Quote</th><th>Updated</th></tr></thead><tbody>
      ${rows.map((r) => html`<tr class="click" data-id="${r.id}"><td class="muted">${r.id}</td><td><strong>${r.title}</strong><div class="muted small">${r.site_name || ''} ${r.kind.replace('_', ' ')}</div></td>${agency ? html`<td>${r.client_name}</td>` : ''}
        <td>${pill(r.status)} ${r.priority !== 'normal' ? pill(r.priority) : ''}</td><td>${r.quote_cents ? html`${money(r.quote_cents)} <span class="muted small">${r.quote_status || ''}</span>` : '—'}</td><td class="muted small">${ago(r.updated_at)}</td></tr>`)}
      </tbody></table>` : html`<div class="empty"><h3>No requests yet</h3><p>Need a change to your website? Send a request and we'll take it from there.</p></div>`}</div>`}`);
  el.querySelector('#new').onclick = () => newRequest({ client: q.get('client') });
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/requests/${tr.dataset.id}`; });
  if (q.get('new')) { history.replaceState(null, '', '#/requests'); newRequest({ client: q.get('client'), site: q.get('site') }); }
}

export async function detail(el, { id }) {
  const agency = isAgency();
  const [r, team] = await Promise.all([api(`/api/requests/${id}`), agency ? api('/api/team') : Promise.resolve([])]);
  const reload = () => detail(el, { id });
  const patch = async (body, msg = 'Updated') => { try { await api(`/api/requests/${id}`, { method: 'PATCH', body }); toast(msg); reload(); } catch (e) { fail(e); } };
  const hours = r.time?.reduce((n, t) => n + t.hours, 0) || 0;
  render(el, html`<div class="crumbs"><a href="#/requests">Requests</a> / #${r.id}</div>
    <div class="page-head"><div><h1>${r.title}</h1><p>${pill(r.status)} ${pill(r.priority)} · ${r.kind.replace('_', ' ')}${agency ? html` · <a href="#/clients/${r.client_id}">${r.client_name}</a>` : ''}${r.site_name ? html` · <a href="#/sites/${r.site_id}">${r.site_name}</a>` : ''} · opened ${ago(r.created_at)} by ${r.created_by_name || 'Kess Media'}</p></div>
      ${!agency && !['done', 'closed'].includes(r.status) ? html`<button class="btn" id="close">Close request</button>` : ''}</div>
    <div class="grid g-side"><div>
      <div class="card">${r.body ? html`<div class="pre">${r.body}</div>` : html`<span class="muted">No details given.</span>`}</div>
      ${r.quote_cents && r.quote_status === 'pending' && !agency ? html`<div class="callout dark mt"><h2>Quote: <em>${money(r.quote_cents)}</em> <span style="font-size:13px;font-weight:400">ex GST</span></h2><p>Approve and we'll start. It will appear on your next invoice once done.</p>
        <div class="row"><button class="btn mint" id="qa">Approve quote</button><button class="btn" id="qd" style="background:transparent;color:#fff;border-color:#555">Decline</button></div></div>` : ''}
      <h2 class="mt" style="margin-bottom:10px">Conversation</h2>
      <div class="stack">${r.comments.length ? r.comments.map((c) => html`<div class="comment ${c.internal ? 'internal' : ''} ${c.user_id === state.user.id ? 'mine' : ''}"><div class="meta"><strong>${c.user_name || 'System'}</strong>${c.user_role && c.user_role !== 'client' ? ' · Kess Media' : ''} · ${ago(c.created_at)}${c.internal ? ' · internal note, client cannot see this' : ''}</div><div class="pre">${c.body}</div></div>`) : html`<p class="muted">No replies yet.</p>`}</div>
      <form class="card mt form" id="cf">${field(agency ? 'Reply' : 'Add a reply', 'body', { type: 'textarea', rows: 4, required: true })}
        <div class="row between">${agency ? field('Internal note (hidden from client)', 'internal', { type: 'checkbox' }) : html`<span></span>`}<button class="btn primary">Send</button></div></form>
    </div><div>
      ${agency ? html`<div class="card form" id="ctl"><h2>Manage</h2>
        <div class="two">${field('Status', 'status', { type: 'select', value: r.status, options: [...COLS, ['closed', 'Closed']] })}${field('Priority', 'priority', { type: 'select', value: r.priority, options: ['low', 'normal', 'high', 'urgent'] })}</div>
        ${field('Assigned to', 'assignee_id', { type: 'select', value: r.assignee_id || '', options: [['', 'Nobody'], ...team.map((u) => [u.id, u.name])] })}
        <div class="two">${field('Estimate (hours)', 'estimate_hours', { type: 'number', value: r.estimate_hours ?? '', hint: 'internal', attrs: 'step="0.25" min="0"' })}${field('Due', 'due_date', { type: 'date', value: r.due_date || '' })}</div>
        ${field('Quote to client, ex GST ($)', 'quote', { type: 'number', value: centsToDollars(r.quote_cents), hint: r.quote_status ? `client: ${r.quote_status}` : 'leave empty if covered by care plan', attrs: 'step="1" min="0"' })}
        ${field('Billable (add to next care invoice when done)', 'billable', { type: 'checkbox', value: !!r.billable })}
        <button class="btn primary" id="save">Save</button></div>
        <div class="card"><div class="card-head"><h2>Time</h2><strong>${hours} h</strong></div>
          ${r.time.map((t) => html`<div class="row between small" style="padding:4px 0;border-bottom:1px solid #f1efea"><span>${t.hours} h · ${t.user_name}${t.note ? ` · ${t.note}` : ''}</span><span class="muted">${date(t.day)}</span></div>`)}
          <form class="row mt" id="tf"><input class="i" name="hours" type="number" step="0.25" min="0.25" max="24" placeholder="Hours" style="width:90px" required><input class="i" name="note" placeholder="What was done" style="flex:1"><button class="btn sm">Log</button></form>
          ${r.estimate_hours ? html`<p class="muted small">${Math.round((hours / r.estimate_hours) * 100)}% of the ${r.estimate_hours} h estimate used.</p>` : ''}</div>`
      : html`<div class="card"><h2>Status</h2><div class="stack mt small"><div class="row between"><span class="muted">Status</span>${pill(r.status)}</div>${r.quote_cents ? html`<div class="row between"><span class="muted">Quote</span><span>${money(r.quote_cents)} ex GST · ${r.quote_status}</span></div>` : ''}${r.due_date ? html`<div class="row between"><span class="muted">Needed by</span><span>${date(r.due_date)}</span></div>` : ''}<div class="row between"><span class="muted">Last update</span><span>${ago(r.updated_at)}</span></div></div></div>`}
    </div></div>`);

  el.querySelector('#cf').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try { await api(`/api/requests/${id}/comments`, { method: 'POST', body: { body: f.body.value, internal: f.internal?.checked } }); reload(); } catch (err) { fail(err); }
  };
  el.querySelector('#close')?.addEventListener('click', () => patch({ status: 'closed' }, 'Request closed'));
  el.querySelector('#qa')?.addEventListener('click', () => patch({ quote_decision: 'approved' }, 'Quote approved. Thanks!'));
  el.querySelector('#qd')?.addEventListener('click', () => patch({ quote_decision: 'declined' }, 'Quote declined'));
  el.querySelector('#save')?.addEventListener('click', () => {
    const c = el.querySelector('#ctl');
    const g = (n) => c.querySelector(`[name=${n}]`);
    patch({ status: g('status').value, priority: g('priority').value, assignee_id: g('assignee_id').value || null, estimate_hours: g('estimate_hours').value, due_date: g('due_date').value, quote_cents: dollarsToCents(g('quote').value), billable: g('billable').checked }, 'Saved');
  });
  el.querySelector('#tf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    try { await api(`/api/requests/${id}/time`, { method: 'POST', body: { hours: Number(f.hours.value), note: f.note.value } }); reload(); } catch (err) { fail(err); }
  });
}
