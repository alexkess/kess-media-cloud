import { api, html, render, money, pill, ago, date, modal, field, toast, fail, confirmBox, isOwner, centsToDollars, dollarsToCents, esc } from '../lib.js';
import { JOB_STATUS, CAT, jobPill } from './studio.js';

const PROVIDER_ICON = { dropbox: '📦', google_drive: '🟢', picflow: '🖼', vimeo: '🎬', frameio: '🎞', youtube: '▶️', pictime: '📸', pixieset: '📸', wetransfer: '📤', onedrive: '☁️', smugmug: '📸', link: '🔗' };

export default async function jobView(el, { id }) {
  const [job, packages, plans, contracts, workflows, questionnaires, team] = await Promise.all([
    api(`/api/studio/jobs/${id}`), api('/api/studio/packages'), api('/api/studio/payment-plans'), api('/api/studio/contract-templates'),
    api('/api/studio/workflows'), api('/api/studio/questionnaires'), api('/api/team')]);
  const reload = () => jobView(el, { id });
  const call = async (p, opts, msg) => { try { await api(p, opts); if (msg) toast(msg); reload(); } catch (e) { fail(e); } };
  const booked = ['booked', 'shot', 'editing', 'delivered', 'complete'].includes(job.status);
  const opt = (list, cur, none) => [['', none], ...list.filter((x) => x.active || x.id === cur).map((x) => [x.id, x.name])];
  const todayStr = new Date().toISOString().slice(0, 10);
  const t = job.totals;

  render(el, html`<div class="crumbs"><a href="#/studio">Studio</a> / <a href="#/clients/${job.client.id}">${job.client.name}</a> /</div>
    <div class="page-head"><div><h1>${job.title}</h1><p>${jobPill(job.status)} · ${CAT[job.category]} · ${job.shoot_date ? date(job.shoot_date) : 'date TBC'}${job.start_time ? ` ${job.start_time}${job.end_time ? `–${job.end_time}` : ''}` : ''}${job.location ? ` · ${job.location}` : ''} · owner ${job.owner?.name || '—'}</p></div>
      <div class="row"><a class="btn" href="${job.portal_url}" target="_blank" rel="noopener">Client page ↗</a><button class="btn" id="email">Email client</button>
      ${!booked && job.status !== 'lost' ? html`<button class="btn" id="book">Mark as booked</button><button class="btn primary" id="sendq">${job.quote_sent_at ? 'Resend quote' : 'Send quote'}</button>` : ''}</div></div>
    ${!job.client.email ? html`<div class="callout warn" style="margin-bottom:14px">${job.client.name} has no email address, so nothing can be sent yet. <a href="#/clients/${job.client.id}">Add it on the client</a>.</div>` : ''}
    <div class="grid g-side"><div>
      <div class="card"><div class="card-head"><h2>Quote</h2><span class="muted small">${job.quote_sent_at ? `sent ${ago(job.quote_sent_at)}` : 'not sent yet'}${job.accepted_at ? ` · accepted ${ago(job.accepted_at)}` : ''}</span></div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Item</th><th style="width:70px">Qty</th><th style="width:120px">Price ex GST</th><th style="width:80px">Optional</th><th></th></tr></thead><tbody>
        ${job.lines.map((l) => html`<tr><td><input class="i" data-l="${l.id}" data-k="description" value="${l.description}"><textarea class="i small" rows="2" data-l="${l.id}" data-k="details" style="margin-top:4px;min-height:0" placeholder="What's included (one per line)">${l.details || ''}</textarea></td>
          <td><input class="i right" type="number" step="0.5" min="0" data-l="${l.id}" data-k="qty" value="${l.qty}"></td><td><input class="i right" type="number" step="1" min="0" data-l="${l.id}" data-k="unit" value="${centsToDollars(l.unit_cents)}"></td>
          <td><label class="check"><input type="checkbox" data-l="${l.id}" data-k="optional" ${l.optional ? 'checked' : ''}> ${l.optional ? (l.selected ? 'chosen' : 'offered') : ''}</label></td><td><button class="btn sm ghost danger" data-rm="${l.id}">✕</button></td></tr>`)}
        ${!job.lines.length ? html`<tr><td colspan="5" class="muted">No items yet. Add a package or a custom line.</td></tr>` : ''}</tbody></table></div>
        <div class="row between mt"><div class="row"><select class="i" id="pkg" style="width:auto"><option value="">+ Add a package…</option>${packages.filter((p) => p.active).map((p) => html`<option value="${p.id}">${p.name} (${money(p.price_cents)})</option>`)}</select><button class="btn sm" id="addline">+ Custom line</button></div>
          <div class="right"><div class="muted small">Subtotal ${money(t.subtotal_cents)} · GST ${money(t.gst_cents)}</div><div style="font-size:18px;font-weight:800;color:var(--forest)">${money(t.total_cents)} inc GST</div></div></div>
        <p class="muted small">Optional items appear as add-ons the client can tick when they book.</p></div>

      <div class="card"><div class="card-head"><h2>Agreement</h2>${job.contract ? pill(job.contract.status === 'signed' ? 'paid' : 'sent', job.contract.status === 'signed' ? 'signed' : 'waiting for signature') : ''}</div>
        ${job.contract ? html`${job.contract.status === 'signed' ? html`<p style="margin-top:0">✍️ Signed by <strong>${job.contract.signed_name}</strong> on ${date(job.contract.signed_at)} (${ago(job.contract.signed_at)}) from IP ${job.contract.signed_ip || '—'}. Countersigned: ${job.contract.agency_signer}.</p>` : html`<p class="muted" style="margin-top:0">The client signs on their booking page when they confirm. Changed the quote or template? Refresh it before they sign.</p>`}
          <details><summary class="small">Read the agreement</summary><div class="pre small card" style="max-height:340px;overflow:auto;margin-top:8px">${job.contract.body}</div></details>
          ${job.contract.status !== 'signed' ? html`<button class="btn sm mt" id="contract">Refresh from template</button>` : ''}`
        : html`<p class="muted" style="margin-top:0">${job.contract_template_id ? 'The agreement is created from the template when you send the quote.' : 'No agreement template chosen for this shoot (see Details).'}</p>${job.contract_template_id ? html`<button class="btn sm" id="contract">Prepare now</button>` : ''}`}</div>

      <div class="card"><div class="card-head"><h2>Payments</h2>${job.invoices.length ? '' : booked ? html`<button class="btn sm primary" id="mkinv">Create invoices from plan</button>` : html`<span class="muted small">created automatically when booked</span>`}</div>
        ${job.invoices.length ? html`<table class="t"><tbody>${job.invoices.map((i) => html`<tr><td><strong>${i.plan_label || i.notes}</strong><div class="muted small"><a href="#/invoices/${i.id}">${i.number}</a> · ${i.status === 'draft' ? `sends automatically ${date(i.send_on)}` : `due ${date(i.due_date)}`}${i.paid_via === 'stripe' ? ' · paid by card' : ''}</div></td>
          <td class="n">${money(i.total_cents)}</td><td>${pill(i.overdue ? 'overdue' : i.status === 'draft' ? 'draft' : i.status, i.status === 'draft' ? 'scheduled' : i.overdue ? 'overdue' : i.status)}</td>
          <td class="right"><div class="row end">${i.status === 'draft' ? html`<button class="btn sm" data-sendinv="${i.id}">Send now</button>` : i.status === 'sent' ? html`<button class="btn sm" data-remind="${i.id}" data-kind="${i.overdue ? 'overdue' : 'due'}">Remind</button><button class="btn sm" data-paid="${i.id}">Mark paid</button>` : ''}
          ${i.public_token && i.status !== 'draft' ? html`<button class="btn sm ghost" data-copy="${location.origin}/i/${i.public_token}">Copy pay link</button>` : ''}</div></td></tr>`)}</tbody></table>
          <p class="muted small">Scheduled invoices email themselves on the date shown, from ${job.owner?.name || 'the owner'}. Reminders go 3 days before due and weekly once overdue.</p>` : html`<p class="muted" style="margin:0">Payment plan: <strong>${plans.find((p) => p.id === job.payment_plan_id)?.name || 'full payment on booking'}</strong>.</p>`}</div>

      <div class="card"><div class="card-head"><h2>Workflow</h2><button class="btn sm" id="addtask">+ Task</button></div>
        ${job.steps.length ? job.steps.map((s) => html`<div class="row" style="padding:7px 0;border-bottom:1px solid #f1efea;flex-wrap:nowrap;align-items:flex-start">
          <span title="${s.action}" style="width:22px">${s.action === 'email' ? '✉️' : '☐'}</span>
          <span style="flex:1;${s.status !== 'pending' ? 'text-decoration:line-through;color:var(--muted)' : ''}"><strong>${s.name}</strong>${s.action === 'email' ? html`<div class="muted small">${s.status === 'done' ? `sent ${ago(s.done_at)}` : `emails the client automatically${s.subject ? `: “${s.subject}”` : ''}`}</div>` : ''}</span>
          <span class="small nowrap" style="${s.status === 'pending' && s.due_date && s.due_date < todayStr ? 'color:var(--danger);font-weight:600' : ''}">${s.due_date ? date(s.due_date) : '—'}</span>
          <span class="row" style="flex-wrap:nowrap">${s.status === 'pending' ? html`${s.action === 'email' ? html`<button class="btn sm" data-run="${s.id}">Send now</button>` : html`<button class="btn sm" data-step="${s.id}" data-to="done">Done</button>`}<button class="btn sm ghost" data-step="${s.id}" data-to="skipped" title="Skip">Skip</button>` : html`<button class="btn sm ghost" data-step="${s.id}" data-to="pending">Undo</button>`}</span></div>`)
          : html`<p class="muted" style="margin:0">${job.workflow_id ? 'Steps are scheduled when the shoot is booked.' : 'No workflow chosen (see Details).'}</p>`}</div>

      ${job.questionnaire ? html`<div class="card"><div class="card-head"><h2>${job.questionnaire.questions.name || 'Questionnaire'}</h2>${job.questionnaire.submitted_at ? pill('paid', `answered ${ago(job.questionnaire.submitted_at)}`) : pill('draft', 'not answered yet')}</div>
        ${(job.questionnaire.questions.questions || []).map((qq) => html`<div style="padding:6px 0;border-bottom:1px solid #f1efea"><div class="muted small">${qq.label}</div><div class="pre">${(() => { const a = job.questionnaire.answers[qq.id]; return a === true ? 'Yes' : a === false ? 'No' : a || '—'; })()}</div></div>`)}</div>` : ''}

      <div class="card"><div class="card-head"><h2>Files and delivery</h2></div>
        ${job.deliveries.map((d) => html`<div class="row between" style="padding:8px 0;border-bottom:1px solid #f1efea"><span>${PROVIDER_ICON[d.provider] || '🔗'} <strong>${d.label || d.provider_label}</strong> <span class="muted small">${d.provider_label}${d.embed ? ' · plays on the client page' : ''}${d.note ? ` · ${d.note}` : ''}</span></span><span class="row"><a class="btn sm" href="${d.url}" target="_blank" rel="noopener">Open ↗</a><button class="btn sm ghost danger" data-deldel="${d.id}">✕</button></span></div>`)}
        <form id="deliv" class="form mt"><div class="two">${field('Link (Dropbox, Google Drive, Picflow, Vimeo, Frame.io, Pic-Time…)', 'url', { required: true, placeholder: 'https://' })}${field('Label', 'label', { placeholder: 'e.g. Full gallery, Highlight film' })}</div>
          ${field('Note for the client', 'note', { placeholder: 'e.g. Password: gala2026, available for 60 days' })}
          <div class="row between">${field('Email the client that it is ready (and mark as delivered)', 'notify', { type: 'checkbox', value: true })}<button class="btn primary">Add</button></div></form></div>
    </div><div>
      <form class="card form" id="details"><h2>Details</h2>
        ${field('Title', 'title', { value: job.title, required: true })}
        <div class="two">${field('Status', 'status', { type: 'select', value: job.status, options: JOB_STATUS })}${field('Type', 'category', { type: 'select', value: job.category, options: Object.entries(CAT) })}</div>
        ${field('Shoot date', 'shoot_date', { type: 'date', value: job.shoot_date || '' })}
        <div class="two">${field('Start', 'start_time', { type: 'time', value: job.start_time || '' })}${field('Finish', 'end_time', { type: 'time', value: job.end_time || '' })}</div>
        ${field('Location', 'location', { value: job.location || '' })}
        ${field('Owner (emails come from them)', 'owner_id', { type: 'select', value: job.owner_id || '', options: [['', '—'], ...team.map((u) => [u.id, u.name])] })}
        ${field('Payment plan', 'payment_plan_id', { type: 'select', value: job.payment_plan_id || '', options: opt(plans, job.payment_plan_id, 'Full payment on booking') })}
        ${field('Agreement', 'contract_template_id', { type: 'select', value: job.contract_template_id || '', options: opt(contracts, job.contract_template_id, 'No agreement') })}
        ${field('Workflow', 'workflow_id', { type: 'select', value: job.workflow_id || '', options: opt(workflows, job.workflow_id, 'No workflow') })}
        ${field('Questionnaire', 'questionnaire_id', { type: 'select', value: job.questionnaire_id || '', options: opt(questionnaires, job.questionnaire_id, 'None') })}
        ${field('Internal notes', 'notes', { type: 'textarea', value: job.notes || '', rows: 4 })}
        <div class="row between"><button class="btn primary">Save</button>${isOwner() ? html`<button type="button" class="btn sm danger" id="del">Delete</button>` : ''}</div></form>
      <div class="card"><h2>Client</h2><div class="stack small mt"><div><strong>${job.client.contact_name || job.client.name}</strong><br>${job.client.name}</div>
        ${job.client.email ? html`<div><a href="mailto:${job.client.email}">${job.client.email}</a></div>` : ''}${job.client.phone ? html`<div>${job.client.phone}</div>` : ''}
        <div><button class="btn sm" id="copyportal">Copy client page link</button></div></div></div>
      <div class="card"><h2>Timeline</h2><div class="mt">${job.events.map((e) => html`<div class="small" style="padding:5px 0;border-bottom:1px solid #f1efea"><strong>${e.who}</strong> ${e.action.replace(/[._]/g, ' ')}${e.detail ? html`<div class="muted">${e.detail}</div>` : ''}<div class="muted">${ago(e.created_at)}</div></div>`)}</div></div>
    </div></div>`);

  // quote lines
  el.querySelectorAll('[data-l]').forEach((inp) => inp.addEventListener('change', () => {
    const k = inp.dataset.k;
    const body = k === 'unit' ? { unit_cents: dollarsToCents(inp.value) || 0 } : k === 'optional' ? { optional: inp.checked, selected: !inp.checked } : { [k]: k === 'qty' ? Number(inp.value) : inp.value };
    call(`/api/studio/jobs/${id}/lines/${inp.dataset.l}`, { method: 'PATCH', body });
  }));
  el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => call(`/api/studio/jobs/${id}/lines/${b.dataset.rm}`, { method: 'DELETE' }));
  el.querySelector('#pkg').onchange = (e) => e.target.value && call(`/api/studio/jobs/${id}/lines`, { method: 'POST', body: { package_id: Number(e.target.value) } }, 'Package added');
  el.querySelector('#addline').onclick = async () => {
    const v = await modal({ title: 'Custom line', body: html`${field('Description', 'description', { required: true })}${field('Details', 'details', { type: 'textarea' })}<div class="two">${field('Price ex GST ($)', 'price', { type: 'number', required: true })}${field('Quantity', 'qty', { type: 'number', value: 1 })}</div>${field('Optional add-on', 'optional', { type: 'checkbox' })}` });
    if (v) call(`/api/studio/jobs/${id}/lines`, { method: 'POST', body: { ...v, unit_cents: dollarsToCents(v.price) } });
  };
  // actions
  el.querySelector('#sendq')?.addEventListener('click', async () => {
    const v = await modal({ title: `Send quote to ${job.client.email || job.client.name}`, submit: 'Send', wide: true, body: html`<p class="muted" style="margin:0">Sent from <strong>${job.owner?.name || 'you'}</strong>. Includes a button to their booking page with the quote${job.contract_template_id ? ', agreement to sign' : ''} and online booking. Merge fields like {{first_name}} work here.</p>
      ${field('Subject', 'subject', { value: 'Your quote for {{job_title}}' })}${field('Message', 'message', { type: 'textarea', rows: 7, value: `Hi {{first_name}},\n\nThanks for getting in touch. Here's your quote for {{job_title}}${job.shoot_date ? ' on {{shoot_date}}' : ''}.\n\nYou can review everything${job.contract_template_id ? ', sign the agreement' : ''} and confirm your booking online.` })}` });
    if (v) call(`/api/studio/jobs/${id}/send-quote`, { method: 'POST', body: v }, 'Quote sent');
  });
  el.querySelector('#book')?.addEventListener('click', async () => {
    if (await confirmBox('Mark as booked?', 'Use this if the client booked by phone or email. Invoices from the payment plan are created (the first one is emailed now) and the workflow starts.', 'Mark booked')) call(`/api/studio/jobs/${id}/book`, { method: 'POST', body: {} }, 'Booked');
  });
  el.querySelector('#email').onclick = async () => {
    const v = await modal({ title: `Email ${job.client.contact_name || job.client.name}`, submit: 'Send', wide: true, body: html`<p class="muted" style="margin:0">From ${job.owner?.name || 'the owner'}; replies go to them. Merge fields: {{first_name}}, {{shoot_date}}, {{location}}, {{portal_link}}…</p>${field('Subject', 'subject', { required: true })}${field('Message', 'body', { type: 'textarea', rows: 8, required: true, value: 'Hi {{first_name}},\n\n' })}${field('Include a button to their booking page', 'include_link', { type: 'checkbox', value: true })}` });
    if (v) call(`/api/studio/jobs/${id}/email`, { method: 'POST', body: v }, 'Email sent');
  };
  el.querySelector('#contract')?.addEventListener('click', () => call(`/api/studio/jobs/${id}/contract`, { method: 'POST', body: {} }, 'Agreement updated'));
  el.querySelector('#mkinv')?.addEventListener('click', () => call(`/api/studio/jobs/${id}/invoices`, { method: 'POST', body: {} }, 'Invoices created'));
  el.querySelectorAll('[data-sendinv]').forEach((b) => b.onclick = () => call(`/api/invoices/${b.dataset.sendinv}/email`, { method: 'POST', body: { kind: 'new' } }, 'Invoice emailed'));
  el.querySelectorAll('[data-remind]').forEach((b) => b.onclick = () => call(`/api/invoices/${b.dataset.remind}/email`, { method: 'POST', body: { kind: b.dataset.kind } }, 'Reminder sent'));
  el.querySelectorAll('[data-paid]').forEach((b) => b.onclick = () => call(`/api/invoices/${b.dataset.paid}`, { method: 'PATCH', body: { status: 'paid' } }, 'Marked paid'));
  el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link copied'); });
  el.querySelector('#copyportal').onclick = () => { navigator.clipboard?.writeText(job.portal_url); toast('Client page link copied'); };
  el.querySelectorAll('[data-step]').forEach((b) => b.onclick = () => call(`/api/studio/steps/${b.dataset.step}`, { method: 'PATCH', body: { status: b.dataset.to } }));
  el.querySelectorAll('[data-run]').forEach((b) => b.onclick = () => call(`/api/studio/steps/${b.dataset.run}`, { method: 'PATCH', body: { run: true } }, 'Email sent'));
  el.querySelector('#addtask').onclick = async () => {
    const v = await modal({ title: 'Add a task', body: html`${field('Task', 'name', { required: true })}${field('Due', 'due_date', { type: 'date' })}` });
    if (v) call(`/api/studio/jobs/${id}/steps`, { method: 'POST', body: v }, 'Task added');
  };
  el.querySelector('#deliv').onsubmit = (e) => { e.preventDefault(); const f = e.target.elements; call(`/api/studio/jobs/${id}/deliveries`, { method: 'POST', body: { url: f.url.value, label: f.label.value, note: f.note.value, notify: f.notify.checked } }, f.notify.checked ? 'Added and client emailed' : 'Added'); };
  el.querySelectorAll('[data-deldel]').forEach((b) => b.onclick = () => call(`/api/studio/jobs/${id}/deliveries/${b.dataset.deldel}`, { method: 'DELETE' }));
  el.querySelector('#details').onsubmit = (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    call(`/api/studio/jobs/${id}`, { method: 'PATCH', body }, 'Saved');
  };
  el.querySelector('#del')?.addEventListener('click', async () => {
    if (!await confirmBox('Delete this shoot?', 'Only possible before any invoice is sent. Consider marking it lost instead.', 'Delete')) return;
    try { await api(`/api/studio/jobs/${id}`, { method: 'DELETE' }); location.hash = '#/studio'; } catch (err) { fail(err); }
  });
  void esc;
}
