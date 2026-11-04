import { api, html, render, money, pill, ago, date, modal, field, toast, fail, state, dollarsToCents } from '../lib.js';

export const JOB_STATUS = ['enquiry', 'quoted', 'booked', 'shot', 'editing', 'delivered', 'complete', 'lost'];
export const CAT = { photo: 'Photo', video: 'Video', photo_video: 'Photo + video' };
const PILL = { enquiry: 'info', quoted: 'warn', booked: '', shot: 'dark', editing: 'dark', delivered: '', complete: 'grey', lost: 'grey' };
export const jobPill = (s) => html`<span class="pill ${PILL[s] ?? ''}">${s}</span>`;
const when = (j) => `${j.shoot_date ? date(j.shoot_date) : 'Date TBC'}${j.start_time ? ` · ${j.start_time}` : ''}`;

export async function newJob(prefill = {}) {
  const [clients, packages, team] = await Promise.all([api('/api/clients'), api('/api/studio/packages'), api('/api/team')]);
  const v = await modal({ title: 'New shoot', submit: 'Create', wide: true, body: html`
    <div class="two">${field('Existing client', 'client_id', { type: 'select', value: prefill.client || '', options: [['', '+ New client'], ...clients.map((c) => [c.id, c.name])] })}${field('Title', 'title', { required: true, placeholder: 'e.g. Annual gala photography' })}</div>
    <div class="two" id="newc">${field('New client: business or name', 'client_name')}${field('Contact name', 'contact_name')}</div>
    <div class="two" id="newc2">${field('Client email', 'client_email', { type: 'email' })}${field('Client phone', 'client_phone')}</div>
    <div class="two">${field('Type', 'category', { type: 'select', options: Object.entries(CAT) })}${field('Shoot date', 'shoot_date', { type: 'date' })}</div>
    <div class="two">${field('Location', 'location')}${field('Owner (emails come from them)', 'owner_id', { type: 'select', value: state.user.id, options: team.map((u) => [u.id, u.name]) })}</div>
    <label class="f">Packages</label><div class="grid g2" style="gap:6px">${packages.filter((p) => p.active).map((p) => html`<label class="check"><input type="checkbox" name="pkg_${p.id}"> ${p.name} <span class="muted small">${money(p.price_cents)}</span></label>`)}</div>`,
    onOpen: (f) => { const t = () => { const n = !f.client_id.value; f.querySelector('#newc').style.display = n ? '' : 'none'; f.querySelector('#newc2').style.display = n ? '' : 'none'; }; f.client_id.onchange = t; t(); } });
  if (!v) return;
  const package_ids = Object.keys(v).filter((k) => k.startsWith('pkg_') && v[k]).map((k) => Number(k.slice(4)));
  const plans = await api('/api/studio/payment-plans'), contracts = await api('/api/studio/contract-templates'), wfs = await api('/api/studio/workflows'), qs = await api('/api/studio/questionnaires');
  const firstActive = (l) => l.filter((x) => x.active).sort((a, b) => a.id - b.id)[0]?.id || null; // the original/standard template
  try {
    const job = await api('/api/studio/jobs', { method: 'POST', body: { ...v, client_id: v.client_id || null, package_ids, payment_plan_id: firstActive(plans), contract_template_id: firstActive(contracts), workflow_id: firstActive(wfs), questionnaire_id: firstActive(qs) } });
    location.hash = `#/studio/jobs/${job.id}`;
  } catch (e) { fail(e); }
}

