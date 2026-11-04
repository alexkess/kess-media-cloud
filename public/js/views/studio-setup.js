import { api, html, raw, render, money, modal, field, toast, fail, esc, centsToDollars, dollarsToCents, date } from '../lib.js';
import { CAT } from './studio.js';

const TABS = [['packages', 'Packages'], ['contract-templates', 'Agreements'], ['payment-plans', 'Payment plans'], ['workflows', 'Workflows'], ['questionnaires', 'Questionnaires']];
const MERGE = '{{first_name}} {{contact_name}} {{client_name}} {{job_title}} {{shoot_date}} {{shoot_time}} {{location}} {{package}} {{total}} {{total_ex_gst}} {{deposit}} {{owner_name}} {{business_name}} {{today}} {{portal_link}}';

// Editable list of objects: fields = [{key, label, type: text|number|select|textarea|checkbox, options, width}]
function rowsEditor(rows, fields, { addLabel = '+ Add', empty = {} } = {}) {
  const wrap = document.createElement('div');
  const draw = () => {
    wrap.innerHTML = '';
    rows.forEach((r, i) => {
      const box = document.createElement('div');
      box.className = 'list-item';
      box.style.marginBottom = '8px';
      box.innerHTML = `<div class="row" style="align-items:flex-end">${fields.filter((f) => f.type !== 'textarea').map((f) => {
        const v = r[f.key] ?? '';
        const input = f.type === 'select' ? `<select class="i" data-k="${f.key}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`
          : f.type === 'checkbox' ? `<input type="checkbox" data-k="${f.key}" ${v ? 'checked' : ''}>`
            : `<input class="i" data-k="${f.key}" type="${f.type === 'number' ? 'number' : 'text'}" value="${esc(v)}" ${f.type === 'number' ? 'step="any"' : ''}>`;
        return `<label class="f" style="flex:${f.width || 1};min-width:${f.min || 80}px">${esc(f.label)}${input}</label>`;
      }).join('')}<div class="row" style="flex:none"><button type="button" class="btn sm ghost" data-up="${i}" title="Move up">↑</button><button type="button" class="btn sm ghost danger" data-rm="${i}">✕</button></div></div>
      ${fields.filter((f) => f.type === 'textarea').map((f) => `<label class="f" style="margin-top:6px">${esc(f.label)}<textarea class="i" rows="${f.rows || 3}" data-k="${f.key}">${esc(r[f.key] ?? '')}</textarea></label>`).join('')}`;
      box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('input', () => {
        const f = fields.find((x) => x.key === inp.dataset.k);
        r[f.key] = f.type === 'checkbox' ? inp.checked : f.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        wrap.dispatchEvent(new Event('change'));
      }));
      box.querySelector('[data-rm]').onclick = () => { rows.splice(i, 1); draw(); wrap.dispatchEvent(new Event('change')); };
      box.querySelector('[data-up]').onclick = () => { if (i) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); wrap.dispatchEvent(new Event('change')); } };
      wrap.appendChild(box);
    });
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn sm'; add.textContent = addLabel;
    add.onclick = () => { rows.push(structuredClone(empty)); draw(); wrap.dispatchEvent(new Event('change')); };
    wrap.appendChild(add);
  };
  draw();
  return wrap;
}

const PLAN_FIELDS = [
  { key: 'label', label: 'Invoice label', width: 2, min: 160 },
  { key: 'percent', label: '% of total', type: 'number', min: 70 },
  { key: 'when', label: 'Sent', type: 'select', width: 1.4, min: 140, options: [['accept', 'When booked'], ['before_shoot', 'Days before shoot'], ['after_shoot', 'Days after shoot']] },
  { key: 'days', label: 'Days', type: 'number', min: 60 },
  { key: 'due_days', label: 'Due after (days)', type: 'number', min: 90 },
];
const WF_FIELDS = [
  { key: 'name', label: 'Step', width: 2, min: 180 },
  { key: 'action', label: 'Type', type: 'select', options: [['task', 'Task for us'], ['email', 'Email to client']], min: 120 },
  { key: 'anchor', label: 'Relative to', type: 'select', options: [['booking', 'Booking date'], ['shoot', 'Shoot date']], min: 120 },
  { key: 'offset_days', label: 'Days (+/-)', type: 'number', min: 70 },
  { key: 'attach', label: 'Email button', type: 'select', options: [['portal', 'Booking page'], ['questionnaire', 'Questionnaire'], ['', 'None']], min: 120 },
  { key: 'subject', label: 'Email subject', width: 2, min: 160 },
  { key: 'body', label: 'Email message (blank line = new paragraph)', type: 'textarea', rows: 3 },
];
const Q_FIELDS = [
  { key: 'label', label: 'Question', width: 3, min: 200 },
  { key: 'type', label: 'Answer type', type: 'select', options: [['text', 'Short text'], ['textarea', 'Long text'], ['choice', 'Choice'], ['date', 'Date'], ['checkbox', 'Yes / no']], min: 120 },
  { key: 'options_text', label: 'Choices (comma separated)', width: 2, min: 150 },
  { key: 'required', label: 'Required', type: 'checkbox', min: 60 },
];

export default async function setup(el, _p, q) {
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'packages';
  const rows = await api(`/api/studio/${tab}`);
  const reload = () => setup(el, _p, q);
  const save = async (item, body) => {
    try { await api(item?.id ? `/api/studio/${tab}/${item.id}` : `/api/studio/${tab}`, { method: item?.id ? 'PATCH' : 'POST', body }); toast('Saved'); reload(); } catch (e) { fail(e); }
  };
  const list = {
    packages: () => html`<div class="grid g3">${rows.map((p) => html`<div class="card" style="${p.active ? '' : 'opacity:.55'};margin:0"><div class="card-head"><h2>${p.name}</h2><button class="btn sm" data-edit="${p.id}">Edit</button></div>
      <div class="score" style="font-size:24px;color:var(--forest)">${money(p.price_cents)} <span class="small muted" style="font-family:Inter;font-style:normal">ex GST</span></div><div class="muted small">${CAT[p.category]}${p.active ? '' : ' · hidden'}</div>
      <p class="small">${p.description || ''}</p><ul class="small" style="padding-left:18px;margin:0">${p.items.map((i) => html`<li>${i}</li>`)}</ul></div>`)}</div>`,
    'contract-templates': () => html`${rows.map((c) => html`<div class="card"><div class="card-head"><h2>${c.name}${c.active ? '' : ' (hidden)'}</h2><button class="btn sm" data-edit="${c.id}">Edit</button></div><div class="pre small muted" style="max-height:160px;overflow:hidden">${c.body.slice(0, 700)}…</div></div>`)}
      <div class="callout warn small">Starter agreements are plain-English starting points, not legal advice. Have yours reviewed by a lawyer.</div>`,
    'payment-plans': () => html`${rows.map((p) => html`<div class="card"><div class="card-head"><h2>${p.name}${p.active ? '' : ' (hidden)'}</h2><button class="btn sm" data-edit="${p.id}">Edit</button></div>
      <ul class="small" style="margin:0;padding-left:18px">${p.steps.map((s) => html`<li><strong>${s.label}</strong>: ${s.percent}% · ${s.when === 'accept' ? 'sent when booked' : `sent ${s.days} days ${s.when === 'before_shoot' ? 'before' : 'after'} the shoot`} · due ${s.due_days ?? 7} days later</li>`)}</ul></div>`)}`,
    workflows: () => html`${rows.map((w) => html`<div class="card"><div class="card-head"><h2>${w.name}${w.active ? '' : ' (hidden)'}</h2><button class="btn sm" data-edit="${w.id}">Edit</button></div>
      ${w.steps.map((s) => html`<div class="small" style="padding:3px 0">${s.action === 'email' ? '✉️' : '☐'} <strong>${s.name}</strong> <span class="muted">${Number(s.offset_days) === 0 ? 'on' : `${Math.abs(s.offset_days)} days ${s.offset_days < 0 ? 'before' : 'after'}`} ${s.anchor === 'shoot' ? 'the shoot' : 'booking'}</span></div>`)}</div>`)}`,
    questionnaires: () => html`${rows.map((x) => html`<div class="card"><div class="card-head"><h2>${x.name}${x.active ? '' : ' (hidden)'}</h2><button class="btn sm" data-edit="${x.id}">Edit</button></div><ol class="small" style="margin:0">${x.questions.map((qq) => html`<li>${qq.label}${qq.required ? ' *' : ''} <span class="muted">(${qq.type})</span></li>`)}</ol></div>`)}`,
  };
  render(el, html`<div class="page-head"><div><div class="crumbs"><a href="#/studio">Studio</a> /</div><h1>Studio <em>setup</em></h1><p>Templates used when you quote, book and run shoots.</p></div><button class="btn primary" id="add">+ New</button></div>
    <nav class="tabs">${TABS.map(([k, l]) => html`<a href="#/studio/setup?tab=${k}" class="${k === tab ? 'on' : ''}">${l}</a>`)}</nav>${list[tab]()}`);

  const edit = async (item) => {
    if (tab === 'packages') {
      const p = item || { name: '', category: 'photo', price_cents: 0, items: [], description: '', active: true };
      const v = await modal({ title: item ? 'Edit package' : 'New package', body: html`${field('Name', 'name', { value: p.name, required: true })}<div class="two">${field('Type', 'category', { type: 'select', value: p.category, options: Object.entries(CAT) })}${field('Price ex GST ($)', 'price', { type: 'number', value: centsToDollars(p.price_cents), required: true })}</div>
        ${field('Description', 'description', { type: 'textarea', value: p.description })}${field("What's included", 'items', { type: 'textarea', rows: 5, value: p.items.join('\n'), hint: 'one per line' })}${item ? field('Show in quotes and the enquiry form', 'active', { type: 'checkbox', value: p.active }) : ''}` });
      if (v) save(item, { name: v.name, category: v.category, price_cents: dollarsToCents(v.price), description: v.description, items: v.items.split('\n').map((s) => s.trim()).filter(Boolean), ...(item ? { active: v.active } : {}) });
      return;
    }
    if (tab === 'contract-templates') {
      const c = item || { name: '', body: '' };
      const v = await modal({ title: item ? 'Edit agreement' : 'New agreement', wide: true, body: html`${field('Name', 'name', { value: c.name, required: true })}${field('Agreement text', 'body', { type: 'textarea', rows: 18, value: c.body, required: true })}<p class="muted small" style="margin:0">Merge fields: <span class="mono">${MERGE}</span>. Signed agreements never change when you edit the template.</p>${item ? field('Available for new shoots', 'active', { type: 'checkbox', value: c.active }) : ''}` });
      if (v) save(item, { name: v.name, body: v.body, ...(item ? { active: v.active } : {}) });
      return;
    }
    const conf = { 'payment-plans': { key: 'steps', fields: PLAN_FIELDS, empty: { label: 'Payment', percent: 50, when: 'accept', days: 0, due_days: 7 }, title: 'payment plan' },
      workflows: { key: 'steps', fields: WF_FIELDS, empty: { name: 'New step', action: 'task', anchor: 'shoot', offset_days: -1, attach: 'portal' }, title: 'workflow' },
      questionnaires: { key: 'questions', fields: Q_FIELDS, empty: { label: 'New question', type: 'text', required: false }, title: 'questionnaire' } }[tab];
    const base = item ? structuredClone(item) : { name: '', [conf.key]: [], intro: '', active: true };
    let rowsData = base[conf.key];
    if (tab === 'questionnaires') rowsData = rowsData.map((x) => ({ ...x, options_text: (x.options || []).join(', ') }));
    await modal({ title: `${item ? 'Edit' : 'New'} ${conf.title}`, wide: true, submit: 'Save', body: html`${field('Name', 'name', { value: base.name, required: true })}${tab === 'questionnaires' ? field('Intro for the client', 'intro', { type: 'textarea', value: base.intro || '' }) : ''}<div id="rows"></div>
      ${tab === 'payment-plans' ? html`<div class="callout small" id="pv"></div><p class="muted small" style="margin:0">The last payment always takes whatever is left, so the total is exact. Invoices sent “before the shoot” fall due no later than the shoot date.</p>` : ''}
      ${tab === 'workflows' ? html`<p class="muted small" style="margin:0">Emails go out automatically from the shoot owner on the day. Tasks show on the Studio page. Merge fields work in subjects and messages: <span class="mono">${MERGE}</span></p>` : ''}
      ${item ? field('Available for new shoots', 'active', { type: 'checkbox', value: base.active }) : ''}`,
      onOpen: (form, close) => {
        const editor = rowsEditor(rowsData, conf.fields, { empty: conf.empty });
        form.querySelector('#rows').appendChild(editor);
        const pv = form.querySelector('#pv');
        const preview = async () => {
          if (!pv) return;
          const shoot = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
          try {
            const sched = await api('/api/studio/payment-plans/preview', { method: 'POST', body: { steps: rowsData, shoot_date: shoot, subtotal_cents: 300000 } });
            const pct = rowsData.reduce((n, r) => n + (Number(r.percent) || 0), 0);
            render(pv, html`<strong>Example:</strong> a $3,000 + GST shoot on ${date(shoot)}${pct !== 100 ? html` <span style="color:var(--danger)">(percentages add to ${pct}%)</span>` : ''}<br>${sched.map((s) => html`${s.label}: ${money(s.cents)} + GST, sent ${date(s.send_on)}, due ${date(s.due_date)}<br>`)}`);
          } catch {}
        };
        editor.addEventListener('change', preview); preview();
        form.addEventListener('submit', (e) => {
          e.preventDefault(); e.stopImmediatePropagation();
          const name = form.elements.namedItem('name').value.trim();
          if (!name) return toast('Name is required', true);
          let data = rowsData;
          if (tab === 'questionnaires') data = rowsData.map(({ options_text, ...x }, i) => ({ ...x, id: x.id || `q${Date.now().toString(36)}${i}`, options: x.type === 'choice' ? String(options_text || '').split(',').map((s) => s.trim()).filter(Boolean) : undefined }));
          close(null);
          save(item, { name, [conf.key]: data, ...(tab === 'questionnaires' ? { intro: form.elements.namedItem('intro').value } : {}), ...(item ? { active: form.elements.namedItem('active').checked } : {}) });
        }, { capture: true });
      } });
  };
  el.querySelector('#add').onclick = () => edit(null);
  el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => edit(rows.find((r) => String(r.id) === b.dataset.edit)));
  void raw;
}
