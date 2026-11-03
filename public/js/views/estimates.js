import { api, html, render, kRange, money, ago, modal, field, toast, fail, confirmBox, isOwner, centsToDollars, dollarsToCents } from '../lib.js';

const STARTER = {
  'Website build': { discount_pct: 0, groups: [
    { name: 'Discovery and design', items: [{ name: 'Discovery workshop, sitemap and content plan', hours_low: 4, hours_high: 6 }, { name: 'Design: home page + key templates', hours_low: 12, hours_high: 18 }] },
    { name: 'Build (Astro + Sanity)', items: [{ name: 'Front-end build', hours_low: 20, hours_high: 28 }, { name: 'Sanity CMS setup and editor training', hours_low: 5, hours_high: 8 }, { name: 'Content load', hours_low: 4, hours_high: 8 }, { name: 'Accessibility, SEO and speed pass', hours_low: 4, hours_high: 6 }, { name: 'Launch, DNS and redirects', hours_low: 2, hours_high: 3 }] },
    { name: 'Add-ons', items: [{ name: 'Copywriting (per page)', hours_low: 2, hours_high: 3, kind: 'addon' }, { name: 'Photography half day', hours_low: 5, hours_high: 6, kind: 'addon' }, { name: 'Multilingual (per language)', hours_low: 8, hours_high: 14, kind: 'addon' }] },
  ] },
  'Photo and video': { discount_pct: 0, groups: [
    { name: 'Production', items: [{ name: 'Pre-production and shot list', hours_low: 2, hours_high: 4 }, { name: 'Shoot day', hours_low: 8, hours_high: 10 }] },
    { name: 'Post', items: [{ name: 'Edit: hero video (60–90s)', hours_low: 8, hours_high: 14 }, { name: 'Social cut-downs (x3)', hours_low: 3, hours_high: 5 }, { name: 'Photo selects and retouching', hours_low: 3, hours_high: 6 }] },
  ] },
  Blank: { discount_pct: 0, groups: [{ name: 'Scope', items: [] }] },
};

export async function list(el) {
  const [rows, clients] = await Promise.all([api('/api/estimates'), api('/api/clients')]);
  render(el, html`<div class="page-head"><div><h1>Estimates</h1><p>Ballpark ranges for proposals. Hours and rate stay internal, clients only see rounded ranges ex GST.</p></div><button class="btn primary" id="new">+ New estimate</button></div>
    <div class="card table-wrap">${rows.length ? html`<table class="t"><thead><tr><th>Estimate</th><th>Client</th><th>Range (core, ex GST)</th><th>Updated</th></tr></thead><tbody>${rows.map((e) => html`<tr class="click" data-id="${e.id}"><td><strong>${e.title}</strong></td><td>${e.client_name || '—'}</td><td>${e.range}</td><td class="muted small">${ago(e.updated_at)}</td></tr>`)}</tbody></table>` : html`<div class="empty"><h3>No estimates yet</h3></div>`}</div>`);
  el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => { location.hash = `#/estimates/${tr.dataset.id}`; });
  el.querySelector('#new').onclick = async () => {
    const v = await modal({ title: 'New estimate', submit: 'Create', body: html`${field('Title', 'title', { required: true, placeholder: 'e.g. ADS website' })}${field('Client', 'client_id', { type: 'select', options: [['', 'None'], ...clients.map((c) => [c.id, c.name])] })}${field('Start from', 'starter', { type: 'select', options: Object.keys(STARTER) })}` });
    if (!v) return;
    try { const r = await api('/api/estimates', { method: 'POST', body: { title: v.title, client_id: v.client_id ? Number(v.client_id) : null, data: structuredClone(STARTER[v.starter]) } }); location.hash = `#/estimates/${r.id}`; } catch (e) { fail(e); }
  };
}