export async function overview(el, _p, q) {
  const mine = q.get('mine') === '1';
  const status = q.get('status') || 'active';
  const [o, jobs] = await Promise.all([api(`/api/studio/overview${mine ? '?mine=1' : ''}`), api(`/api/studio/jobs?status=${status}${mine ? `&owner=${state.user.id}` : ''}`)]);
  const c = o.counts;
  render(el, html`<div class="page-head"><div><h1>Photo + video <em>studio</em></h1><p>Enquiries, quotes, bookings, payments and delivery for shoots.</p></div>
    <div class="row"><a class="btn sm ${mine ? 'primary' : ''}" href="#/studio?${mine ? '' : 'mine=1'}">${mine ? '✓ ' : ''}My shoots only</a><a class="btn" href="#/studio/calendar">Calendar</a><button class="btn primary" id="new">+ New shoot</button></div></div>
    <div class="grid g4">
      <a class="stat" href="#/studio?status=enquiry"><div class="k">New enquiries</div><div class="v">${c.enquiry || 0}</div><div class="s">waiting for a quote</div></a>
      <a class="stat" href="#/studio?status=quoted"><div class="k">Quotes out</div><div class="v">${c.quoted || 0}</div><div class="s">waiting for the client</div></a>
      <a class="stat" style="background:var(--charcoal);color:var(--ivory);border-color:var(--charcoal)" href="#/studio?status=booked"><div class="k">Booked</div><div class="v">${(c.booked || 0) + (c.shot || 0) + (c.editing || 0)}</div><div class="s">${c.editing || 0} in editing</div></a>
      <a class="stat" href="#/invoices?status=sent"><div class="k">Unpaid shoot invoices</div><div class="v">${o.unpaid_invoices}</div><div class="s">${o.scheduled_invoices} more scheduled</div></a>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Coming up</h2><a class="small" href="#/studio/calendar">Calendar</a></div>
        ${o.upcoming.length ? html`<table class="t">${o.upcoming.map((j) => html`<tr class="click" data-job="${j.id}"><td class="nowrap"><strong>${date(j.shoot_date)}</strong><div class="muted small">${j.start_time || ''}</div></td><td><strong>${j.title}</strong><div class="muted small">${j.client_name}${j.location ? ` · ${j.location}` : ''}${j.owner_name ? ` · ${j.owner_name}` : ''}</div></td><td class="right">${jobPill(j.status)}</td></tr>`)}</table>` : html`<div class="empty">Nothing in the next 45 days.</div>`}</div>
      <div class="card"><div class="card-head"><h2>Tasks</h2><span class="muted small">overdue and next 7 days</span></div>
        ${o.tasks.length ? o.tasks.map((t) => html`<div class="row" style="padding:6px 0;border-bottom:1px solid #f1efea;flex-wrap:nowrap"><input type="checkbox" data-done="${t.id}" title="Mark done"><span style="flex:1"><strong>${t.name}</strong><div class="muted small"><a href="#/studio/jobs/${t.job_id}">${t.job_title}</a> · ${t.client_name}</div></span><span class="small nowrap ${t.due_date && t.due_date < new Date().toISOString().slice(0, 10) ? '' : 'muted'}" style="${t.due_date && t.due_date < new Date().toISOString().slice(0, 10) ? 'color:var(--danger);font-weight:600' : ''}">${t.due_date ? date(t.due_date) : 'no date'}</span></div>`) : html`<div class="empty">No tasks due. 🎉</div>`}</div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Shoots</h2><div class="row">${[['active', 'Active'], ...JOB_STATUS.map((s) => [s, s])].map(([k, l]) => html`<a class="btn sm ${k === status ? 'primary' : ''}" style="text-transform:capitalize" href="#/studio?status=${k}${mine ? '&mine=1' : ''}">${l}</a>`)}</div></div>
      ${jobs.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Shoot</th><th>When</th><th>Status</th><th>Owner</th><th class="n">Total inc GST</th></tr></thead><tbody>${jobs.map((j) => html`<tr class="click" data-job="${j.id}"><td><strong>${j.title}</strong><div class="muted small">${j.client_name} · ${CAT[j.category]}${j.contract_status === 'signed' ? ' · ✍️ signed' : ''}${j.unpaid ? ` · ${j.unpaid} unpaid` : ''}</div></td><td class="nowrap">${when(j)}</td><td>${jobPill(j.status)}</td><td class="small">${j.owner_name || '—'}</td><td class="n">${j.total_cents ? money(j.total_cents) : '—'}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty"><h3>No shoots here</h3><p>Add one, or share your enquiry form so new enquiries arrive here automatically.</p></div>`}</div>
    <div class="card mt"><div class="card-head"><h2>Enquiry form</h2><a class="btn sm" href="/enquiry" target="_blank" rel="noopener">Open ↗</a></div>
      <p class="muted small" style="margin-top:0">New enquiries create a client and a shoot here, notify you, and get a friendly reply from the owner. Link to it, or embed it on kess.media:</p>
      <input class="i mono" readonly value="${`<iframe src="${location.origin}/enquiry?embed=1" style="width:100%;height:980px;border:0" title="Enquiry form"></iframe>`}" onclick="this.select()"></div>`);
  el.querySelector('#new').onclick = () => newJob();
  el.querySelectorAll('[data-job]').forEach((tr) => tr.onclick = () => { location.hash = `#/studio/jobs/${tr.dataset.job}`; });
  el.querySelectorAll('[data-done]').forEach((cb) => cb.onchange = async () => { try { await api(`/api/studio/steps/${cb.dataset.done}`, { method: 'PATCH', body: { status: 'done' } }); toast('Done'); overview(el, _p, q); } catch (e) { fail(e); } });
  if (q.get('new')) { history.replaceState(null, '', '#/studio'); newJob({ client: q.get('client') }); }
}

export async function calendar(el, _p, q) {
  const month = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : new Date().toISOString().slice(0, 7);
  const jobs = await api(`/api/studio/calendar?month=${month}`);
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const label = first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayStr = new Date().toISOString().slice(0, 10);
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<div class="cal-cell off"></div>`);
  for (let d = 1; d <= days; d++) {
    const ds = `${month}-${String(d).padStart(2, '0')}`;
    const list = jobs.filter((j) => j.shoot_date === ds);
    cells.push(html`<div class="cal-cell ${ds === todayStr ? 'today' : ''}"><div class="cal-d">${d}</div>${list.map((j) => html`<a class="cal-ev s-${j.status}" href="#/studio/jobs/${j.id}" title="${j.title} · ${j.client_name}">${j.start_time ? `${j.start_time} ` : ''}${j.title}</a>`)}</div>`);
  }
  render(el, html`<style>.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}.cal-h{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:4px 6px}
    .cal-cell{background:#fff;border:1px solid var(--line);border-radius:8px;min-height:104px;padding:5px;overflow:hidden}.cal-cell.off{background:transparent;border-color:transparent}.cal-cell.today{border-color:var(--forest);box-shadow:inset 0 0 0 1px var(--forest)}
    .cal-d{font-size:12px;font-weight:700;color:var(--muted);margin-bottom:3px}.cal-ev{display:block;font-size:11.5px;line-height:1.3;padding:3px 6px;border-radius:5px;margin-bottom:3px;text-decoration:none;background:var(--sage);color:var(--forest);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
    .cal-ev.s-enquiry,.cal-ev.s-quoted{background:#FFF4D6;color:#9A6700;border:1px dashed #e0c36b}.cal-ev.s-booked{background:var(--forest);color:#fff}.cal-ev.s-shot,.cal-ev.s-editing{background:var(--charcoal);color:var(--mint)}
    @media(max-width:700px){.cal-cell{min-height:64px}.cal-ev{font-size:10px;padding:2px 4px}}</style>
    <div class="page-head"><div><div class="crumbs"><a href="#/studio">Studio</a> /</div><h1>${label}</h1><p>Dashed = holds (enquiries and quotes). Solid = booked.</p></div>
      <div class="row"><a class="btn" href="#/studio/calendar?month=${shift(-1)}">←</a><a class="btn" href="#/studio/calendar">Today</a><a class="btn" href="#/studio/calendar?month=${shift(1)}">→</a><button class="btn primary" id="sub">Add to my calendar</button></div></div>
    <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => html`<div class="cal-h">${d}</div>`)}${cells}</div>`);
  el.querySelector('#sub').onclick = async () => {
    const l = await api('/api/studio/calendar-link');
    modal({ title: 'Subscribe in Google, Apple or Outlook calendar', submit: '', cancel: 'Done', body: html`<p style="margin:0">Paste a link into your calendar app (Google Calendar: Other calendars → + → From URL). It updates by itself. Keep these private.</p>
      <label class="f">My shoots<input class="i mono" readonly value="${l.mine}" onclick="this.select()"></label><label class="f">All shoots (whole team)<input class="i mono" readonly value="${l.all}" onclick="this.select()"></label>` });
  };
  void dollarsToCents; void ago; void pill;
}
