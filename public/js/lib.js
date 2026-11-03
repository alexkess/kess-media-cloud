export const state = { user: null, client: null, agencyName: 'Kess Media', meta: null };

export async function api(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-Kess': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (raw) return res;
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) { location.hash = '#/login'; }
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Tagged template: escapes interpolations unless wrapped with raw().
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: true, s: String(s ?? '') });
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v && v[RAW]) out += v.s;
      else if (Array.isArray(v)) out += v.map((x) => (x && x[RAW] ? x.s : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return raw(out);
}
export const render = (el, tpl) => { el.innerHTML = tpl && tpl[RAW] ? tpl.s : String(tpl ?? ''); };

export const money = (c, { cents = false } = {}) => {
  if (c === null || c === undefined || c === '') return '—';
  const d = Number(c) / 100;
  return (d < 0 ? '-$' : '$') + Math.abs(d).toLocaleString('en-AU', { minimumFractionDigits: cents || d % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
export const kRange = (lo, hi) => {
  const k = (c) => { const d = c / 100; return d >= 1000 ? `$${(d / 1000).toFixed(d % 1000 ? 1 : 0).replace(/\.0$/, '')}k` : `$${d.toLocaleString('en-AU')}`; };
  return lo === hi ? k(lo) : `${k(lo)}–${k(hi).replace('$', '')}`;
};
export function date(s) {
  if (!s) return '—';
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s.replace(' ', 'T') + (s.includes('Z') || s.length <= 10 ? '' : 'Z'));
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function ago(s) {
  if (!s) return '';
  const t = new Date(s.replace(' ', 'T') + (s.length > 10 && !s.includes('Z') ? 'Z' : '')).getTime();
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return date(s);
}

export function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), err ? 6000 : 3200);
}
export const fail = (e) => toast(e.message || String(e), true);

// Modal with a form. fields render inside; resolves with FormData object or null.
export function modal({ title, body, submit = 'Save', wide = false, onOpen, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal${wide ? ' wide' : ''}" novalidate><h2>${title}</h2><div class="form">${body && body.s !== undefined ? body.s : body || ''}</div>
      <div class="actions">${cancel ? `<button type="button" class="btn" data-x>${esc(cancel)}</button>` : ''}${submit ? `<button class="btn primary" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
    const form = bg.querySelector('form');
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(null); });
    bg.querySelector('[data-x]')?.addEventListener('click', () => close(null));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const out = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') out[el.name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
        else out[el.name] = el.value;
      }
      close(out);
    });
    document.body.appendChild(bg);
    onOpen?.(form, close);
    (form.querySelector('[autofocus]') || form.querySelector('input,select,textarea'))?.focus();
  });
}
export const confirmBox = (title, text, submit = 'Confirm') => modal({ title, body: html`<p class="muted" style="margin:0">${text}</p>`, submit }).then((v) => v !== null);

export function field(label, name, { type = 'text', value = '', hint = '', required = false, options, rows = 3, placeholder = '', attrs = '' } = {}) {
  const req = required ? ' required' : '';
  let input;
  if (type === 'textarea') input = `<textarea class="i" name="${name}" rows="${rows}" placeholder="${esc(placeholder)}"${req} ${attrs}>${esc(value)}</textarea>`;
  else if (type === 'select') input = `<select class="i" name="${name}"${req} ${attrs}>${options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  else if (type === 'checkbox') return raw(`<label class="check"><input type="checkbox" name="${name}"${value ? ' checked' : ''} ${attrs}> ${esc(label)}</label>`);
  else input = `<input class="i" type="${type}" name="${name}" value="${esc(value)}" placeholder="${esc(placeholder)}"${req} ${attrs}>`;
  return raw(`<label class="f">${esc(label)}${hint ? ` <span class="hint">${esc(hint)}</span>` : ''}${input}</label>`);
}

export const STATUS_PILL = {
  lead: 'grey', proposal: 'info', design: 'info', build: 'warn', review: 'warn', live: '', care: 'dark', archived: 'grey',
  new: 'info', quoted: 'warn', in_progress: '', waiting: 'warn', done: 'grey', closed: 'grey',
  draft: 'grey', sent: 'warn', paid: '', void: 'grey', overdue: 'danger',
  pending: 'warn', approved: '', changes_requested: 'danger', published: 'dark', superseded: 'grey',
  low: 'grey', normal: 'grey', high: 'warn', urgent: 'danger', active: '', paused: 'grey', past: 'grey',
  read: 'grey', replied: '', spam: 'danger',
};
export const pill = (s, label) => html`<span class="pill ${STATUS_PILL[s] ?? ''}">${(label || s || '').replace(/_/g, ' ')}</span>`;

export function readFileB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export async function uploadFiles(files, { client_id, site_id } = {}) {
  const out = [];
  for (const f of files) {
    if (f.size > 14_000_000) { toast(`${f.name} is over 14 MB`, true); continue; }
    const data = await readFileB64(f);
    out.push(await api('/api/assets', { method: 'POST', body: { filename: f.name, mime: f.type || 'application/octet-stream', data, client_id, site_id } }));
  }
  return out;
}

export const isAgency = () => state.user && state.user.role !== 'client';
export const isOwner = () => state.user?.role === 'owner';
export const on = (root, sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, (e) => fn(e, el)));
export const dollarsToCents = (v) => (v === '' || v === null || v === undefined ? null : Math.round(Number(String(v).replace(/[$,\s]/g, '')) * 100));
export const centsToDollars = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace(/\.00$/, ''));

export function bars(series, key = 'views') {
  const max = Math.max(1, ...series.map((d) => d[key]));
  return raw(`<div class="bars">${series.map((d) => `<div style="height:${Math.max(1.5, (d[key] / max) * 100)}%" data-tip="${esc(date(d.day))}: ${d[key]}"></div>`).join('')}</div>`);
}

export const LOGO_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3l8 7-8 7" fill="none" stroke="#7BBF9A" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