export async function detail(el, { id }) {
  let est = await api(`/api/estimates/${id}`);
  let data = est.data;
  let timer;
  const owner = isOwner();

  const recompute = async () => {
    try {
      await api(`/api/estimates/${id}`, { method: 'PUT', body: { title: est.title, data } });
      est = await api(`/api/estimates/${id}`);
      drawTotals();
    } catch (e) { fail(e); }
  };
  const queue = () => { clearTimeout(timer); timer = setTimeout(recompute, 500); };

  function drawTotals() {
    const c = est.computed;
    const box = el.querySelector('#totals');
    if (!box) return;
    render(box, html`<div class="card" style="position:sticky;top:70px"><h2>Client sees</h2><div class="score" style="color:var(--forest)">${kRange(c.low_cents, c.high_cents)}</div><p class="muted small" style="margin-top:0">core scope, ex GST, rounded outward</p>
      ${c.groups.map((g) => html`<div class="row between small" style="padding:4px 0;border-bottom:1px solid #f1efea"><span>${g.name}</span><strong>${g.low_cents || g.high_cents ? kRange(g.low_cents, g.high_cents) : 'add-ons'}</strong></div>`)}
      <div class="callout small mt"><strong>Internal</strong><br>${c.internal.hours_low}–${c.internal.hours_high} h${owner && c.internal.rate_cents ? html` at ${money(c.internal.rate_cents)}/h` : ''}${c.internal.discount_pct ? ` · ${c.internal.discount_pct}% off` : ''}<br><span class="muted">Never shown to clients.</span></div>
      <div class="row mt"><button class="btn primary" id="copy">Copy for proposal</button><button class="btn danger sm" id="del">Delete</button></div></div>`);
    box.querySelector('#copy').onclick = async () => {
      const s = await api(`/api/estimates/${id}/summary`);
      await modal({ title: 'Client-facing summary', submit: '', cancel: 'Close', wide: true, body: html`<textarea class="i mono" rows="16" readonly id="txt">${s.text}</textarea><button type="button" class="btn" id="cp" style="justify-self:start">Copy text</button><p class="muted small" style="margin:0">Ranges only, ex GST, no hourly rate. Paste into the kess-proposal build or an email.</p>`,
        onOpen: (f) => { f.querySelector('#cp').onclick = () => { navigator.clipboard?.writeText(s.text); toast('Copied'); }; } });
    };
    box.querySelector('#del').onclick = async () => { if (!await confirmBox('Delete estimate?', '', 'Delete')) return; await api(`/api/estimates/${id}`, { method: 'DELETE' }); location.hash = '#/estimates'; };
  }

  function draw() {
    const c = est.computed;
    render(el, html`<div class="crumbs"><a href="#/estimates">Estimates</a> /</div>
      <div class="page-head"><div><input class="i" id="title" value="${est.title}" style="font-size:22px;font-weight:700;border-color:transparent;padding-left:0;background:transparent"></div></div>
      <div class="grid g-side"><div>
        <div class="card row" style="gap:16px">${owner ? html`<label class="f">Hourly rate (internal, $)<input class="i" type="number" id="rate" value="${centsToDollars(data.rate_cents || c.internal.rate_cents)}" style="width:120px" placeholder="from settings"></label>` : ''}
          <label class="f">Discount %<input class="i" type="number" id="disc" value="${data.discount_pct || 0}" min="0" max="90" style="width:90px"></label>
          <p class="muted small" style="flex:1;margin:0">Low and high hours per line. Ranges round outward to $100, $500 or $1k steps. Mark optional items as add-ons so they're priced but kept out of the core total.</p></div>
        ${data.groups.map((g, gi) => html`<div class="card"><div class="row between"><input class="i" data-g="${gi}" value="${g.name}" style="font-weight:700;max-width:340px"><button class="btn sm ghost danger" data-delg="${gi}">Remove group</button></div>
          <table class="t mt"><thead><tr><th>Item</th><th style="width:80px">Low h</th><th style="width:80px">High h</th><th style="width:100px">Fixed $</th><th style="width:100px">Type</th><th class="n" style="width:110px">Range</th><th></th></tr></thead><tbody>
          ${g.items.map((it, ii) => { const ci = c.groups[gi]?.items[ii]; return html`<tr><td><input class="i" data-i="${gi}.${ii}.name" value="${it.name}"><input class="i small" data-i="${gi}.${ii}.note" value="${it.note || ''}" placeholder="note for client (optional)" style="margin-top:4px;font-size:12px"></td>
            <td><input class="i" type="number" step="0.5" min="0" data-i="${gi}.${ii}.hours_low" value="${it.hours_low}"></td><td><input class="i" type="number" step="0.5" min="0" data-i="${gi}.${ii}.hours_high" value="${it.hours_high}"></td>
            <td><input class="i" type="number" step="1" min="0" data-i="${gi}.${ii}.fixed" value="${centsToDollars(it.fixed_cents || 0)}" title="third-party or fixed cost"></td>
            <td><select class="i" data-i="${gi}.${ii}.kind"><option value="core" ${it.kind !== 'addon' ? 'selected' : ''}>Core</option><option value="addon" ${it.kind === 'addon' ? 'selected' : ''}>Add-on</option></select></td>
            <td class="n">${ci ? kRange(ci.low_cents, ci.high_cents) : ''}</td><td><button class="btn sm ghost danger" data-deli="${gi}.${ii}">✕</button></td></tr>`; })}
          </tbody></table><button class="btn sm mt" data-addi="${gi}">+ Item</button></div>`)}
        <button class="btn mt" id="addg">+ Group</button></div>
        <div id="totals"></div></div>`);
    drawTotals();
    el.querySelector('#title').onchange = (e) => { est.title = e.target.value; queue(); };
    el.querySelector('#rate')?.addEventListener('change', (e) => { data.rate_cents = dollarsToCents(e.target.value) || undefined; queue(); });
    el.querySelector('#disc').onchange = (e) => { data.discount_pct = Number(e.target.value) || 0; queue(); };
    el.querySelectorAll('[data-g]').forEach((i) => i.onchange = () => { data.groups[i.dataset.g].name = i.value; queue(); });
    el.querySelectorAll('[data-i]').forEach((i) => i.onchange = () => {
      const [gi, ii, k] = i.dataset.i.split('.');
      const it = data.groups[gi].items[ii];
      if (k === 'fixed') it.fixed_cents = dollarsToCents(i.value) || 0;
      else it[k] = k.startsWith('hours') ? Number(i.value) : i.value;
      recompute().then(draw);
    });
    el.querySelectorAll('[data-deli]').forEach((b) => b.onclick = () => { const [gi, ii] = b.dataset.deli.split('.'); data.groups[gi].items.splice(ii, 1); recompute().then(draw); });
    el.querySelectorAll('[data-addi]').forEach((b) => b.onclick = () => { data.groups[b.dataset.addi].items.push({ name: 'New item', hours_low: 1, hours_high: 2 }); recompute().then(draw); });
    el.querySelectorAll('[data-delg]').forEach((b) => b.onclick = () => { data.groups.splice(Number(b.dataset.delg), 1); recompute().then(draw); });
    el.querySelector('#addg').onclick = () => { data.groups.push({ name: 'New group', items: [] }); recompute().then(draw); };
  }
  draw();
}
